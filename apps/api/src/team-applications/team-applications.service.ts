import { Injectable, NotFoundException } from '@nestjs/common';
import { DB_CONSTRAINTS, isUniqueViolation, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { API_ERROR_CODES } from '../common/errors/api-error.js';
import { iso } from '../common/http/dto.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { assertSuperAdminLocked, TX_OPTIONS } from '../team-domain/team-access.js';
import {
  conflict,
  rethrowMapped,
  sampleResource,
  TEAM_IDENTITY_CONSTRAINTS,
} from '../team-domain/team-errors.js';
import { assertTeamIdentityFree, chooseFreeSlug } from '../team-domain/team-identity.js';
import {
  APPLICATION_QUOTA_PER_DAY,
  APPLICATION_QUOTA_WINDOW_MS,
  MY_APPLICATIONS_LIMIT,
  slugBaseFromName,
} from '../team-domain/team-policy.js';
import type {
  AdminTeamApplicationDto,
  AdminTeamApplicationsQueryDto,
  CreateTeamApplicationDto,
  TeamApplicationDto,
} from './team-applications.dto.js';

const SLUG_RACE_RETRIES = 3;

const applicationSelect = {
  id: true,
  applicantUserId: true,
  requestedName: true,
  requestedTag: true,
  requestedSlug: true,
  countryCode: true,
  description: true,
  status: true,
  reviewReason: true,
  reviewedAt: true,
  reviewedById: true,
  createdAt: true,
  createdTeam: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.TeamApplicationSelect;

const adminApplicationSelect = {
  ...applicationSelect,
  applicant: {
    select: {
      steamId64: true,
      isSample: true,
      playerProfile: { select: { nickname: true, slug: true } },
    },
  },
} satisfies Prisma.TeamApplicationSelect;

type ApplicationRow = Prisma.TeamApplicationGetPayload<{ select: typeof applicationSelect }>;
type AdminApplicationRow = Prisma.TeamApplicationGetPayload<{
  select: typeof adminApplicationSelect;
}>;

export function toTeamApplicationDto(row: ApplicationRow): TeamApplicationDto {
  return {
    id: row.id,
    name: row.requestedName,
    tag: row.requestedTag,
    slug: row.requestedSlug,
    countryCode: row.countryCode,
    description: row.description,
    status: row.status,
    reviewReason: row.reviewReason,
    reviewedAt: iso(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
    createdTeam: row.createdTeam,
  };
}

function toAdminDto(row: AdminApplicationRow): AdminTeamApplicationDto {
  return {
    ...toTeamApplicationDto(row),
    applicant: {
      userId: row.applicantUserId,
      steamId64: row.applicant.steamId64,
      nickname: row.applicant.playerProfile?.nickname ?? '',
      playerSlug: row.applicant.playerProfile?.slug ?? '',
    },
    reviewedById: row.reviewedById,
    // Applications carry no own sample flag: an application is sample iff its applicant is.
    isSample: row.applicant.isSample,
  };
}

const applicationNotPending = () =>
  conflict(API_ERROR_CODES.applicationNotPending, 'Application is no longer pending');
const applicantInTeam = () =>
  conflict(API_ERROR_CODES.applicantInTeam, 'Applicant is already an active member of a team');
const applicationAlreadyPending = () =>
  conflict(API_ERROR_CODES.applicationAlreadyPending, 'You already have a pending application');

@Injectable()
export class TeamApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Own applications, newest first (max 20). */
  async listMine(userId: string): Promise<TeamApplicationDto[]> {
    const rows = await this.prisma.client.teamApplication.findMany({
      where: { applicantUserId: userId },
      select: applicationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MY_APPLICATIONS_LIMIT,
    });
    return rows.map(toTeamApplicationDto);
  }

  /** Admin queue: filtered by status (default PENDING), oldest first. */
  async listForAdmin(query: AdminTeamApplicationsQueryDto): Promise<Page<AdminTeamApplicationDto>> {
    const where: Prisma.TeamApplicationWhereInput = { status: query.status };
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.teamApplication.findMany({
        where,
        select: adminApplicationSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.teamApplication.count({ where }),
    ]);
    return pageOf(rows.map(toAdminDto), total, query);
  }

  async submit(
    userId: string,
    dto: CreateTeamApplicationDto,
    ctx: AuditRequestContext,
  ): Promise<TeamApplicationDto> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          // Serializes this user's own concurrent submissions (and makes the checks below
          // consistent); the partial unique indexes stay the final arbiter.
          const users = await tx.$queryRaw<{ is_sample: boolean }[]>`
            SELECT is_sample FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          if (!users[0]) throw new NotFoundException('User not found');
          if (users[0].is_sample) throw sampleResource();
          const membership = await tx.teamMembership.findFirst({
            where: { userId, leftAt: null },
            select: { id: true },
          });
          if (membership) {
            throw conflict(API_ERROR_CODES.applicantInTeam, 'You are already in a team');
          }
          const pending = await tx.teamApplication.findFirst({
            where: { applicantUserId: userId, status: 'PENDING' },
            select: { id: true },
          });
          if (pending) throw applicationAlreadyPending();
          // Gate L-3: per-applicant quota, rolling window, counted under the user row lock.
          const recent = await tx.teamApplication.count({
            where: {
              applicantUserId: userId,
              createdAt: { gt: new Date(Date.now() - APPLICATION_QUOTA_WINDOW_MS) },
            },
          });
          if (recent >= APPLICATION_QUOTA_PER_DAY) {
            throw conflict(
              API_ERROR_CODES.applicationLimit,
              `At most ${APPLICATION_QUOTA_PER_DAY} applications per 24 hours`,
            );
          }
          await assertTeamIdentityFree(tx, dto.name, dto.tag, { includePendingApplications: true });
          const slug = await chooseFreeSlug(tx, slugBaseFromName(dto.name), {
            includePendingApplications: true,
          });
          const row = await tx.teamApplication.create({
            data: {
              applicantUserId: userId,
              requestedName: dto.name,
              requestedTag: dto.tag,
              requestedSlug: slug,
              countryCode: dto.countryCode ?? null,
              description: dto.description ?? null,
            },
            select: applicationSelect,
          });
          await this.audit.write(
            {
              action: 'team_application.submit',
              actorUserId: userId,
              resourceType: 'team_application',
              resourceId: row.id,
              detail: { name: row.requestedName, tag: row.requestedTag, slug: row.requestedSlug },
            },
            ctx,
            tx,
          );
          return toTeamApplicationDto(row);
        }, TX_OPTIONS);
      } catch (err) {
        // Two different names can derive the same slug; a concurrent submit may take it first.
        if (
          attempt < SLUG_RACE_RETRIES &&
          isUniqueViolation(err, DB_CONSTRAINTS.applicationPendingSlugUnique)
        ) {
          continue;
        }
        rethrowMapped(err, {
          ...TEAM_IDENTITY_CONSTRAINTS,
          [DB_CONSTRAINTS.applicationOnePendingPerApplicant]: applicationAlreadyPending,
        });
      }
    }
  }

  async withdraw(
    userId: string,
    applicationId: string,
    ctx: AuditRequestContext,
  ): Promise<TeamApplicationDto> {
    return this.prisma.client.$transaction(async (tx) => {
      // Ownership is part of the lookup: someone else's application is indistinguishable from
      // a missing one (404, TEAMS.md §3 / A9).
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM team_applications
        WHERE id = ${applicationId}::uuid AND applicant_user_id = ${userId}::uuid
        FOR UPDATE`;
      if (!locked[0]) throw new NotFoundException('Application not found');
      if (locked[0].status !== 'PENDING') throw applicationNotPending();
      const row = await tx.teamApplication.update({
        where: { id: applicationId },
        data: { status: 'WITHDRAWN' },
        select: applicationSelect,
      });
      await this.audit.write(
        {
          action: 'team_application.withdraw',
          actorUserId: userId,
          resourceType: 'team_application',
          resourceId: applicationId,
        },
        ctx,
        tx,
      );
      return toTeamApplicationDto(row);
    }, TX_OPTIONS);
  }

  /**
   * TEAMS.md §4.1 approve transaction. The application row lock serializes concurrent approvals:
   * the loser re-reads a non-PENDING status and gets 409 APPLICATION_NOT_PENDING, so exactly one
   * team and one captain membership are created. `created_team_id` UNIQUE is the backstop.
   */
  async approve(
    actorUserId: string,
    applicationId: string,
    note: string | null | undefined,
    ctx: AuditRequestContext,
  ): Promise<TeamApplicationDto> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          await assertSuperAdminLocked(tx, actorUserId);
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM team_applications WHERE id = ${applicationId}::uuid FOR UPDATE`;
          if (!locked[0]) throw new NotFoundException('Application not found');
          const app = await tx.teamApplication.findUniqueOrThrow({
            where: { id: applicationId },
            select: {
              ...applicationSelect,
              applicant: { select: { status: true, isSample: true } },
            },
          });
          if (app.status !== 'PENDING') throw applicationNotPending();
          if (app.applicant.status !== 'ACTIVE' || app.applicant.isSample) {
            throw conflict(
              API_ERROR_CODES.applicantIneligible,
              'Applicant account is not eligible (suspended, banned or sample)',
            );
          }
          const membership = await tx.teamMembership.findFirst({
            where: { userId: app.applicantUserId, leftAt: null },
            select: { id: true },
          });
          if (membership) throw applicantInTeam();
          await assertTeamIdentityFree(tx, app.requestedName, app.requestedTag, {
            includePendingApplications: false,
          });
          const slug = await chooseFreeSlug(tx, app.requestedSlug, {
            includePendingApplications: false,
          });
          const now = new Date();
          const team = await tx.team.create({
            data: {
              slug,
              name: app.requestedName,
              tag: app.requestedTag,
              countryCode: app.countryCode,
              description: app.description,
              status: 'ACTIVE',
            },
            select: { id: true, slug: true, name: true },
          });
          const captain = await tx.teamMembership.create({
            data: { teamId: team.id, userId: app.applicantUserId, role: 'CAPTAIN', joinedAt: now },
            select: { id: true },
          });
          const updated = await tx.teamApplication.update({
            where: { id: applicationId },
            data: {
              status: 'APPROVED',
              createdTeamId: team.id,
              reviewedById: actorUserId,
              reviewedAt: now,
              reviewReason: note ?? null,
            },
            select: applicationSelect,
          });
          await this.audit.write(
            {
              action: 'team_application.approve',
              actorUserId,
              resourceType: 'team_application',
              resourceId: applicationId,
              detail: { teamId: team.id, slug: team.slug, note: note ?? null },
            },
            ctx,
            tx,
          );
          await this.audit.write(
            {
              action: 'team.create',
              actorUserId,
              resourceType: 'team',
              resourceId: team.id,
              detail: {
                source: 'application',
                applicationId,
                name: team.name,
                slug: team.slug,
                captainUserId: app.applicantUserId,
              },
            },
            ctx,
            tx,
          );
          await this.audit.write(
            {
              action: 'team_membership.join',
              actorUserId,
              resourceType: 'team_membership',
              resourceId: captain.id,
              detail: {
                teamId: team.id,
                userId: app.applicantUserId,
                role: 'CAPTAIN',
                source: 'application_approval',
              },
            },
            ctx,
            tx,
          );
          return toTeamApplicationDto(updated);
        }, TX_OPTIONS);
      } catch (err) {
        if (attempt < SLUG_RACE_RETRIES && isUniqueViolation(err, DB_CONSTRAINTS.teamSlugUnique)) {
          continue;
        }
        rethrowMapped(err, {
          ...TEAM_IDENTITY_CONSTRAINTS,
          [DB_CONSTRAINTS.membershipOneActivePerUser]: applicantInTeam,
          [DB_CONSTRAINTS.applicationCreatedTeamUnique]: applicationNotPending,
        });
      }
    }
  }

  async reject(
    actorUserId: string,
    applicationId: string,
    reason: string,
    ctx: AuditRequestContext,
  ): Promise<TeamApplicationDto> {
    return this.prisma.client.$transaction(async (tx) => {
      await assertSuperAdminLocked(tx, actorUserId);
      const locked = await tx.$queryRaw<{ status: string; is_sample: boolean }[]>`
        SELECT a.status, u.is_sample FROM team_applications a
        JOIN users u ON u.id = a.applicant_user_id
        WHERE a.id = ${applicationId}::uuid
        FOR UPDATE OF a`;
      if (!locked[0]) throw new NotFoundException('Application not found');
      if (locked[0].is_sample) throw sampleResource();
      if (locked[0].status !== 'PENDING') throw applicationNotPending();
      const row = await tx.teamApplication.update({
        where: { id: applicationId },
        data: {
          status: 'REJECTED',
          reviewedById: actorUserId,
          reviewedAt: new Date(),
          reviewReason: reason,
        },
        select: applicationSelect,
      });
      await this.audit.write(
        {
          action: 'team_application.reject',
          actorUserId,
          resourceType: 'team_application',
          resourceId: applicationId,
          detail: { reason },
        },
        ctx,
        tx,
      );
      return toTeamApplicationDto(row);
    }, TX_OPTIONS);
  }
}
