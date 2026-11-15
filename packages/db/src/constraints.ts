/**
 * Names of database constraints/indexes the API is expected to translate into domain errors
 * (e.g. HTTP 409). Defined in the raw SQL of prisma/migrations (init and later) — keep in sync.
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
  /** M2: no two PENDING applications with the same tag (case-insensitive). */
  applicationPendingTagUnique: 'team_applications_pending_tag_ci_uniq',
  /** M2: tag format backstop `^[A-Za-z0-9]{2,10}$` (API enforces 2-6). */
  applicationTagFormat: 'team_applications_tag_format_chk',
  teamSlugUnique: 'teams_slug_key',
  teamNameUnique: 'teams_name_key',
  teamNameCaseInsensitiveUnique: 'teams_name_ci_uniq',
  teamTagCaseInsensitiveUnique: 'teams_tag_ci_uniq',
  teamTagFormat: 'teams_tag_format_chk',
  membershipOneActivePerUser: 'team_memberships_one_active_per_user_uniq',
  membershipOneActiveCaptainPerTeam: 'team_memberships_one_active_captain_per_team_uniq',
  membershipInvitationUnique: 'team_memberships_invitation_id_key',
  /** M2: memberships use only CAPTAIN / PLAYER / SUBSTITUTE (ADR-019). */
  membershipRoleM2: 'team_memberships_role_m2_chk',
  invitationOnePendingPerTeamInvitee: 'team_invitations_one_pending_per_team_invitee_uniq',
  /** M2: invitations offer only PLAYER / SUBSTITUTE. */
  invitationRoleM2: 'team_invitations_role_m2_chk',
  registrationTournamentTeamUnique: 'tournament_registrations_tournament_id_team_id_key',
  rosterOneLockedPerRegistration: 'tournament_rosters_one_locked_per_registration_uniq',
  rosterEntryUserUnique: 'tournament_roster_entries_roster_id_user_id_key',
  rosterEntrySteamIdUnique: 'tournament_roster_entries_roster_id_steam_id64_snapshot_key',
  vetoMapOncePerMatch: 'map_veto_actions_map_once_per_match_uniq',
  allocationOneActivePerServer: 'server_allocations_one_active_per_server_uniq',
  allocationOneActivePerMatch: 'server_allocations_one_active_per_match_uniq',
  commandIdempotencyKeyUnique: 'server_command_requests_idempotency_key_key',
  matchEventSourceUnique: 'match_events_source_server_id_external_event_id_key',
  /** M2: one Idempotency-Key per user (docs/TEAMS.md §7). */
  idempotencyUserKeyUnique: 'idempotency_keys_user_key_uniq',
  idempotencyKeyFormat: 'idempotency_keys_key_format_chk',
  idempotencyRequestHashFormat: 'idempotency_keys_request_hash_chk',
  idempotencyMethod: 'idempotency_keys_method_chk',
  idempotencyCompletedResponse: 'idempotency_keys_completed_response_chk',
  idempotencyInProgressEmpty: 'idempotency_keys_in_progress_empty_chk',
  idempotencyResponseStatus2xx: 'idempotency_keys_response_status_2xx_chk',
  idempotencyExpiry: 'idempotency_keys_expiry_chk',

  // --- M3 tournaments (migration 20261114000000_m3_tournaments, docs/TOURNAMENTS.md) ---
  /** One active ban per SteamID64 → STEAM_ID_ALREADY_BANNED. */
  steamBanOneActivePerSteamId: 'banned_steam_ids_one_active_per_steam_id_uniq',
  steamBanSteamIdFormat: 'banned_steam_ids_steam_id64_format_chk',
  steamBanReasonNotBlank: 'banned_steam_ids_reason_not_blank_chk',
  steamBanLiftedFields: 'banned_steam_ids_lifted_fields_chk',
  steamBanLiftedAfterCreated: 'banned_steam_ids_lifted_after_created_chk',
  matchTransitionChangesStatus: 'match_state_transitions_changes_status_chk',
  matchTransitionAdminActor: 'match_state_transitions_admin_actor_chk',
  matchTransitionReasonNotBlank: 'match_state_transitions_reason_not_blank_chk',
  /** COMPLETED ⇒ result_source and winner_team_id set. */
  matchCompletedResult: 'matches_completed_result_chk',
  /** ADMIN_OVERRIDE / FORFEIT ⇒ result_verified_at IS NULL. */
  matchAdminResultUnverified: 'matches_admin_result_unverified_chk',
  matchForfeitNoScores: 'matches_forfeit_no_scores_chk',
  /** One match per bracket slot (init). */
  matchBracketSlotUnique: 'matches_bracket_slot_id_key',
  /** max_teams NULL or 2..64 (tightened in M3). */
  tournamentMaxTeams: 'tournaments_max_teams_chk',
  tournamentNameNotBlank: 'tournaments_name_not_blank_chk',
  /** Case-insensitive tournament name → TOURNAMENT_NAME_TAKEN. */
  tournamentNameCaseInsensitiveUnique: 'tournaments_name_ci_uniq',
  tournamentSlugUnique: 'tournaments_slug_key',
  registrationSeedPositive: 'tournament_registrations_seed_chk',
  /** Seeds unique among APPROVED registrations of a tournament → SEEDS_INVALID. */
  registrationApprovedSeedUnique: 'tournament_registrations_approved_seed_uniq',
  /** At most one DRAFT-or-LOCKED roster per registration. */
  rosterOneCurrentPerRegistration: 'tournament_rosters_one_current_per_registration_uniq',
  /** LOCKED ⇒ locked_at set; DRAFT ⇒ locked_at and locked_by NULL. */
  rosterLockedFields: 'tournament_rosters_locked_fields_chk',
  rosterChangeReasonNotBlank: 'tournament_rosters_change_reason_not_blank_chk',
  rosterVersionUnique: 'tournament_rosters_tournament_registration_id_version_key',
  rosterEntryNicknameNotBlank: 'tournament_roster_entries_nickname_not_blank_chk',
  /** Concurrent veto submissions for the same turn → one wins. */
  vetoSequenceUnique: 'map_veto_actions_match_id_sequence_key',
  vetoMapNameFormat: 'map_veto_actions_map_name_format_chk',
  matchMapNameUnique: 'match_maps_match_id_map_name_key',
  matchMapOrderUnique: 'match_maps_match_id_map_order_key',
  bracketSlotNumbers: 'bracket_slots_numbers_chk',
  bracketSlotNotSelf: 'bracket_slots_not_self_chk',
  bracketSlotNextPositionUnique: 'bracket_slots_next_position_uniq',
  bracketGenerationUnique: 'brackets_tournament_stage_id_generation_version_key',
  stageSequenceUnique: 'tournament_stages_tournament_id_sequence_key',
} as const;

export type DbConstraintName = (typeof DB_CONSTRAINTS)[keyof typeof DB_CONSTRAINTS];
