-- M3 security gate hardening (L-1, L-2 DB part): roster entry insert guard, frozen roster
-- provenance, immutable completed-match results, SERVER results only when verified, append-only
-- map veto log.
--
-- Forward-only, raw SQL only (no Prisma schema change: CHECKs and triggers are invisible to
-- `prisma migrate diff`). No data is dropped or rewritten. Runs as one implicit transaction: if an
-- existing row violates the new CHECK, nothing is applied.
-- Pre-flight (expect 0; run on 2026-11-15 against dev: 0):
--   SELECT count(*) FROM matches
--    WHERE status = 'COMPLETED' AND result_source = 'SERVER' AND result_verified_at IS NULL;
-- "winner is team A or team B" already exists since init as matches_winner_is_participant_chk
-- (identical definition), so it is not duplicated here.
-- Rollback (new migration): DROP TRIGGER tournament_roster_entries_insert_guard,
-- matches_completed_result_immutable, map_veto_actions_append_only(_truncate); DROP FUNCTION
-- rage_guard_tournament_roster_entry_insert(), rage_guard_completed_match(); restore the M3 body
-- of rage_guard_tournament_roster(); ALTER TABLE matches DROP CONSTRAINT
-- matches_server_result_verified_chk; remove map_veto_actions from APPEND_ONLY_TABLES and re-run
-- db:grants. See docs/SCHEMA.md ("M3 hardening").

-- ---------- matches: a SERVER result is COMPLETED only once verified ----------
ALTER TABLE "matches"
  ADD CONSTRAINT "matches_server_result_verified_chk" CHECK (
    "status" <> 'COMPLETED' OR "result_source" IS DISTINCT FROM 'SERVER' OR "result_verified_at" IS NOT NULL
  );

-- ---------- matches: completed results are immutable ----------
-- Once OLD.status = 'COMPLETED': winner, participants, scores, result_source and
-- result_verified_at cannot change, and the status may only stay COMPLETED or move to DISPUTED
-- (future dispute flow; result changes are allowed only together with that move).
CREATE FUNCTION "rage_guard_completed_match"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF coalesce(current_setting('rage.allow_append_only_maintenance', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'COMPLETED' OR NEW."status" = 'DISPUTED' THEN
    RETURN NEW;
  END IF;
  IF NEW."status" <> 'COMPLETED' THEN
    RAISE EXCEPTION 'rage: completed match % result is immutable; status % -> % is not allowed', OLD."id", OLD."status", NEW."status"
      USING ERRCODE = 'P0001', HINT = 'Only a move to DISPUTED may follow COMPLETED.';
  END IF;
  IF NEW."winner_team_id" IS DISTINCT FROM OLD."winner_team_id"
     OR NEW."team_a_id" IS DISTINCT FROM OLD."team_a_id"
     OR NEW."team_b_id" IS DISTINCT FROM OLD."team_b_id"
     OR NEW."team_a_score" IS DISTINCT FROM OLD."team_a_score"
     OR NEW."team_b_score" IS DISTINCT FROM OLD."team_b_score"
     OR NEW."result_source" IS DISTINCT FROM OLD."result_source"
     OR NEW."result_verified_at" IS DISTINCT FROM OLD."result_verified_at" THEN
    RAISE EXCEPTION 'rage: completed match % result is immutable; UPDATE of result fields is not allowed', OLD."id"
      USING ERRCODE = 'P0001', HINT = 'Open a dispute (status DISPUTED) to correct a result.';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER "matches_completed_result_immutable"
  BEFORE UPDATE ON "matches"
  FOR EACH ROW EXECUTE FUNCTION "rage_guard_completed_match"();

-- ---------- tournament_rosters: provenance frozen once the roster left DRAFT ----------
-- Same body as in 20261114000000_m3_tournaments plus: change_reason and supersedes_roster_id
-- cannot change once OLD.status <> 'DRAFT' (the API sets both at INSERT time,
-- apps/api/src/tournament-domain/rosters.ts writeRosterVersion).
CREATE OR REPLACE FUNCTION "rage_guard_tournament_roster"() RETURNS trigger
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
  IF OLD."status" <> 'DRAFT' AND (
       NEW."locked_at" IS DISTINCT FROM OLD."locked_at"
    OR NEW."locked_by" IS DISTINCT FROM OLD."locked_by"
    OR NEW."change_reason" IS DISTINCT FROM OLD."change_reason"
    OR NEW."supersedes_roster_id" IS DISTINCT FROM OLD."supersedes_roster_id") THEN
    RAISE EXCEPTION 'rage: tournament roster % is immutable; lock/provenance fields cannot change', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

-- ---------- tournament_roster_entries: inserts only into DRAFT or just-created rosters ----------
-- Allowed when the parent roster is DRAFT, or when the parent roster row version was written by
-- the current top-level transaction (a substitution inserts a LOCKED roster and then its entries).
-- xmin (32-bit xid) is compared for equality with the current top-level xid; equality between a
-- live row version and the running transaction is unambiguous despite wraparound. Fails closed
-- if the roster was inserted inside a savepoint (sub-transaction xid differs).
-- Note: a DRAFT roster locked earlier in the same transaction also matches; the API never inserts
-- entries after locking (approval only flips status).
CREATE FUNCTION "rage_guard_tournament_roster_entry_insert"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  roster_status text;
  roster_xmin xid;
BEGIN
  IF coalesce(current_setting('rage.allow_append_only_maintenance', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT r."status"::text, r.xmin INTO roster_status, roster_xmin
    FROM "tournament_rosters" r WHERE r."id" = NEW."roster_id" FOR SHARE;
  IF roster_status IS NULL THEN
    RETURN NEW; -- the FK reports the missing roster
  END IF;
  IF roster_status = 'DRAFT' OR roster_xmin = pg_current_xact_id()::xid THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rage: tournament roster % (%) is immutable; INSERT of entries is not allowed', NEW."roster_id", roster_status
    USING ERRCODE = 'P0001', HINT = 'Create a new roster version instead.';
END;
$fn$;

CREATE TRIGGER "tournament_roster_entries_insert_guard"
  BEFORE INSERT ON "tournament_roster_entries"
  FOR EACH ROW EXECUTE FUNCTION "rage_guard_tournament_roster_entry_insert"();

-- ---------- map_veto_actions: append-only ----------
-- Same mechanism as audit_logs / match_events / match_state_transitions; db:grants limits the
-- app role to SELECT/INSERT (APPEND_ONLY_TABLES).
CREATE TRIGGER "map_veto_actions_append_only"
  BEFORE UPDATE OR DELETE ON "map_veto_actions"
  FOR EACH ROW EXECUTE FUNCTION "rage_reject_append_only_mutation"();
CREATE TRIGGER "map_veto_actions_append_only_truncate"
  BEFORE TRUNCATE ON "map_veto_actions"
  FOR EACH STATEMENT EXECUTE FUNCTION "rage_reject_append_only_mutation"();
