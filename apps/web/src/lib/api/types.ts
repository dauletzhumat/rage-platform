/**
 * RAGE API v1 contract types for the web app.
 *
 * Resource shapes come from `@rage/api-client`, which is GENERATED from the API's OpenAPI
 * document — so any API/web contract drift is a compile error here. Pages import only
 * from this module. Web-specific helpers (ApiResult, list params) are defined below.
 */
import type {
  ApiError,
  Paginated,
  MatchFormat,
  MatchMapStatus,
  MatchStatus,
  MembershipRole,
  TournamentStatus,
} from '@rage/api-client';

export type {
  MatchDetail,
  MatchFormat,
  MatchMap,
  MatchMapStatus,
  MatchStatus,
  MatchSummary,
  MetaResponse,
  Paginated,
  PlayerDetail,
  PlayerSummary,
  ReadinessResponse,
  TeamDetail,
  TeamRef,
  TeamSummary,
  TournamentDetail,
  TournamentRef,
  TournamentStatus,
  TournamentSummary,
} from '@rage/api-client';

export type ApiErrorBody = ApiError;
export type RosterRole = MembershipRole;
export type { TeamRosterEntry as RosterEntry } from '@rage/api-client';
export type FeatureStatus = 'not_implemented' | 'configured' | 'unconfigured';
export type DependencyStatus = 'up' | 'down';

/**
 * Compile-time guard: the tuple must list every member of the generated union, no more.
 * (If the API adds/removes a status, this file stops compiling.)
 */
type Exhaustive<Union, Tuple extends readonly unknown[]> = [Union] extends [Tuple[number]]
  ? [Tuple[number]] extends [Union]
    ? Tuple
    : never
  : never;

const tournamentStatuses = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export const TOURNAMENT_STATUSES: Exhaustive<TournamentStatus, typeof tournamentStatuses> =
  tournamentStatuses;

const matchStatuses = [
  'CREATED',
  'SERVER_ASSIGNED',
  'PREPARING',
  'WARMUP',
  'READY_CHECK',
  'KNIFE',
  'LIVE',
  'PAUSED',
  'MAP_FINISHED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'DISPUTED',
] as const;
export const MATCH_STATUSES: Exhaustive<MatchStatus, typeof matchStatuses> = matchStatuses;

const matchFormats = ['BO1', 'BO3', 'BO5'] as const;
export const MATCH_FORMATS: Exhaustive<MatchFormat, typeof matchFormats> = matchFormats;

const matchMapStatuses = [
  'PENDING',
  'WARMUP',
  'KNIFE',
  'LIVE',
  'PAUSED',
  'FINISHED',
  'CANCELLED',
] as const;
export const MATCH_MAP_STATUSES: Exhaustive<MatchMapStatus, typeof matchMapStatuses> =
  matchMapStatuses;

// ---------- request params ----------
export interface ListParams {
  page?: number;
  pageSize?: number;
  q?: string;
}

export interface TournamentListParams extends ListParams {
  status?: TournamentStatus;
}

// ---------- auth / admin (M1) ----------
// Generated from the API OpenAPI document via @rage/api-client (docs/AUTH.md §9).
import type {
  AdminUser,
  AuditLogEntry,
  GrantRoleRequest as GeneratedGrantRoleRequest,
  MeResponse,
  MeRole as GeneratedMeRole,
  RevokeRoleRequest as GeneratedRevokeRoleRequest,
  RoleGrant,
  RoleScopeType as GeneratedRoleScopeType,
  RoleType as GeneratedRoleType,
  UpdateMyProfileRequest,
  UserStatus as GeneratedUserStatus,
} from '@rage/api-client';

export type RoleType = GeneratedRoleType;
export type RoleScopeType = GeneratedRoleScopeType;
export type UserStatus = GeneratedUserStatus;
export type MeRole = GeneratedMeRole;
export type MeDto = MeResponse;
export type UpdateProfileRequest = UpdateMyProfileRequest;
export type RoleGrantDto = RoleGrant;
export type AdminUserDto = AdminUser;
export type GrantRoleRequest = GeneratedGrantRoleRequest;
export type RevokeRoleRequest = GeneratedRevokeRoleRequest;
export type AuditLogDto = AuditLogEntry;
export type PaginatedResponse<T> = Paginated<T>;

const roleTypes = [
  'SUPER_ADMIN',
  'TOURNAMENT_ADMIN',
  'MATCH_ADMIN',
  'OBSERVER',
  'TEAM_MANAGER',
] as const;
export const ROLE_TYPES: Exhaustive<RoleType, typeof roleTypes> = roleTypes;

const userStatuses = ['ACTIVE', 'SUSPENDED', 'BANNED'] as const;
export const USER_STATUSES: Exhaustive<UserStatus, typeof userStatuses> = userStatuses;

export type AdminUserListParams = ListParams;

export interface AuditListParams {
  page?: number;
  pageSize?: number;
  action?: string;
  actorUserId?: string;
}

