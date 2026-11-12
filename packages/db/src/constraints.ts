/**
 * Names of database constraints/indexes the API is expected to translate into domain errors
 * (e.g. HTTP 409). Defined in prisma/migrations/*_init/migration.sql — keep in sync.
 */
export const DB_CONSTRAINTS = {
  userSteamIdUnique: 'users_steam_id64_key',
  userSteamIdFormat: 'users_steam_id64_format_chk',
  userSampleSteamIdRange: 'users_sample_steam_id_range_chk',
  playerProfileSlugUnique: 'player_profiles_slug_key',
  roleGrantActiveUnique: 'user_role_grants_active_uniq',
  applicationOnePendingPerApplicant: 'team_applications_one_pending_per_applicant_uniq',
  applicationPendingNameUnique: 'team_applications_pending_name_ci_uniq',
  applicationPendingSlugUnique: 'team_applications_pending_slug_uniq',
  applicationCreatedTeamUnique: 'team_applications_created_team_id_key',
  teamSlugUnique: 'teams_slug_key',
  teamNameUnique: 'teams_name_key',
  teamNameCaseInsensitiveUnique: 'teams_name_ci_uniq',
  teamTagCaseInsensitiveUnique: 'teams_tag_ci_uniq',
  membershipOneActivePerUser: 'team_memberships_one_active_per_user_uniq',
  membershipOneActiveCaptainPerTeam: 'team_memberships_one_active_captain_per_team_uniq',
  membershipInvitationUnique: 'team_memberships_invitation_id_key',
  invitationOnePendingPerTeamInvitee: 'team_invitations_one_pending_per_team_invitee_uniq',
  registrationTournamentTeamUnique: 'tournament_registrations_tournament_id_team_id_key',
  rosterOneLockedPerRegistration: 'tournament_rosters_one_locked_per_registration_uniq',
  rosterEntryUserUnique: 'tournament_roster_entries_roster_id_user_id_key',
  rosterEntrySteamIdUnique: 'tournament_roster_entries_roster_id_steam_id64_snapshot_key',
  vetoMapOncePerMatch: 'map_veto_actions_map_once_per_match_uniq',
  allocationOneActivePerServer: 'server_allocations_one_active_per_server_uniq',
  allocationOneActivePerMatch: 'server_allocations_one_active_per_match_uniq',
  commandIdempotencyKeyUnique: 'server_command_requests_idempotency_key_key',
  matchEventSourceUnique: 'match_events_source_server_id_external_event_id_key',
} as const;

export type DbConstraintName = (typeof DB_CONSTRAINTS)[keyof typeof DB_CONSTRAINTS];
