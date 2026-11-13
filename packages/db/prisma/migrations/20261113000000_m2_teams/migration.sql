-- M2 teams (docs/TEAMS.md, ADR-019): idempotency keys, pending-tag uniqueness, membership/invitation
-- role restrictions, tag format backstop, roster-history index.
--
-- Forward-only and non-destructive: no data is dropped or rewritten. The whole file runs as one
-- implicit transaction (Prisma sends it as a single multi-statement query), so if any existing row
-- violates a new CHECK / unique index the migration fails as a whole and nothing is applied.
-- Pre-flight query to find offending rows before deploying (expect 0 everywhere):
--   SELECT count(*) FROM teams WHERE tag !~ '^[A-Za-z0-9]{2,10}$';
--   SELECT count(*) FROM team_applications WHERE requested_tag !~ '^[A-Za-z0-9]{2,10}$';
--   SELECT count(*) FROM team_memberships WHERE role NOT IN ('CAPTAIN','PLAYER','SUBSTITUTE');
--   SELECT count(*) FROM team_invitations WHERE role NOT IN ('PLAYER','SUBSTITUTE');
--   SELECT lower(requested_tag), count(*) FROM team_applications
--    WHERE status = 'PENDING' GROUP BY 1 HAVING count(*) > 1;
-- Rollback (manual, new migration): DROP TABLE "idempotency_keys"; DROP TYPE "IdempotencyStatus";
-- DROP INDEX the two new indexes; ALTER TABLE ... DROP CONSTRAINT for the CHECKs below.
-- See docs/SCHEMA.md ("M2 migration").

-- ============================================================================
-- Prisma-generated part (must stay identical to `prisma migrate diff`).
-- ============================================================================

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "route" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_key_uniq" ON "idempotency_keys"("user_id", "key");

-- CreateIndex
CREATE INDEX "team_memberships_team_id_joined_at_id_idx" ON "team_memberships"("team_id", "joined_at" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- RAGE raw SQL: constraints Prisma schema cannot express.
-- Keep in sync with src/constraints.ts, packages/db/README.md and test/m2-teams.int.test.ts.
-- ============================================================================

-- ---------- Idempotency keys ----------
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_key_format_chk" CHECK ("key" ~ '^[A-Za-z0-9_-]{16,64}$'),
  ADD CONSTRAINT "idempotency_keys_request_hash_chk" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  -- Only unsafe methods carry an Idempotency-Key.
  ADD CONSTRAINT "idempotency_keys_method_chk" CHECK ("method" IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  ADD CONSTRAINT "idempotency_keys_route_not_blank_chk" CHECK (length(btrim("route")) > 0),
  -- COMPLETED rows always carry the stored (2xx-only) status; IN_PROGRESS rows carry no response.
  ADD CONSTRAINT "idempotency_keys_completed_response_chk" CHECK ("status" <> 'COMPLETED' OR "response_status" IS NOT NULL),
  ADD CONSTRAINT "idempotency_keys_in_progress_empty_chk" CHECK ("status" <> 'IN_PROGRESS' OR ("response_status" IS NULL AND "response_body" IS NULL)),
  ADD CONSTRAINT "idempotency_keys_response_status_2xx_chk" CHECK ("response_status" IS NULL OR "response_status" BETWEEN 200 AND 299),
  ADD CONSTRAINT "idempotency_keys_expiry_chk" CHECK ("expires_at" > "created_at");

-- ---------- Team applications ----------
-- No two PENDING applications competing for the same tag (case-insensitive). Clashes with an
-- existing team's tag are checked by the API and, at approval, by teams_tag_ci_uniq.
CREATE UNIQUE INDEX "team_applications_pending_tag_ci_uniq"
  ON "team_applications" (lower("requested_tag")) WHERE "status" = 'PENDING';
-- Tag format backstop (API enforces the stricter 2-6 chars policy, ADR-019).
ALTER TABLE "team_applications"
  ADD CONSTRAINT "team_applications_tag_format_chk" CHECK ("requested_tag" ~ '^[A-Za-z0-9]{2,10}$');

-- ---------- Teams ----------
ALTER TABLE "teams"
  ADD CONSTRAINT "teams_tag_format_chk" CHECK ("tag" ~ '^[A-Za-z0-9]{2,10}$');

-- ---------- Memberships / invitations: roles used in M2 (ADR-019) ----------
-- MANAGER/COACH stay in the MembershipRole enum (no destructive enum change) but are not valid
-- for memberships or invitations: managers are TEAM_MANAGER grants, coaches are team_staff.
ALTER TABLE "team_memberships"
  ADD CONSTRAINT "team_memberships_role_m2_chk" CHECK ("role" IN ('CAPTAIN', 'PLAYER', 'SUBSTITUTE'));
ALTER TABLE "team_invitations"
  ADD CONSTRAINT "team_invitations_role_m2_chk" CHECK ("role" IN ('PLAYER', 'SUBSTITUTE'));