// ---------- result type ----------
export type ApiFailureKind =
  | 'not_found'
  | 'unavailable'
  | 'error'
  /** 400 — request validation failed (`details` lists field errors). */
  | 'validation'
  /** 401 — no valid session. */
  | 'unauthenticated'
  /** 403 — authenticated but not allowed (or CSRF validation failed). */
  | 'forbidden'
  /** 409 — conflict / invalid state transition. */
  | 'conflict'
  /** 429 — throttled; `retryAfterSeconds` when the API sent Retry-After. */
  | 'rate_limited';

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiFailure {
  ok: false;
  kind: ApiFailureKind;
  /** HTTP status when a response was received. */
  status?: number;
  /** Safe, user-presentable summary (never a stack trace). */
  message: string;
  requestId?: string;
  /** Field errors from a 400 response (`ApiErrorDto.details`). */
  details?: ApiFieldError[];
  /** The API's own `message` for 400/409 (documented as safe to display; English). */
  serverMessage?: string;
  /** Parsed `Retry-After` for 429, in whole seconds. */
  retryAfterSeconds?: number;
  /** Stable machine-readable `ApiErrorDto.code` (4xx only; never set for 5xx). */
  code?: string;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// ---- M2 types (generated, docs/TEAMS.md) ----
import type {
  AdminTeamApplication,
  ApproveTeamApplicationRequest as GeneratedApproveRequest,
  CreateInvitationRequest as GeneratedCreateInvitationRequest,
  CreateTeamApplicationRequest as GeneratedCreateApplicationRequest,
  InvitationRole as GeneratedInvitationRole,
  InvitationStatus as GeneratedInvitationStatus,
  MeMembership,
  MyInvitation,
  RejectTeamApplicationRequest as GeneratedRejectRequest,
  RemoveMemberRequest as GeneratedRemoveMemberRequest,
  RevokeInvitationRequest as GeneratedRevokeInvitationRequest,
  RosterHistoryEntry,
  RosterLeftReason as GeneratedRosterLeftReason,
  TeamApplication,
  TeamApplicationStatus as GeneratedTeamApplicationStatus,
  TeamDetail as GeneratedTeamDetail,
  TeamInvitation,
  TeamManage,
  TeamMembershipRole as GeneratedTeamMembershipRole,
  TeamRosterEntry as GeneratedTeamRosterEntry,
  TransferCaptainRequest as GeneratedTransferCaptainRequest,
} from '@rage/api-client';

export type TeamApplicationStatus = GeneratedTeamApplicationStatus;
export type InvitationStatus = GeneratedInvitationStatus;
export type InvitationRole = GeneratedInvitationRole;
export type TeamMembershipRole = GeneratedTeamMembershipRole;
export type RosterLeftReason = GeneratedRosterLeftReason;

const teamApplicationStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export const TEAM_APPLICATION_STATUSES: Exhaustive<
  TeamApplicationStatus,
  typeof teamApplicationStatuses
> = teamApplicationStatuses;

const invitationStatuses = ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'] as const;
export const INVITATION_STATUSES: Exhaustive<InvitationStatus, typeof invitationStatuses> =
  invitationStatuses;

const invitationRoles = ['PLAYER', 'SUBSTITUTE'] as const;
export const INVITATION_ROLES: Exhaustive<InvitationRole, typeof invitationRoles> = invitationRoles;

const rosterLeftReasons = ['left', 'removed', 'role_change', 'captain_transfer', 'admin'] as const;
export const ROSTER_LEFT_REASONS: Exhaustive<RosterLeftReason, typeof rosterLeftReasons> =
  rosterLeftReasons;

export type TeamApplicationDto = TeamApplication;
export type AdminTeamApplicationDto = AdminTeamApplication;
export type TeamInvitationDto = TeamInvitation;
export type MyInvitationDto = MyInvitation;
export type RosterHistoryEntryDto = RosterHistoryEntry;
export type TeamRosterEntryM2 = GeneratedTeamRosterEntry;
export type TeamDetailM2 = GeneratedTeamDetail;
export type TeamManageDto = TeamManage;
export type MeMembershipDto = MeMembership;
export type MeDtoM2 = MeDto;

export type CreateTeamApplicationRequest = GeneratedCreateApplicationRequest;
export type ApproveTeamApplicationRequest = GeneratedApproveRequest;
export type RejectTeamApplicationRequest = GeneratedRejectRequest;
export type CreateInvitationRequest = GeneratedCreateInvitationRequest;
export type RevokeInvitationRequest = GeneratedRevokeInvitationRequest;
export type RemoveMemberRequest = GeneratedRemoveMemberRequest;
export type TransferCaptainRequest = GeneratedTransferCaptainRequest;

export interface AdminTeamApplicationListParams {
  status?: TeamApplicationStatus;
  page?: number;
  pageSize?: number;
}
// ---- end M2 types ----
