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
- team_invitations(id, team_id, invitee_user_id, invited_by, role, status, expires_at, created_at, responded_at)
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
- matches(id, tournament_id, stage_id, bracket_slot_id, team_a_id, team_b_id, format, status, winner_team_id, scheduled_at, started_at, completed_at, result_verified_at, result_source) — M3: see below
- match_state_transitions, banned_steam_ids — M3: see below
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
- idempotency_keys(id, user_id, key, method, route, request_hash, status IN_PROGRESS|COMPLETED, response_status, response_body, created_at, expires_at, UNIQUE(user_id,key)) — M2, see below

## Indexing
Indexes on FK fields and timeline filters, latest matches per team/player, active/expiry invitation, application status, tournament + status, source server event ordering, active server allocation. Store recalculable aggregates separately; avoid prematurely materializing all leaderboards.

## M2 additions (migration `20261113000000_m2_teams`, ADR-019, `docs/TEAMS.md`)
Forward-only, non-destructive; constraint names are exported as `DB_CONSTRAINTS` from `@rage/db`.

| Object | Rule | Name |
|---|---|---|
| `idempotency_keys` (new) | one key per user | unique index `idempotency_keys_user_key_uniq` (`user_id`, `key`) |
| | key `^[A-Za-z0-9_-]{16,64}$` | `idempotency_keys_key_format_chk` |
| | `request_hash` lowercase hex SHA-256 | `idempotency_keys_request_hash_chk` |
| | method in POST/PUT/PATCH/DELETE; route not blank | `idempotency_keys_method_chk`, `idempotency_keys_route_not_blank_chk` |
| | COMPLETED ⇒ `response_status` set; IN_PROGRESS ⇒ no status/body; status 200–299 only | `idempotency_keys_completed_response_chk`, `idempotency_keys_in_progress_empty_chk`, `idempotency_keys_response_status_2xx_chk` |
| | `expires_at > created_at`; retention scan | `idempotency_keys_expiry_chk`, index `idempotency_keys_expires_at_idx` |
| | FK `user_id → users` ON DELETE RESTRICT | `idempotency_keys_user_id_fkey` |
| `team_applications` | PENDING tags unique case-insensitively | partial unique `team_applications_pending_tag_ci_uniq` (`lower(requested_tag)` WHERE PENDING) |
| `team_applications`, `teams` | tag `^[A-Za-z0-9]{2,10}$` (DB backstop; API enforces 2–6) | `team_applications_tag_format_chk`, `teams_tag_format_chk` |
| `team_memberships` | role ∈ CAPTAIN/PLAYER/SUBSTITUTE (enum keeps MANAGER/COACH, unused) | `team_memberships_role_m2_chk` |
| `team_invitations` | role ∈ PLAYER/SUBSTITUTE | `team_invitations_role_m2_chk` |
| `team_memberships` | roster history `WHERE team_id ORDER BY joined_at DESC, id DESC` | index `team_memberships_team_id_joined_at_id_idx` |

Notes
- `idempotency_keys` is **not** append-only: `rage_app` has SELECT/INSERT/UPDATE/DELETE (expired rows
  are overwritten in place, keyed by `(user_id, key)`). It is a convenience layer; correctness stays
  with the constraints and row locks above.
- Roster count uses the existing `team_memberships_team_id_left_at_idx` (`team_id`, `left_at`).
  Roster history must order by `joined_at DESC, id DESC`: a captain transfer opens two rows with the
  same `joined_at`, so `id` is the deterministic tie-breaker.
- Tag clashes between a PENDING application and an existing team are cross-table and checked by the
  API; at approval `teams_tag_ci_uniq` is the final arbiter.

### Deploy / rollback
- Deploy (as owner): `pnpm --filter @rage/db migrate:deploy`, then **always**
  `pnpm --filter @rage/db db:grants`. The file runs as one implicit transaction: if existing rows
  violate a new CHECK or the pending-tag unique index, nothing is applied. Pre-flight queries are in the
  migration header (all must return 0 rows/0 count).
- Rollback is a new forward migration (never edit an applied one): `DROP TABLE idempotency_keys;
  DROP TYPE "IdempotencyStatus"; DROP INDEX team_applications_pending_tag_ci_uniq,
  team_memberships_team_id_joined_at_id_idx;` and `ALTER TABLE … DROP CONSTRAINT` for the five CHECKs,
  with the matching `schema.prisma` revert. Dropping `idempotency_keys` loses only ≤ 24 h of replay
  data, no business data.

