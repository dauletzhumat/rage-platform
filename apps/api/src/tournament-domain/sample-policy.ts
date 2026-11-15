import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { sampleResource } from '../team-domain/team-errors.js';

/**
 * The ONE place that decides whether the M3 tournament flow may touch sample (`is_sample`) data.
 *
 * Default (and always in production — `parseEnv` rejects the flag there): sample tournaments,
 * teams, matches and players are never mutated (409 SAMPLE_RESOURCE; TOURNAMENTS.md §1).
 *
 * With `ALLOW_SAMPLE_MUTATIONS=true` (dev-only demo mode) the M3 flow may mutate sample data
 * **inside sample tournaments only**:
 *   - tournament admin actions, registrations, veto and admin results on sample tournaments;
 *   - sample teams / sample players may appear only on rosters of sample tournaments
 *     (a sample team or player can never enter a non-sample tournament);
 *   - isolation is symmetric: a REAL team can never enter a sample tournament either (so a real
 *     team never gets demo results or `team_achievements`; demo-mode security review M-1).
 * M1/M2 guards (roles for sample users, applications, invitations, sample team rosters) do not
 * consult this policy and stay blocked. Everything stays `is_sample = true`; results stay
 * ADMIN_OVERRIDE / FORFEIT and unverified. Audit rows of such mutations carry `sample: true`.
 */
@Injectable()
export class SamplePolicy {
  readonly mutationsEnabled: boolean;

  constructor(@Inject(ENV) env: Pick<Env, 'ALLOW_SAMPLE_MUTATIONS'>) {
    this.mutationsEnabled = env.ALLOW_SAMPLE_MUTATIONS === true;
  }

  /** Whether a tournament may be mutated by the M3 flow. */
  tournamentMutable(tournament: { isSample: boolean }): boolean {
    return !tournament.isSample || this.mutationsEnabled;
  }

  assertTournamentMutable(tournament: { isSample: boolean }): void {
    if (!this.tournamentMutable(tournament)) throw sampleResource();
  }

  /**
   * Teams and tournaments never mix sample and real: a sample team only in a sample tournament
   * (and only in demo mode); a real team never in a sample tournament.
   */
  assertTeamAllowedIn(team: { isSample: boolean }, tournament: { isSample: boolean }): void {
    if (team.isSample !== tournament.isSample) throw sampleResource();
    if (team.isSample && !this.mutationsEnabled) throw sampleResource();
  }

  /** A sample match may only be mutated inside a sample tournament, and only in demo mode. */
  assertMatchMutable(match: { isSample: boolean }, tournament: { isSample: boolean } | null): void {
    if (tournament) this.assertTournamentMutable(tournament);
    if (match.isSample && !(this.mutationsEnabled && tournament?.isSample === true)) {
      throw sampleResource();
    }
  }

  /** Eligibility: sample players are acceptable only on sample-tournament rosters in demo mode. */
  samplePlayersAllowed(tournament: { isSample: boolean }): boolean {
    return this.mutationsEnabled && tournament.isSample;
  }
}

/** `detail.sample: true` for audit rows of mutations on sample tournaments. */
export function sampleAuditTag(isSample: boolean): { sample: true } | Record<string, never> {
  return isSample ? { sample: true } : {};
}

@Global()
@Module({ providers: [SamplePolicy], exports: [SamplePolicy] })
export class SamplePolicyModule {}
