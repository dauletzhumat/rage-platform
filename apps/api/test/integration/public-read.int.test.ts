import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, prismaOf, sampleSteamId, truncateAll } from './helpers.js';

/**
 * Public read endpoints against real PostgreSQL, focusing on what must NOT be exposed:
 * drafts, inactive teams, suspended users, former members, unverified winners,
 * and unplayed-map scores.
 */
describe('public read API', () => {
  let app: NestExpressApplication;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    await truncateAll(app);
    const db = prismaOf(app);

    const mkPlayer = async (slug: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
      const user = await db.user.create({
        data: {
          steamId64: sampleSteamId(),
          status,
          isSample: true,
          playerProfile: { create: { nickname: slug.toUpperCase(), slug, countryCode: 'KZ' } },
        },
      });
      return user.id;
    };

    ids.captain = await mkPlayer('cap');
    ids.player = await mkPlayer('alpha');
    ids.former = await mkPlayer('former');
    ids.suspended = await mkPlayer('banned-guy', 'SUSPENDED');

    const team = await db.team.create({
      data: { slug: 'sample-falcons', name: 'Sample Falcons', tag: 'SFAL', isSample: true },
    });
    ids.team = team.id;
    const hidden = await db.team.create({
      data: { slug: 'disbanded-team', name: 'Disbanded Team', tag: 'DIS', status: 'DISBANDED' },
    });
    ids.hiddenTeam = hidden.id;

    await db.teamMembership.createMany({
      data: [
        // Player joined first, captain second: roster must still list the captain first.
        { teamId: team.id, userId: ids.player, role: 'PLAYER', joinedAt: new Date('2026-01-01') },
        { teamId: team.id, userId: ids.captain, role: 'CAPTAIN', joinedAt: new Date('2026-01-02') },
        {
          teamId: team.id,
          userId: ids.former,
          role: 'PLAYER',
          joinedAt: new Date('2025-06-01'),
          leftAt: new Date('2025-12-01'),
        },
      ],
    });

    const open = await db.tournament.create({
      data: {
        slug: 'sample-open-cup',
        name: 'Sample Open Cup',
        format: 'SINGLE_ELIMINATION',
        status: 'REGISTRATION_OPEN',
        startsAt: new Date('2026-12-01T12:00:00Z'),
        settingsJson: { description: 'Demo tournament' },
        isSample: true,
      },
    });
    ids.open = open.id;
    const draft = await db.tournament.create({
      data: { slug: 'secret-draft', name: 'Secret Draft', format: 'SINGLE_ELIMINATION' },
    });
    ids.draft = draft.id;

    const match = await db.match.create({
      data: {
        tournamentId: open.id,
        teamAId: team.id,
        format: 'BO3',
        status: 'LIVE',
        // A winner id without result verification must not be published.
        winnerTeamId: team.id,
        scheduledAt: new Date('2026-12-01T13:00:00Z'),
        isSample: true,
        maps: {
          create: [
            { mapOrder: 1, mapName: 'de_mirage', status: 'LIVE', teamAScore: 7, teamBScore: 5 },
            { mapOrder: 2, mapName: 'de_inferno', status: 'PENDING' },
          ],
        },
      },
    });
    ids.match = match.id;
    const draftMatch = await db.match.create({ data: { tournamentId: draft.id } });
    ids.draftMatch = draftMatch.id;
  });

  afterAll(async () => {
    if (app) {
      await truncateAll(app);
      await app.close();
    }
  });

  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`);

  describe('teams', () => {
    it('lists only active teams with active member counts', async () => {
      const res = await get('/teams').expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(res.body.items).toEqual([
        {
          id: ids.team,
          slug: 'sample-falcons',
          name: 'Sample Falcons',
          tag: 'SFAL',
          countryCode: null,
          region: null,
          logoUrl: null,
          isSample: true,
          activeMemberCount: 2,
        },
      ]);
    });

    it('searches by name or tag, case-insensitively', async () => {
      expect((await get('/teams?q=falc').expect(200)).body.total).toBe(1);
      expect((await get('/teams?q=sfal').expect(200)).body.total).toBe(1);
      expect((await get('/teams?q=zzz').expect(200)).body.total).toBe(0);
    });

    it('team detail lists current roster, captain first, without former members', async () => {
      const res = await get('/teams/sample-falcons').expect(200);
      expect(res.body.roster.map((r: { playerSlug: string }) => r.playerSlug)).toEqual([
        'cap',
        'alpha',
      ]);
      expect(res.body.roster[0].role).toBe('CAPTAIN');
    });

    it('inactive teams and malformed slugs are 404', async () => {
      await get('/teams/disbanded-team').expect(404);
      const res = await get('/teams/NOT_A_SLUG').expect(404);
      expect(res.body.message).toBe('Team not found');
    });
  });

  describe('players', () => {
    it('lists active players only, never suspended accounts', async () => {
      const res = await get('/players').expect(200);
      const slugs = res.body.items.map((p: { slug: string }) => p.slug);
      expect(slugs).toEqual(['alpha', 'cap', 'former']);
      expect(res.body.items[0]).toMatchObject({ isSample: true, avatarUrl: null });
      expect(res.body.items[0].steamId64).toMatch(/^\d{17}$/);
      await get('/players/banned-guy').expect(404);
    });

    it('player detail shows the current team only for active memberships', async () => {
      expect((await get('/players/cap').expect(200)).body.currentTeam).toEqual({
        slug: 'sample-falcons',
        name: 'Sample Falcons',
        tag: 'SFAL',
      });
      expect((await get('/players/former').expect(200)).body.currentTeam).toBeNull();
    });

    it('paginates deterministically', async () => {
      const p2 = await get('/players?page=2&pageSize=2').expect(200);
      expect(p2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      expect(p2.body.items.map((p: { slug: string }) => p.slug)).toEqual(['former']);
    });
  });

  describe('tournaments', () => {
    it('never exposes DRAFT tournaments', async () => {
      const res = await get('/tournaments').expect(200);
      expect(res.body.items.map((t: { slug: string }) => t.slug)).toEqual(['sample-open-cup']);
      await get('/tournaments/secret-draft').expect(404);
    });

    it('detail includes description and approved registration count', async () => {
      const res = await get('/tournaments/sample-open-cup').expect(200);
      expect(res.body).toMatchObject({
        status: 'REGISTRATION_OPEN',
        format: 'SINGLE_ELIMINATION',
        description: 'Demo tournament',
        registeredTeamCount: 0,
        startsAt: '2026-12-01T12:00:00.000Z',
        isSample: true,
      });
    });

    it('filters by public status and rejects DRAFT as a filter', async () => {
      expect((await get('/tournaments?status=COMPLETED').expect(200)).body.total).toBe(0);
      const res = await get('/tournaments?status=DRAFT').expect(400);
      expect(res.body.details[0].field).toBe('status');
    });
  });

  describe('matches', () => {
    it('hides matches of draft tournaments', async () => {
      const res = await get('/matches').expect(200);
      expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([ids.match]);
      await get(`/matches/${ids.draftMatch}`).expect(404);
    });

    it('does not publish an unverified winner; TBD opponents are null', async () => {
      const res = await get(`/matches/${ids.match}`).expect(200);
      expect(res.body).toMatchObject({
        status: 'LIVE',
        format: 'BO3',
        winnerTeamSlug: null,
        teamA: { slug: 'sample-falcons', name: 'Sample Falcons', tag: 'SFAL' },
        teamB: null,
        tournament: { slug: 'sample-open-cup', name: 'Sample Open Cup' },
      });
    });

    it('unplayed maps have null scores (no fabricated 0–0)', async () => {
      const res = await get(`/matches/${ids.match}`).expect(200);
      expect(res.body.maps).toEqual([
        { mapOrder: 1, mapName: 'de_mirage', status: 'LIVE', teamAScore: 7, teamBScore: 5 },
        {
          mapOrder: 2,
          mapName: 'de_inferno',
          status: 'PENDING',
          teamAScore: null,
          teamBScore: null,
        },
      ]);
    });

    it('publishes the winner once the result is verified', async () => {
      await prismaOf(app).match.update({
        where: { id: ids.match },
        data: { status: 'COMPLETED', resultVerifiedAt: new Date() },
      });
      const res = await get(`/matches/${ids.match}`).expect(200);
      expect(res.body.winnerTeamSlug).toBe('sample-falcons');
    });

    it('malformed id → 400, unknown id → 404', async () => {
      const bad = await get('/matches/not-a-uuid').expect(400);
      expect(bad.body.details).toEqual([{ field: 'id', message: 'id must be a UUID' }]);
      await get('/matches/0195f1d2-0000-7000-8000-000000000000').expect(404);
    });
  });
});