## M3 additions (migration `20261114000000_m3_tournaments`, ADR-020, ADR-018 Q5, `docs/TOURNAMENTS.md`)
Forward-only; no table, column or row is dropped. Constraint names are exported as `DB_CONSTRAINTS`
from `@rage/db`.

- banned_steam_ids(id, steam_id64, reason, created_by → users, created_at, lifted_at, lifted_by → users, lift_reason) — new
- match_state_transitions(id, match_id → matches, from_status NULL, to_status, source ADMIN|SYSTEM|SERVER, actor_user_id NULL, reason NULL, created_at) — new, **append-only**
- matches.result_source `MatchResultSource` (SERVER | ADMIN_OVERRIDE | FORFEIT), nullable — new column
- `MatchStatus` = CREATED, SERVER_ASSIGNED, PREPARING, WARMUP, READY_CHECK, LIVE, PAUSED, COMPLETED, CANCELLED, FAILED, DISPUTED (KNIFE / MAP_FINISHED removed; map-level states stay in `MatchMapStatus`)

| Object | Rule | Name |
|---|---|---|
| `banned_steam_ids` | one active ban per SteamID64 (also the ban lookup index) | partial unique `banned_steam_ids_one_active_per_steam_id_uniq` (`steam_id64` WHERE `lifted_at IS NULL`) |
| | `^[0-9]{17}$`; reason not blank | `banned_steam_ids_steam_id64_format_chk`, `banned_steam_ids_reason_not_blank_chk` |
| | lifted_at / lifted_by / non-blank lift_reason all set or all NULL; lifted_at ≥ created_at | `banned_steam_ids_lifted_fields_chk`, `banned_steam_ids_lifted_after_created_chk` |
| `match_state_transitions` | to ≠ from; ADMIN ⇒ actor set; reason not blank | `match_state_transitions_changes_status_chk`, `…_admin_actor_chk`, `…_reason_not_blank_chk` |
| | append-only (UPDATE/DELETE/TRUNCATE rejected; `rage_app` SELECT/INSERT only) | triggers `match_state_transitions_append_only`, `…_append_only_truncate`; `APPEND_ONLY_TABLES` in `grants.ts` |
| | history per match | index `match_state_transitions_match_id_created_at_idx` |
| `matches` | COMPLETED ⇒ `result_source` and `winner_team_id` set | `matches_completed_result_chk` |
| | ADMIN_OVERRIDE / FORFEIT ⇒ `result_verified_at IS NULL` | `matches_admin_result_unverified_chk` |
| | FORFEIT ⇒ no scores | `matches_forfeit_no_scores_chk` |
| | one match per bracket slot (init) | `matches_bracket_slot_id_key` |
| `tournaments` | `max_teams` NULL or 2..64 (was ≥ 2; redefined under the same name) | `tournaments_max_teams_chk` |
| | name unique case-insensitively; not blank | unique index `tournaments_name_ci_uniq` (`lower(name)`), `tournaments_name_not_blank_chk` |
| `tournament_registrations` | seed ≥ 1 (init) | `tournament_registrations_seed_chk` |
| | seed unique among APPROVED of a tournament | partial unique `tournament_registrations_approved_seed_uniq` |
| `tournament_rosters` | one current (DRAFT or LOCKED) roster per registration | partial unique `tournament_rosters_one_current_per_registration_uniq` (init `…_one_locked_per_registration_uniq` kept) |
| | LOCKED ⇒ `locked_at`; DRAFT ⇒ `locked_at`, `locked_by` NULL (replaces init `tournament_rosters_locked_at_chk`, which forbade DRAFT → SUPERSEDED) | `tournament_rosters_locked_fields_chk` |
| | change_reason not blank | `tournament_rosters_change_reason_not_blank_chk` |
| | status only DRAFT → LOCKED/SUPERSEDED, LOCKED → SUPERSEDED; registration/version/id/created_at immutable; supersedes_roster_id set once; lock fields frozen after DRAFT; only DRAFT rows deletable | trigger `tournament_rosters_immutable` (fn `rage_guard_tournament_roster`) |
| `tournament_roster_entries` | never updated (no-op UPDATE tolerated); entries of a non-DRAFT roster never deleted; no TRUNCATE | triggers `tournament_roster_entries_immutable`, `…_immutable_truncate` (fn `rage_guard_tournament_roster_entry`) |
| | nickname snapshot not blank | `tournament_roster_entries_nickname_not_blank_chk` |
| `map_veto_actions` | map_name `^de_[a-z0-9_]{2,30}$` | `map_veto_actions_map_name_format_chk` |
| | BAN/PICK/DECIDER once per map (init; SIDE_PICK excluded on purpose); one action per sequence (init) | `map_veto_actions_map_once_per_match_uniq`, `map_veto_actions_match_id_sequence_key` |
| `match_maps` | a map once per match | unique `match_maps_match_id_map_name_key` |
| `bracket_slots` | round/slot ≥ 1, no self-link, one winner per (next slot, position) (all init) | `bracket_slots_numbers_chk`, `bracket_slots_not_self_chk`, `bracket_slots_next_position_uniq` |

