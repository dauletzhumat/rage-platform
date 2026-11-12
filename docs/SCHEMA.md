# Proposed PostgreSQL / Prisma data model

Use UUID keys, timestamptz, foreign keys, partial unique indexes where supported, check constraints, row-level transactions where needed. Prisma migrations may use raw SQL for partial unique constraints. Use soft deletion only when business rules require it; retain audited history.

## Identity
- users(id, steam_id64 UNIQUE NOT NULL, created_at, last_login_at, status)
- auth_sessions(id, user_id, token_hash, expires_at, revoked_at, created_at)
- steam_profiles(user_id UNIQUE, steam_display_name, avatar_url, synced_at, privacy_status)
- player_profiles(id, user_id UNIQUE, nickname, country_code, biography, slug UNIQUE)
- user_role_grants(id, user_id, role, scope_type, scope_id, issued_by, revoked_at)

## Teams
- team_applications(id, applicant_user_id, requested_name, requested_tag, requested_slug, country_code, description, logo_key, status, reviewed_by, reviewed_at, review_reason, created_at)
- teams(id, slug UNIQUE, name UNIQUE, tag, country_code, region, logo_key, description, status, created_at)
- team_memberships(id, team_id, user_id, role, joined_at, left_at, invited_by, unique active membership rules)
- team_invitations(id, team_id, invitee_user_id, invited_by, status, expires_at, created_at, responded_at)
- team_staff(id, team_id, user_id, role, valid_from, valid_to)
- team_achievements(id, team_id, tournament_id, placement, prize_amount, currency_code)
- team_ranking_snapshots(id, team_id, rank, region, algorithm_version, points, calculated_at)

## Tournament
- tournaments(id, slug UNIQUE, name, format, status, registration_open_at, registration_close_at, starts_at, settings_json)
- tournament_stages(id, tournament_id, name, format, sequence)
- tournament_registrations(id, tournament_id, team_id, requested_by, status, reviewed_by, reviewed_at, UNIQUE(tournament_id,team_id))
- tournament_rosters(id, tournament_registration_id, locked_at, version, status)
- tournament_roster_entries(id, roster_id, user_id, steam_id64_snapshot, nickname_snapshot, role, UNIQUE(roster_id,user_id))
- brackets(id, tournament_stage_id, generation_version, created_at)
- bracket_slots(id, bracket_id, round_number, slot_number, next_slot_id, source_match_id)
- matches(id, tournament_id, stage_id, bracket_slot_id, team_a_id, team_b_id, format, status, winner_team_id, scheduled_at, started_at, completed_at, result_verified_at)
- match_rosters(id, match_id, team_id, tournament_roster_id, frozen_at)
- match_maps(id, match_id, map_order, map_name, status, team_a_score, team_b_score, winner_team_id, started_at, completed_at)
- match_map_players(id, match_map_id, user_id, team_id, steam_id64_snapshot, nickname_snapshot, side_initial)
- map_veto_actions(id, match_id, sequence, actor_team_id, action, map_name, created_at)
- match_rounds(id, match_map_id, round_number, winning_team_id, win_reason, started_at, ended_at)

## Game servers and observability
- game_servers(id, name, provider_type, address, game_port, region, enabled, status)
- server_agents(id, game_server_id, agent_identity, version, last_heartbeat_at, status)
- server_allocations(id, server_id, match_id, lease_expires_at, allocated_at, released_at)
- server_command_requests(id, server_id, match_id, actor_user_id, command_type, payload, state, deadline, ack_at, error_message)
- match_events(id, source_server_id, external_event_id, match_id, match_map_id, event_type, tick, sequence, payload_json, occurred_at, received_at, UNIQUE(source_server_id,external_event_id))
- player_map_stats(id, match_map_id, user_id, team_id, kills, deaths, assists, headshots, damage, rounds_played, kast_rounds, opening_kills, opening_deaths, utility_damage, clutch_wins, rating_value, rating_version, UNIQUE(match_map_id,user_id))
- player_round_stats(id, match_round_id, user_id, kills, deaths, assists, damage, kast_flags, survived, traded)
- team_map_stats(id, match_map_id, team_id, rounds_won, ct_rounds_won, t_rounds_won, UNIQUE(match_map_id,team_id))
- demos(id, match_map_id, object_key, sha256, bytes, status, parser_version, uploaded_at, processed_at)
- audit_logs(id, actor_user_id, action, resource_type, resource_id, detail_json, created_at)
- outbox_events(id, topic, resource_id, payload_json, published_at, attempts, created_at)

## Indexing
Indexes on FK fields and timeline filters, latest matches per team/player, active/expiry invitation, application status, tournament + status, source server event ordering, active server allocation. Store recalculable aggregates separately; avoid prematurely materializing all leaderboards.
