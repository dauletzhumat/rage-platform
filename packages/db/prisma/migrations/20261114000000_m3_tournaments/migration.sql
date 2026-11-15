-- M3 tournaments (docs/TOURNAMENTS.md, ADR-020, ADR-018 Q5): SteamID64 bans, match state
-- transition log (append-only), match result source, removal of the series states KNIFE and
-- MAP_FINISHED from "MatchStatus", registration/roster/veto/map integrity constraints and
-- roster snapshot immutability triggers.
--
-- Forward-only. No table, column or row is dropped or rewritten. The only type change is the
-- "MatchStatus" enum swap, which is guarded by a pre-flight check that aborts the migration if
-- any row still uses KNIFE / MAP_FINISHED. The whole file runs as one implicit transaction
-- (Prisma sends it as a single multi-statement query; Prisma's own BEGIN/COMMIT around the enum
-- swap were removed on purpose so that the swap cannot commit separately from the rest). If any
-- existing row violates a new CHECK / unique index the migration fails as a whole and nothing is
-- applied.
--
-- Pre-flight queries (expect 0 rows / count 0 everywhere; run on 2026-11-14 against dev: all 0):
--   SELECT status, count(*) FROM matches WHERE status::text IN ('KNIFE','MAP_FINISHED') GROUP BY 1;
--   SELECT count(*) FROM matches WHERE status = 'COMPLETED';          -- would need result_source
--   SELECT count(*) FROM tournaments WHERE max_teams > 64;
--   SELECT lower(name), count(*) FROM tournaments GROUP BY 1 HAVING count(*) > 1;
--   SELECT tournament_id, seed, count(*) FROM tournament_registrations
--    WHERE status = 'APPROVED' AND seed IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT tournament_registration_id, count(*) FROM tournament_rosters
--    WHERE status IN ('DRAFT','LOCKED') GROUP BY 1 HAVING count(*) > 1;
--   SELECT count(*) FROM tournament_rosters WHERE (status = 'LOCKED' AND locked_at IS NULL)
--      OR (status = 'DRAFT' AND (locked_at IS NOT NULL OR locked_by IS NOT NULL));
--   SELECT count(*) FROM map_veto_actions WHERE map_name !~ '^de_[a-z0-9_]{2,30}$';
--   SELECT match_id, map_name, count(*) FROM match_maps GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Rollback (manual, as a NEW migration; never edit this file once applied):
--   DROP TABLE "match_state_transitions"; DROP TABLE "banned_steam_ids";
--   ALTER TABLE "matches" DROP COLUMN "result_source";   -- loses result provenance: export first
--   DROP TYPE "MatchResultSource"; DROP TYPE "MatchTransitionSource";
--   DROP TRIGGER the four roster triggers; DROP FUNCTION the two guard functions;
--   DROP INDEX / DROP CONSTRAINT the objects listed in docs/SCHEMA.md ("M3 migration");
--   re-add "tournament_rosters_locked_at_chk" / the old "tournaments_max_teams_chk" (>= 2);
--   re-adding KNIFE / MAP_FINISHED: ALTER TYPE "MatchStatus" ADD VALUE ... (non-destructive).
-- See docs/SCHEMA.md ("M3 migration").

-- ============================================================================
-- Pre-flight: refuse to drop enum values that are still in use.
-- ============================================================================
DO $preflight$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM "matches" WHERE "status"::text IN ('KNIFE', 'MAP_FINISHED');
  IF bad > 0 THEN
    RAISE EXCEPTION 'rage m3: % match row(s) still use MatchStatus KNIFE/MAP_FINISHED; migrate them to a series state (and record the map state in match_maps.status) before deploying', bad
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO bad FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
   WHERE a.atttypid = '"MatchStatus"'::regtype AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
     AND NOT (c.relname = 'matches' AND a.attname = 'status');
  IF bad > 0 THEN
    RAISE EXCEPTION 'rage m3: unexpected column(s) typed "MatchStatus" outside matches.status; extend this migration'
      USING ERRCODE = 'P0001';
  END IF;
END
$preflight$;