Notes for writers (API)
- **Roster versions:** mark the previous version `SUPERSEDED` *before* inserting the next `DRAFT` /
  `LOCKED` version (the one-current index is checked per row). Never UPDATE entries; create a new version.
- **Re-seeding:** the seed unique index is not deferrable; clear the tournament's seeds
  (`UPDATE … SET seed = NULL WHERE tournament_id = $1 AND status = 'APPROVED'`) and assign the new ones in
  the same transaction.
- **Results:** `COMPLETED` must be written together with `result_source` and `winner_team_id` in the same
  UPDATE. Forfeits leave `team_a_score` / `team_b_score` NULL.
- `getDbViolation()` returns `kind: 'immutable'` for the roster guards and `'append_only'` for
  `match_state_transitions` (both SQLSTATE P0001).
- A ban is keyed by SteamID64, not `users.id`, so a SteamID can be banned before it ever signs in.
- Maintenance on any guarded table: in one transaction, `SET LOCAL rage.allow_append_only_maintenance = 'on'`
  (owner only; `rage_app` lacks UPDATE/DELETE on append-only tables regardless).
- No format CHECK on `match_maps.map_name`: maps reported by a real server (M4) may use other prefixes.

Query plans (dev, PostgreSQL 18.6, `enable_seqscan = off` because the tables are tiny; 2026-11-14):
eligibility ("already on another team's current roster in this tournament") →
`tournament_registrations_tournament_id_team_id_key` → `tournament_rosters_one_current_per_registration_uniq`
→ index-only `tournament_roster_entries_roster_id_user_id_key`; active-ban lookup → index-only
`banned_steam_ids_one_active_per_steam_id_uniq`; approved count → `tournament_registrations_tournament_id_team_id_key`
(+ status filter); transition history → `match_state_transitions_match_id_created_at_idx`; name check →
`tournaments_name_ci_uniq`.

### Deploy / rollback
- Deploy (as owner): `pnpm --filter @rage/db migrate:deploy`, then **always** `pnpm --filter @rage/db db:grants`
  (adds `match_state_transitions` to the append-only privilege set). The file runs as one implicit
  transaction. It starts with a pre-flight `DO` block that aborts if any `matches.status` is KNIFE or
  MAP_FINISHED (or if another column uses `MatchStatus`); fix such rows first (series state in
  `matches.status`, map state in `match_maps.status`). Other pre-flight queries are in the migration header.
- Enum change: Prisma's swap (create `MatchStatus_new`, `ALTER COLUMN … TYPE … USING status::text::…`,
  rename, drop old, restore default) runs **inside** the migration transaction — Prisma's own inner
  `BEGIN/COMMIT` was removed, and `match_state_transitions` is created after the swap.
  `ALTER COLUMN TYPE` rewrites `matches` under an ACCESS EXCLUSIVE lock (fine at current size; schedule a
  window for large tables). Verified by `m3-tournaments.int.test.ts`, which replays init → M2 in an
  isolated schema, proves the pre-flight aborts atomically, then applies M3 without row loss.
- Rollback is a new forward migration: drop `match_state_transitions`, `banned_steam_ids`,
  `matches.result_source` (export first: it is result provenance), the two new enum types, the roster
  triggers and guard functions, and the new indexes/CHECKs above; re-add `tournament_rosters_locked_at_chk`
  only after confirming no never-locked SUPERSEDED rows exist; restore `tournaments_max_teams_chk` as
  `>= 2`. Re-adding KNIFE / MAP_FINISHED is `ALTER TYPE "MatchStatus" ADD VALUE …` (non-destructive).