-- ============================================================================
-- Prisma-generated part (equivalent to `prisma migrate diff`; reordered so that the enum swap
-- runs before match_state_transitions exists, and without Prisma's inner BEGIN/COMMIT).
-- ============================================================================

-- CreateEnum
CREATE TYPE "MatchTransitionSource" AS ENUM ('ADMIN', 'SYSTEM', 'SERVER');

-- CreateEnum
CREATE TYPE "MatchResultSource" AS ENUM ('SERVER', 'ADMIN_OVERRIDE', 'FORFEIT');

-- AlterEnum (remove KNIFE, MAP_FINISHED; ADR-018 Q5)
CREATE TYPE "MatchStatus_new" AS ENUM ('CREATED', 'SERVER_ASSIGNED', 'PREPARING', 'WARMUP', 'READY_CHECK', 'LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED', 'DISPUTED');
ALTER TABLE "matches" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "matches" ALTER COLUMN "status" TYPE "MatchStatus_new" USING ("status"::text::"MatchStatus_new");
ALTER TYPE "MatchStatus" RENAME TO "MatchStatus_old";
ALTER TYPE "MatchStatus_new" RENAME TO "MatchStatus";
DROP TYPE "MatchStatus_old";
ALTER TABLE "matches" ALTER COLUMN "status" SET DEFAULT 'CREATED';

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "result_source" "MatchResultSource";

-- CreateTable
CREATE TABLE "banned_steam_ids" (
    "id" UUID NOT NULL,
    "steam_id64" VARCHAR(17) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMPTZ(6),
    "lifted_by" UUID,
    "lift_reason" TEXT,

    CONSTRAINT "banned_steam_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_state_transitions" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "from_status" "MatchStatus",
    "to_status" "MatchStatus" NOT NULL,
    "source" "MatchTransitionSource" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_state_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banned_steam_ids_created_by_idx" ON "banned_steam_ids"("created_by");

-- CreateIndex
CREATE INDEX "banned_steam_ids_lifted_by_idx" ON "banned_steam_ids"("lifted_by");

-- CreateIndex
CREATE INDEX "banned_steam_ids_created_at_idx" ON "banned_steam_ids"("created_at");

-- CreateIndex
CREATE INDEX "match_state_transitions_match_id_created_at_idx" ON "match_state_transitions"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "match_state_transitions_actor_user_id_idx" ON "match_state_transitions"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_maps_match_id_map_name_key" ON "match_maps"("match_id", "map_name");

-- AddForeignKey
ALTER TABLE "banned_steam_ids" ADD CONSTRAINT "banned_steam_ids_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banned_steam_ids" ADD CONSTRAINT "banned_steam_ids_lifted_by_fkey" FOREIGN KEY ("lifted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_state_transitions" ADD CONSTRAINT "match_state_transitions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_state_transitions" ADD CONSTRAINT "match_state_transitions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- RAGE raw SQL: constraints Prisma schema cannot express.
-- Keep in sync with src/constraints.ts, docs/SCHEMA.md and test/m3-tournaments.int.test.ts.
-- ============================================================================

-- ---------- Banned SteamID64s (TOURNAMENTS.md §5) ----------
ALTER TABLE "banned_steam_ids"
  ADD CONSTRAINT "banned_steam_ids_steam_id64_format_chk" CHECK ("steam_id64" ~ '^[0-9]{17}$'),
  ADD CONSTRAINT "banned_steam_ids_reason_not_blank_chk" CHECK (length(btrim("reason")) > 0),
  -- Lifted ⇔ lifted_at, lifted_by and a non-blank lift_reason are all present.
  ADD CONSTRAINT "banned_steam_ids_lifted_fields_chk" CHECK (
    ("lifted_at" IS NULL AND "lifted_by" IS NULL AND "lift_reason" IS NULL)
    OR ("lifted_at" IS NOT NULL AND "lifted_by" IS NOT NULL AND length(btrim(coalesce("lift_reason", ''))) > 0)
  ),
  ADD CONSTRAINT "banned_steam_ids_lifted_after_created_chk" CHECK ("lifted_at" IS NULL OR "lifted_at" >= "created_at");
-- One active ban per SteamID64 (also the index for "is this SteamID banned?" lookups).
CREATE UNIQUE INDEX "banned_steam_ids_one_active_per_steam_id_uniq"
  ON "banned_steam_ids" ("steam_id64") WHERE "lifted_at" IS NULL;

-- ---------- Match state transitions (TOURNAMENTS.md §7) ----------
ALTER TABLE "match_state_transitions"
  ADD CONSTRAINT "match_state_transitions_changes_status_chk" CHECK ("from_status" IS DISTINCT FROM "to_status"),
  ADD CONSTRAINT "match_state_transitions_admin_actor_chk" CHECK ("source" <> 'ADMIN' OR "actor_user_id" IS NOT NULL),
  ADD CONSTRAINT "match_state_transitions_reason_not_blank_chk" CHECK ("reason" IS NULL OR length(btrim("reason")) > 0);
-- Append-only, same mechanism and maintenance escape hatch as audit_logs / match_events (init).
-- db:grants additionally limits the app role to SELECT/INSERT (APPEND_ONLY_TABLES).
CREATE TRIGGER "match_state_transitions_append_only"
  BEFORE UPDATE OR DELETE ON "match_state_transitions"
  FOR EACH ROW EXECUTE FUNCTION "rage_reject_append_only_mutation"();
CREATE TRIGGER "match_state_transitions_append_only_truncate"
  BEFORE TRUNCATE ON "match_state_transitions"
  FOR EACH STATEMENT EXECUTE FUNCTION "rage_reject_append_only_mutation"();

-- ---------- Match results (TOURNAMENTS.md §1, §9) ----------
ALTER TABLE "matches"
  -- A completed series always records who won and where the result came from.
  ADD CONSTRAINT "matches_completed_result_chk" CHECK ("status" <> 'COMPLETED' OR ("result_source" IS NOT NULL AND "winner_team_id" IS NOT NULL)),
  -- Admin / forfeit results are never presented as server-verified.
  ADD CONSTRAINT "matches_admin_result_unverified_chk" CHECK ("result_source" IS NULL OR "result_source" = 'SERVER' OR "result_verified_at" IS NULL),
  -- A forfeit has no map score.
  ADD CONSTRAINT "matches_forfeit_no_scores_chk" CHECK ("result_source" IS DISTINCT FROM 'FORFEIT' OR ("team_a_score" IS NULL AND "team_b_score" IS NULL));

-- ---------- Tournaments (TOURNAMENTS.md §3.1) ----------
-- maxTeams 2..64 (was: >= 2). Redefined under the same name.
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_max_teams_chk";
ALTER TABLE "tournaments"
  ADD CONSTRAINT "tournaments_max_teams_chk" CHECK ("max_teams" IS NULL OR "max_teams" BETWEEN 2 AND 64),
  ADD CONSTRAINT "tournaments_name_not_blank_chk" CHECK (length(btrim("name")) > 0);
CREATE UNIQUE INDEX "tournaments_name_ci_uniq" ON "tournaments" (lower("name"));

-- ---------- Registrations (TOURNAMENTS.md §4, §6) ----------
-- (tournament_registrations_seed_chk "seed IS NULL OR seed >= 1" exists since init.)
-- Seeds are unique among APPROVED registrations of a tournament. Non-deferrable: when re-seeding,
-- clear the tournament's seeds first (UPDATE ... SET seed = NULL) and then assign the new ones.
CREATE UNIQUE INDEX "tournament_registrations_approved_seed_uniq"
  ON "tournament_registrations" ("tournament_id", "seed") WHERE "status" = 'APPROVED' AND "seed" IS NOT NULL;

-- ---------- Roster snapshots (TOURNAMENTS.md §1, §4; acceptance A5) ----------
-- At most one current (DRAFT or LOCKED) roster per registration. Writers must mark the previous
-- version SUPERSEDED before inserting the next one. (The init index
-- tournament_rosters_one_locked_per_registration_uniq stays; it is implied by this one.)
CREATE UNIQUE INDEX "tournament_rosters_one_current_per_registration_uniq"
  ON "tournament_rosters" ("tournament_registration_id") WHERE "status" IN ('DRAFT', 'LOCKED');
-- The init CHECK (status = 'DRAFT' OR locked_at IS NOT NULL) forbade superseding a never-locked
-- DRAFT (required by PUT .../roster). Replaced by: LOCKED ⇒ locked_at set; DRAFT ⇒ locked_at and
-- locked_by NULL; SUPERSEDED keeps whatever the version had. (locked_by is set by the API on
-- approval/substitution; it is not required here so that system-locked rosters stay possible.)
ALTER TABLE "tournament_rosters" DROP CONSTRAINT "tournament_rosters_locked_at_chk";
ALTER TABLE "tournament_rosters"
  ADD CONSTRAINT "tournament_rosters_locked_fields_chk" CHECK (
    ("status" <> 'LOCKED' OR "locked_at" IS NOT NULL)
    AND ("status" <> 'DRAFT' OR ("locked_at" IS NULL AND "locked_by" IS NULL))
  ),
  ADD CONSTRAINT "tournament_rosters_change_reason_not_blank_chk" CHECK ("change_reason" IS NULL OR length(btrim("change_reason")) > 0);

ALTER TABLE "tournament_roster_entries"
  ADD CONSTRAINT "tournament_roster_entries_nickname_not_blank_chk" CHECK (length(btrim("nickname_snapshot")) > 0);

-- Snapshot immutability (defence in depth for the service rules; same maintenance escape hatch
-- as the append-only tables: SET LOCAL rage.allow_append_only_maintenance = 'on').
--   tournament_rosters: registration/version immutable; supersedes_roster_id set once; status
--     only DRAFT → LOCKED | SUPERSEDED and LOCKED → SUPERSEDED; locked_at/locked_by frozen once
--     the roster left DRAFT; only DRAFT rosters may be deleted.
--   tournament_roster_entries: rows are never updated (a no-op UPDATE is tolerated); rows of a
--     non-DRAFT roster are never deleted. New versions are new rows.
CREATE FUNCTION "rage_guard_tournament_roster"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF coalesce(current_setting('rage.allow_append_only_maintenance', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'rage: tournament roster % (%) is immutable; DELETE is not allowed', OLD."id", OLD."status"
        USING ERRCODE = 'P0001', HINT = 'Supersede the roster with a new version instead.';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."tournament_registration_id" IS DISTINCT FROM OLD."tournament_registration_id"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR (OLD."supersedes_roster_id" IS NOT NULL AND NEW."supersedes_roster_id" IS DISTINCT FROM OLD."supersedes_roster_id") THEN
    RAISE EXCEPTION 'rage: tournament roster % is immutable; identity/version columns cannot change', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('LOCKED', 'SUPERSEDED'))
    OR (OLD."status" = 'LOCKED' AND NEW."status" = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'rage: tournament roster % is immutable; status % -> % is not allowed', OLD."id", OLD."status", NEW."status"
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (NEW."locked_at" IS DISTINCT FROM OLD."locked_at" OR NEW."locked_by" IS DISTINCT FROM OLD."locked_by") THEN
    RAISE EXCEPTION 'rage: tournament roster % is immutable; lock fields cannot change', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION "rage_guard_tournament_roster_entry"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  roster_status text;
BEGIN
  IF coalesce(current_setting('rage.allow_append_only_maintenance', true), '') = 'on' THEN
    IF TG_LEVEL = 'STATEMENT' THEN RETURN NULL; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_LEVEL = 'STATEMENT' THEN
    RAISE EXCEPTION 'rage: tournament roster entries are immutable; TRUNCATE is not allowed'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'rage: tournament roster entry % is immutable; UPDATE is not allowed', OLD."id"
        USING ERRCODE = 'P0001', HINT = 'Create a new roster version instead.';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE: only entries of a DRAFT roster (lock the parent row to serialise with locking).
  SELECT r."status"::text INTO roster_status FROM "tournament_rosters" r WHERE r."id" = OLD."roster_id" FOR SHARE;
  IF roster_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'rage: tournament roster entry % is immutable (roster %); DELETE is not allowed', OLD."id", roster_status
      USING ERRCODE = 'P0001', HINT = 'Create a new roster version instead.';
  END IF;
  RETURN OLD;
END;
$fn$;

CREATE TRIGGER "tournament_rosters_immutable"
  BEFORE UPDATE OR DELETE ON "tournament_rosters"
  FOR EACH ROW EXECUTE FUNCTION "rage_guard_tournament_roster"();
CREATE TRIGGER "tournament_roster_entries_immutable"
  BEFORE UPDATE OR DELETE ON "tournament_roster_entries"
  FOR EACH ROW EXECUTE FUNCTION "rage_guard_tournament_roster_entry"();
CREATE TRIGGER "tournament_roster_entries_immutable_truncate"
  BEFORE TRUNCATE ON "tournament_roster_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "rage_guard_tournament_roster_entry"();

-- ---------- Map veto and maps (TOURNAMENTS.md §8) ----------
-- (map_veto_actions_map_once_per_match_uniq — a map is BAN/PICK/DECIDER at most once per match —
-- exists since init; SIDE_PICK is deliberately excluded because it names an already picked map.)
ALTER TABLE "map_veto_actions"
  ADD CONSTRAINT "map_veto_actions_map_name_format_chk" CHECK ("map_name" ~ '^de_[a-z0-9_]{2,30}$');
-- match_maps (match_id, map_name) unique: created above (Prisma @@unique).
-- No format CHECK on match_maps.map_name: maps played on a real server (M4) are reported by the
-- server and may legitimately use other prefixes (e.g. workshop / cs_ maps).

-- ---------- Bracket slots ----------
-- round_number >= 1, slot_number >= 1 (bracket_slots_numbers_chk), next_slot_id <> id
-- (bracket_slots_not_self_chk), one winner per (next_slot, position) and one match per slot
-- (matches_bracket_slot_id_key) exist since init.
