-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "SteamPrivacyStatus" AS ENUM ('PUBLIC', 'FRIENDS_ONLY', 'PRIVATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('SUPER_ADMIN', 'TOURNAMENT_ADMIN', 'MATCH_ADMIN', 'OBSERVER', 'TEAM_MANAGER');

-- CreateEnum
CREATE TYPE "RoleScopeType" AS ENUM ('GLOBAL', 'TEAM', 'TOURNAMENT', 'MATCH');

-- CreateEnum
CREATE TYPE "TeamApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISBANDED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('CAPTAIN', 'PLAYER', 'SUBSTITUTE', 'MANAGER', 'COACH');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('COACH', 'ASSISTANT_COACH', 'ANALYST', 'MANAGER');

-- CreateEnum
CREATE TYPE "BracketFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'SWISS');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RosterStatus" AS ENUM ('DRAFT', 'LOCKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RosterEntryRole" AS ENUM ('STARTER', 'SUBSTITUTE');

-- CreateEnum
CREATE TYPE "MatchFormat" AS ENUM ('BO1', 'BO3', 'BO5');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('CREATED', 'SERVER_ASSIGNED', 'PREPARING', 'WARMUP', 'READY_CHECK', 'KNIFE', 'LIVE', 'PAUSED', 'MAP_FINISHED', 'COMPLETED', 'CANCELLED', 'FAILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MatchMapStatus" AS ENUM ('PENDING', 'WARMUP', 'KNIFE', 'LIVE', 'PAUSED', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TeamPosition" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "TeamSide" AS ENUM ('CT', 'T');

-- CreateEnum
CREATE TYPE "VetoActionType" AS ENUM ('BAN', 'PICK', 'SIDE_PICK', 'DECIDER');

-- CreateEnum
CREATE TYPE "RoundWinReason" AS ENUM ('ELIMINATION', 'BOMB_EXPLODED', 'BOMB_DEFUSED', 'TIME_EXPIRED', 'SURRENDER', 'ADMIN_DECISION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ServerProviderType" AS ENUM ('DEDICATED', 'VPS', 'LAN');

-- CreateEnum
CREATE TYPE "GameServerStatus" AS ENUM ('UNKNOWN', 'AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "ServerAgentStatus" AS ENUM ('PENDING', 'ONLINE', 'DEGRADED', 'OUTDATED', 'OFFLINE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ServerCommandType" AS ENUM ('HEALTH_CHECK', 'LOAD_MATCH_CONFIG', 'START_MATCH', 'PAUSE_MATCH', 'UNPAUSE_MATCH', 'RESTORE_ROUND_BACKUP', 'END_MATCH', 'RELEASE_SERVER');

-- CreateEnum
CREATE TYPE "ServerCommandState" AS ENUM ('QUEUED', 'SENT', 'ACKNOWLEDGED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "DemoStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "steam_id64" VARCHAR(17) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steam_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "steam_display_name" TEXT,
    "avatar_url" TEXT,
    "profile_url" TEXT,
    "privacy_status" "SteamPrivacyStatus" NOT NULL DEFAULT 'UNKNOWN',
    "synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "steam_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "nickname" VARCHAR(32) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "country_code" CHAR(2),
    "biography" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "player_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "RoleType" NOT NULL,
    "scope_type" "RoleScopeType" NOT NULL DEFAULT 'GLOBAL',
    "scope_id" UUID,
    "issued_by" UUID,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,

    CONSTRAINT "user_role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_applications" (
    "id" UUID NOT NULL,
    "applicant_user_id" UUID NOT NULL,
    "requested_name" VARCHAR(64) NOT NULL,
    "requested_tag" VARCHAR(10) NOT NULL,
    "requested_slug" VARCHAR(64) NOT NULL,
    "country_code" CHAR(2),
    "description" TEXT,
    "logo_key" TEXT,
    "status" "TeamApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_reason" TEXT,
    "created_team_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "team_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "tag" VARCHAR(10) NOT NULL,
    "country_code" CHAR(2),
    "region" VARCHAR(32),
    "logo_key" TEXT,
    "description" TEXT,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),
    "left_reason" TEXT,
    "invited_by" UUID,
    "invitation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_invitations" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "invitee_user_id" UUID NOT NULL,
    "invited_by" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'PLAYER',
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_staff" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),

    CONSTRAINT "team_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_achievements" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "placement" INTEGER NOT NULL,
    "prize_amount" DECIMAL(14,2),
    "currency_code" CHAR(3),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_ranking_snapshots" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "region" VARCHAR(32),
    "algorithm_version" VARCHAR(32) NOT NULL,
    "points" DECIMAL(12,4) NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "team_ranking_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(96) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "format" "BracketFormat" NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "default_match_format" "MatchFormat" NOT NULL DEFAULT 'BO1',
    "max_teams" INTEGER,
    "registration_open_at" TIMESTAMPTZ(6),
    "registration_close_at" TIMESTAMPTZ(6),
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_stages" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "format" "BracketFormat" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_registrations" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "seed" INTEGER,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tournament_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_rosters" (
    "id" UUID NOT NULL,
    "tournament_registration_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RosterStatus" NOT NULL DEFAULT 'DRAFT',
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" UUID,
    "supersedes_roster_id" UUID,
    "change_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_rosters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_roster_entries" (
    "id" UUID NOT NULL,
    "roster_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "steam_id64_snapshot" VARCHAR(17) NOT NULL,
    "nickname_snapshot" VARCHAR(32) NOT NULL,
    "role" "RosterEntryRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brackets" (
    "id" UUID NOT NULL,
    "tournament_stage_id" UUID NOT NULL,
    "generation_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bracket_slots" (
    "id" UUID NOT NULL,
    "bracket_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "slot_number" INTEGER NOT NULL,
    "next_slot_id" UUID,
    "next_slot_position" "TeamPosition",
    "loser_next_slot_id" UUID,
    "loser_next_slot_position" "TeamPosition",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bracket_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "tournament_id" UUID,
    "stage_id" UUID,
    "bracket_slot_id" UUID,
    "team_a_id" UUID,
    "team_b_id" UUID,
    "format" "MatchFormat" NOT NULL DEFAULT 'BO1',
    "status" "MatchStatus" NOT NULL DEFAULT 'CREATED',
    "team_a_score" INTEGER,
    "team_b_score" INTEGER,
    "winner_team_id" UUID,
    "scheduled_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "result_verified_at" TIMESTAMPTZ(6),
    "status_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_rosters" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "tournament_roster_id" UUID,
    "frozen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_rosters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_maps" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "map_order" INTEGER NOT NULL,
    "map_name" VARCHAR(64) NOT NULL,
    "status" "MatchMapStatus" NOT NULL DEFAULT 'PENDING',
    "team_a_score" INTEGER NOT NULL DEFAULT 0,
    "team_b_score" INTEGER NOT NULL DEFAULT 0,
    "winner_team_id" UUID,
    "starting_ct_team_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "match_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_map_players" (
    "id" UUID NOT NULL,
    "match_map_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "steam_id64_snapshot" VARCHAR(17) NOT NULL,
    "nickname_snapshot" VARCHAR(32) NOT NULL,
    "side_initial" "TeamSide",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_map_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_veto_actions" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actor_team_id" UUID,
    "actor_user_id" UUID,
    "action" "VetoActionType" NOT NULL,
    "map_name" VARCHAR(64) NOT NULL,
    "side" "TeamSide",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_veto_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_rounds" (
    "id" UUID NOT NULL,
    "match_map_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "winning_team_id" UUID,
    "winning_side" "TeamSide",
    "win_reason" "RoundWinReason",
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "match_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_servers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "provider_type" "ServerProviderType" NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "game_port" INTEGER NOT NULL,
    "region" VARCHAR(32),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "GameServerStatus" NOT NULL DEFAULT 'UNKNOWN',
    "secret_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "game_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_agents" (
    "id" UUID NOT NULL,
    "game_server_id" UUID NOT NULL,
    "agent_identity" TEXT NOT NULL,
    "version" VARCHAR(64),
    "game_plugin_version" VARCHAR(64),
    "last_heartbeat_at" TIMESTAMPTZ(6),
    "status" "ServerAgentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "server_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_allocations" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "allocated_by" UUID,
    "lease_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),
    "release_reason" TEXT,

    CONSTRAINT "server_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_command_requests" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "match_id" UUID,
    "actor_user_id" UUID,
    "command_type" "ServerCommandType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "state" "ServerCommandState" NOT NULL DEFAULT 'QUEUED',
    "idempotency_key" VARCHAR(128),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deadline" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "ack_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "server_command_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_events" (
    "id" UUID NOT NULL,
    "source_server_id" UUID NOT NULL,
    "external_event_id" VARCHAR(128) NOT NULL,
    "match_id" UUID NOT NULL,
    "match_map_id" UUID,
    "event_type" VARCHAR(64) NOT NULL,
    "tick" INTEGER,
    "sequence" BIGINT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "payload_json" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_map_stats" (
    "id" UUID NOT NULL,
    "match_map_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "headshots" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "rounds_played" INTEGER NOT NULL DEFAULT 0,
    "kast_rounds" INTEGER NOT NULL DEFAULT 0,
    "opening_kills" INTEGER NOT NULL DEFAULT 0,
    "opening_deaths" INTEGER NOT NULL DEFAULT 0,
    "utility_damage" INTEGER NOT NULL DEFAULT 0,
    "clutch_wins" INTEGER NOT NULL DEFAULT 0,
    "rating_value" DECIMAL(6,3),
    "rating_version" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "player_map_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_round_stats" (
    "id" UUID NOT NULL,
    "match_round_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "damage" INTEGER NOT NULL DEFAULT 0,
    "kast_flags" INTEGER NOT NULL DEFAULT 0,
    "survived" BOOLEAN NOT NULL DEFAULT false,
    "traded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "player_round_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_map_stats" (
    "id" UUID NOT NULL,
    "match_map_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "rounds_won" INTEGER NOT NULL DEFAULT 0,
    "ct_rounds_won" INTEGER NOT NULL DEFAULT 0,
    "t_rounds_won" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "team_map_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demos" (
    "id" UUID NOT NULL,
    "match_map_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" CHAR(64),
    "bytes" BIGINT,
    "status" "DemoStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "parser_version" VARCHAR(32),
    "uploaded_at" TIMESTAMPTZ(6),
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(96) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(128),
    "request_id" VARCHAR(128),
    "detail_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(128) NOT NULL,
    "resource_id" VARCHAR(128),
    "payload_json" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_steam_id64_key" ON "users"("steam_id64");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "steam_profiles_user_id_key" ON "steam_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_profiles_user_id_key" ON "player_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_profiles_slug_key" ON "player_profiles"("slug");

-- CreateIndex
CREATE INDEX "player_profiles_nickname_idx" ON "player_profiles"("nickname");

-- CreateIndex
CREATE INDEX "user_role_grants_user_id_idx" ON "user_role_grants"("user_id");

-- CreateIndex
CREATE INDEX "user_role_grants_issued_by_idx" ON "user_role_grants"("issued_by");

-- CreateIndex
CREATE INDEX "user_role_grants_revoked_by_idx" ON "user_role_grants"("revoked_by");

-- CreateIndex
CREATE INDEX "user_role_grants_role_scope_type_scope_id_idx" ON "user_role_grants"("role", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_applications_created_team_id_key" ON "team_applications"("created_team_id");

-- CreateIndex
CREATE INDEX "team_applications_applicant_user_id_idx" ON "team_applications"("applicant_user_id");

-- CreateIndex
CREATE INDEX "team_applications_reviewed_by_idx" ON "team_applications"("reviewed_by");

-- CreateIndex
CREATE INDEX "team_applications_status_created_at_idx" ON "team_applications"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE INDEX "teams_status_idx" ON "teams"("status");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_invitation_id_key" ON "team_memberships"("invitation_id");

-- CreateIndex
CREATE INDEX "team_memberships_team_id_left_at_idx" ON "team_memberships"("team_id", "left_at");

-- CreateIndex
CREATE INDEX "team_memberships_user_id_joined_at_idx" ON "team_memberships"("user_id", "joined_at");

-- CreateIndex
CREATE INDEX "team_memberships_invited_by_idx" ON "team_memberships"("invited_by");

-- CreateIndex
CREATE INDEX "team_invitations_team_id_status_idx" ON "team_invitations"("team_id", "status");

-- CreateIndex
CREATE INDEX "team_invitations_invitee_user_id_status_idx" ON "team_invitations"("invitee_user_id", "status");

-- CreateIndex
CREATE INDEX "team_invitations_status_expires_at_idx" ON "team_invitations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "team_invitations_invited_by_idx" ON "team_invitations"("invited_by");

-- CreateIndex
CREATE INDEX "team_staff_team_id_valid_to_idx" ON "team_staff"("team_id", "valid_to");

-- CreateIndex
CREATE INDEX "team_staff_user_id_idx" ON "team_staff"("user_id");

-- CreateIndex
CREATE INDEX "team_achievements_tournament_id_idx" ON "team_achievements"("tournament_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_achievements_team_id_tournament_id_key" ON "team_achievements"("team_id", "tournament_id");

-- CreateIndex
CREATE INDEX "team_ranking_snapshots_team_id_calculated_at_idx" ON "team_ranking_snapshots"("team_id", "calculated_at");

-- CreateIndex
CREATE INDEX "team_ranking_snapshots_algorithm_version_region_calculated__idx" ON "team_ranking_snapshots"("algorithm_version", "region", "calculated_at", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_slug_key" ON "tournaments"("slug");

-- CreateIndex
CREATE INDEX "tournaments_status_starts_at_idx" ON "tournaments"("status", "starts_at");

-- CreateIndex
CREATE INDEX "tournaments_created_by_idx" ON "tournaments"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_stages_tournament_id_sequence_key" ON "tournament_stages"("tournament_id", "sequence");

-- CreateIndex
CREATE INDEX "tournament_registrations_tournament_id_status_idx" ON "tournament_registrations"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "tournament_registrations_team_id_idx" ON "tournament_registrations"("team_id");

-- CreateIndex
CREATE INDEX "tournament_registrations_requested_by_idx" ON "tournament_registrations"("requested_by");

-- CreateIndex
CREATE INDEX "tournament_registrations_reviewed_by_idx" ON "tournament_registrations"("reviewed_by");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_registrations_tournament_id_team_id_key" ON "tournament_registrations"("tournament_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_rosters_supersedes_roster_id_key" ON "tournament_rosters"("supersedes_roster_id");

-- CreateIndex
CREATE INDEX "tournament_rosters_locked_by_idx" ON "tournament_rosters"("locked_by");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_rosters_tournament_registration_id_version_key" ON "tournament_rosters"("tournament_registration_id", "version");

-- CreateIndex
CREATE INDEX "tournament_roster_entries_user_id_idx" ON "tournament_roster_entries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_roster_entries_roster_id_user_id_key" ON "tournament_roster_entries"("roster_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_roster_entries_roster_id_steam_id64_snapshot_key" ON "tournament_roster_entries"("roster_id", "steam_id64_snapshot");

-- CreateIndex
CREATE UNIQUE INDEX "brackets_tournament_stage_id_generation_version_key" ON "brackets"("tournament_stage_id", "generation_version");

-- CreateIndex
CREATE INDEX "bracket_slots_next_slot_id_idx" ON "bracket_slots"("next_slot_id");

-- CreateIndex
CREATE INDEX "bracket_slots_loser_next_slot_id_idx" ON "bracket_slots"("loser_next_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "bracket_slots_bracket_id_round_number_slot_number_key" ON "bracket_slots"("bracket_id", "round_number", "slot_number");

-- CreateIndex
CREATE UNIQUE INDEX "matches_bracket_slot_id_key" ON "matches"("bracket_slot_id");

-- CreateIndex
CREATE INDEX "matches_tournament_id_status_idx" ON "matches"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "matches_stage_id_idx" ON "matches"("stage_id");

-- CreateIndex
CREATE INDEX "matches_team_a_id_scheduled_at_idx" ON "matches"("team_a_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "matches_team_b_id_scheduled_at_idx" ON "matches"("team_b_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "matches_winner_team_id_idx" ON "matches"("winner_team_id");

-- CreateIndex
CREATE INDEX "matches_status_scheduled_at_idx" ON "matches"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "match_rosters_team_id_idx" ON "match_rosters"("team_id");

-- CreateIndex
CREATE INDEX "match_rosters_tournament_roster_id_idx" ON "match_rosters"("tournament_roster_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_rosters_match_id_team_id_key" ON "match_rosters"("match_id", "team_id");

-- CreateIndex
CREATE INDEX "match_maps_winner_team_id_idx" ON "match_maps"("winner_team_id");

-- CreateIndex
CREATE INDEX "match_maps_starting_ct_team_id_idx" ON "match_maps"("starting_ct_team_id");

-- CreateIndex
CREATE INDEX "match_maps_map_name_idx" ON "match_maps"("map_name");

-- CreateIndex
CREATE UNIQUE INDEX "match_maps_match_id_map_order_key" ON "match_maps"("match_id", "map_order");

-- CreateIndex
CREATE INDEX "match_map_players_user_id_idx" ON "match_map_players"("user_id");

-- CreateIndex
CREATE INDEX "match_map_players_team_id_idx" ON "match_map_players"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_map_players_match_map_id_user_id_key" ON "match_map_players"("match_map_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_map_players_match_map_id_steam_id64_snapshot_key" ON "match_map_players"("match_map_id", "steam_id64_snapshot");

-- CreateIndex
CREATE INDEX "map_veto_actions_actor_team_id_idx" ON "map_veto_actions"("actor_team_id");

-- CreateIndex
CREATE INDEX "map_veto_actions_actor_user_id_idx" ON "map_veto_actions"("actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "map_veto_actions_match_id_sequence_key" ON "map_veto_actions"("match_id", "sequence");

-- CreateIndex
CREATE INDEX "match_rounds_winning_team_id_idx" ON "match_rounds"("winning_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_rounds_match_map_id_round_number_key" ON "match_rounds"("match_map_id", "round_number");

-- CreateIndex
CREATE UNIQUE INDEX "game_servers_name_key" ON "game_servers"("name");

-- CreateIndex
CREATE INDEX "game_servers_enabled_status_idx" ON "game_servers"("enabled", "status");

-- CreateIndex
CREATE UNIQUE INDEX "server_agents_agent_identity_key" ON "server_agents"("agent_identity");

-- CreateIndex
CREATE INDEX "server_agents_game_server_id_idx" ON "server_agents"("game_server_id");

-- CreateIndex
CREATE INDEX "server_agents_status_last_heartbeat_at_idx" ON "server_agents"("status", "last_heartbeat_at");

-- CreateIndex
CREATE INDEX "server_allocations_server_id_allocated_at_idx" ON "server_allocations"("server_id", "allocated_at");

-- CreateIndex
CREATE INDEX "server_allocations_match_id_idx" ON "server_allocations"("match_id");

-- CreateIndex
CREATE INDEX "server_allocations_allocated_by_idx" ON "server_allocations"("allocated_by");

-- CreateIndex
CREATE INDEX "server_allocations_lease_expires_at_idx" ON "server_allocations"("lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "server_command_requests_idempotency_key_key" ON "server_command_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "server_command_requests_server_id_state_created_at_idx" ON "server_command_requests"("server_id", "state", "created_at");

-- CreateIndex
CREATE INDEX "server_command_requests_match_id_created_at_idx" ON "server_command_requests"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "server_command_requests_actor_user_id_idx" ON "server_command_requests"("actor_user_id");

-- CreateIndex
CREATE INDEX "server_command_requests_state_deadline_idx" ON "server_command_requests"("state", "deadline");

-- CreateIndex
CREATE INDEX "match_events_source_server_id_sequence_idx" ON "match_events"("source_server_id", "sequence");

-- CreateIndex
CREATE INDEX "match_events_match_id_sequence_idx" ON "match_events"("match_id", "sequence");

-- CreateIndex
CREATE INDEX "match_events_match_map_id_tick_idx" ON "match_events"("match_map_id", "tick");

-- CreateIndex
CREATE INDEX "match_events_match_id_received_at_idx" ON "match_events"("match_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_events_source_server_id_external_event_id_key" ON "match_events"("source_server_id", "external_event_id");

-- CreateIndex
CREATE INDEX "player_map_stats_user_id_created_at_idx" ON "player_map_stats"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "player_map_stats_team_id_idx" ON "player_map_stats"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_map_stats_match_map_id_user_id_key" ON "player_map_stats"("match_map_id", "user_id");

-- CreateIndex
CREATE INDEX "player_round_stats_user_id_idx" ON "player_round_stats"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_round_stats_match_round_id_user_id_key" ON "player_round_stats"("match_round_id", "user_id");

-- CreateIndex
CREATE INDEX "team_map_stats_team_id_idx" ON "team_map_stats"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_map_stats_match_map_id_team_id_key" ON "team_map_stats"("match_map_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "demos_object_key_key" ON "demos"("object_key");

-- CreateIndex
CREATE INDEX "demos_match_map_id_idx" ON "demos"("match_map_id");

-- CreateIndex
CREATE INDEX "demos_status_idx" ON "demos"("status");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "outbox_events_topic_created_at_idx" ON "outbox_events"("topic", "created_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steam_profiles" ADD CONSTRAINT "steam_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_grants" ADD CONSTRAINT "user_role_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_grants" ADD CONSTRAINT "user_role_grants_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_grants" ADD CONSTRAINT "user_role_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_applications" ADD CONSTRAINT "team_applications_applicant_user_id_fkey" FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_applications" ADD CONSTRAINT "team_applications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_applications" ADD CONSTRAINT "team_applications_created_team_id_fkey" FOREIGN KEY ("created_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "team_invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invitee_user_id_fkey" FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_achievements" ADD CONSTRAINT "team_achievements_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_achievements" ADD CONSTRAINT "team_achievements_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_ranking_snapshots" ADD CONSTRAINT "team_ranking_snapshots_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_rosters" ADD CONSTRAINT "tournament_rosters_tournament_registration_id_fkey" FOREIGN KEY ("tournament_registration_id") REFERENCES "tournament_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_rosters" ADD CONSTRAINT "tournament_rosters_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_rosters" ADD CONSTRAINT "tournament_rosters_supersedes_roster_id_fkey" FOREIGN KEY ("supersedes_roster_id") REFERENCES "tournament_rosters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_roster_entries" ADD CONSTRAINT "tournament_roster_entries_roster_id_fkey" FOREIGN KEY ("roster_id") REFERENCES "tournament_rosters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_roster_entries" ADD CONSTRAINT "tournament_roster_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brackets" ADD CONSTRAINT "brackets_tournament_stage_id_fkey" FOREIGN KEY ("tournament_stage_id") REFERENCES "tournament_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_slots" ADD CONSTRAINT "bracket_slots_bracket_id_fkey" FOREIGN KEY ("bracket_id") REFERENCES "brackets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_slots" ADD CONSTRAINT "bracket_slots_next_slot_id_fkey" FOREIGN KEY ("next_slot_id") REFERENCES "bracket_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_slots" ADD CONSTRAINT "bracket_slots_loser_next_slot_id_fkey" FOREIGN KEY ("loser_next_slot_id") REFERENCES "bracket_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "tournament_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_bracket_slot_id_fkey" FOREIGN KEY ("bracket_slot_id") REFERENCES "bracket_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_a_id_fkey" FOREIGN KEY ("team_a_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_b_id_fkey" FOREIGN KEY ("team_b_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rosters" ADD CONSTRAINT "match_rosters_tournament_roster_id_fkey" FOREIGN KEY ("tournament_roster_id") REFERENCES "tournament_rosters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_starting_ct_team_id_fkey" FOREIGN KEY ("starting_ct_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_map_players" ADD CONSTRAINT "match_map_players_match_map_id_fkey" FOREIGN KEY ("match_map_id") REFERENCES "match_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_map_players" ADD CONSTRAINT "match_map_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_map_players" ADD CONSTRAINT "match_map_players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_veto_actions" ADD CONSTRAINT "map_veto_actions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_veto_actions" ADD CONSTRAINT "map_veto_actions_actor_team_id_fkey" FOREIGN KEY ("actor_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_veto_actions" ADD CONSTRAINT "map_veto_actions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rounds" ADD CONSTRAINT "match_rounds_match_map_id_fkey" FOREIGN KEY ("match_map_id") REFERENCES "match_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_rounds" ADD CONSTRAINT "match_rounds_winning_team_id_fkey" FOREIGN KEY ("winning_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_agents" ADD CONSTRAINT "server_agents_game_server_id_fkey" FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_allocations" ADD CONSTRAINT "server_allocations_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_allocations" ADD CONSTRAINT "server_allocations_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_allocations" ADD CONSTRAINT "server_allocations_allocated_by_fkey" FOREIGN KEY ("allocated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_command_requests" ADD CONSTRAINT "server_command_requests_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_command_requests" ADD CONSTRAINT "server_command_requests_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_command_requests" ADD CONSTRAINT "server_command_requests_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_source_server_id_fkey" FOREIGN KEY ("source_server_id") REFERENCES "game_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_map_id_fkey" FOREIGN KEY ("match_map_id") REFERENCES "match_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_map_stats" ADD CONSTRAINT "player_map_stats_match_map_id_fkey" FOREIGN KEY ("match_map_id") REFERENCES "match_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_map_stats" ADD CONSTRAINT "player_map_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_map_stats" ADD CONSTRAINT "player_map_stats_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_round_stats" ADD CONSTRAINT "player_round_stats_match_round_id_fkey" FOREIGN KEY ("match_round_id") REFERENCES "match_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_round_stats" ADD CONSTRAINT "player_round_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_map_stats" ADD CONSTRAINT "team_map_stats_match_map_id_fkey" FOREIGN KEY ("match_map_id") REFERENCES "match_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_map_stats" ADD CONSTRAINT "team_map_stats_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demos" ADD CONSTRAINT "demos_match_map_id_fkey" FOREIGN KEY ("match_map_id") REFERENCES "match_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- RAGE raw SQL: constraints Prisma schema cannot express.
-- Keep in sync with packages/db/README.md ("Constraints") and test/constraints.int.test.ts.
-- Compatible with PostgreSQL >= 14 (no NULLS NOT DISTINCT used).
-- ============================================================================

-- ---------- Identity ----------
ALTER TABLE "users"
  ADD CONSTRAINT "users_steam_id64_format_chk" CHECK ("steam_id64" ~ '^[0-9]{17}$');

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_expiry_chk" CHECK ("expires_at" > "created_at");

ALTER TABLE "player_profiles"
  ADD CONSTRAINT "player_profiles_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  ADD CONSTRAINT "player_profiles_nickname_not_blank_chk" CHECK (length(btrim("nickname")) > 0),
  ADD CONSTRAINT "player_profiles_country_code_chk" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$');

ALTER TABLE "user_role_grants"
  ADD CONSTRAINT "user_role_grants_scope_chk" CHECK (("scope_type" = 'GLOBAL') = ("scope_id" IS NULL)),
  ADD CONSTRAINT "user_role_grants_revoked_after_issued_chk" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "issued_at");
-- At most one active grant of a role per (user, scope).
CREATE UNIQUE INDEX "user_role_grants_active_uniq"
  ON "user_role_grants" ("user_id", "role", "scope_type", COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "revoked_at" IS NULL;

-- ---------- Team applications ----------
ALTER TABLE "team_applications"
  ADD CONSTRAINT "team_applications_slug_format_chk" CHECK ("requested_slug" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  ADD CONSTRAINT "team_applications_name_not_blank_chk" CHECK (length(btrim("requested_name")) > 0),
  ADD CONSTRAINT "team_applications_tag_not_blank_chk" CHECK (length(btrim("requested_tag")) > 0),
  ADD CONSTRAINT "team_applications_country_code_chk" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$'),
  -- APPROVED <=> a team was created (and only then).
  ADD CONSTRAINT "team_applications_approved_team_chk" CHECK (("status" = 'APPROVED') = ("created_team_id" IS NOT NULL)),
  ADD CONSTRAINT "team_applications_reviewed_chk" CHECK ("status" NOT IN ('APPROVED', 'REJECTED') OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)),
  ADD CONSTRAINT "team_applications_reject_reason_chk" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("review_reason", ''))) > 0);
-- One PENDING application per applicant.
CREATE UNIQUE INDEX "team_applications_one_pending_per_applicant_uniq"
  ON "team_applications" ("applicant_user_id") WHERE "status" = 'PENDING';
-- No two PENDING applications competing for the same name / slug (case-insensitive).
CREATE UNIQUE INDEX "team_applications_pending_name_ci_uniq"
  ON "team_applications" (lower("requested_name")) WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "team_applications_pending_slug_uniq"
  ON "team_applications" ("requested_slug") WHERE "status" = 'PENDING';

-- ---------- Teams ----------
ALTER TABLE "teams"
  ADD CONSTRAINT "teams_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  ADD CONSTRAINT "teams_name_not_blank_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "teams_tag_not_blank_chk" CHECK (length(btrim("tag")) > 0),
  ADD CONSTRAINT "teams_country_code_chk" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$');
CREATE UNIQUE INDEX "teams_name_ci_uniq" ON "teams" (lower("name"));
CREATE UNIQUE INDEX "teams_tag_ci_uniq" ON "teams" (lower("tag"));
-- (slug is forced lowercase by CHECK, so the plain UNIQUE on slug is already case-insensitive.)

-- ---------- Memberships ----------
ALTER TABLE "team_memberships"
  ADD CONSTRAINT "team_memberships_left_after_joined_chk" CHECK ("left_at" IS NULL OR "left_at" >= "joined_at");
-- Policy: a user has at most one ACTIVE team membership.
CREATE UNIQUE INDEX "team_memberships_one_active_per_user_uniq"
  ON "team_memberships" ("user_id") WHERE "left_at" IS NULL;
-- At most one ACTIVE captain per team.
CREATE UNIQUE INDEX "team_memberships_one_active_captain_per_team_uniq"
  ON "team_memberships" ("team_id") WHERE "role" = 'CAPTAIN' AND "left_at" IS NULL;

-- ---------- Invitations ----------
ALTER TABLE "team_invitations"
  ADD CONSTRAINT "team_invitations_expiry_chk" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "team_invitations_not_self_chk" CHECK ("invitee_user_id" <> "invited_by"),
  ADD CONSTRAINT "team_invitations_pending_unresponded_chk" CHECK ("status" <> 'PENDING' OR "responded_at" IS NULL);
CREATE UNIQUE INDEX "team_invitations_one_pending_per_team_invitee_uniq"
  ON "team_invitations" ("team_id", "invitee_user_id") WHERE "status" = 'PENDING';

-- ---------- Staff / achievements / rankings ----------
ALTER TABLE "team_staff"
  ADD CONSTRAINT "team_staff_validity_chk" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
CREATE UNIQUE INDEX "team_staff_active_uniq"
  ON "team_staff" ("team_id", "user_id", "role") WHERE "valid_to" IS NULL;

ALTER TABLE "team_achievements"
  ADD CONSTRAINT "team_achievements_placement_chk" CHECK ("placement" >= 1),
  ADD CONSTRAINT "team_achievements_prize_chk" CHECK ("prize_amount" IS NULL OR "prize_amount" >= 0),
  ADD CONSTRAINT "team_achievements_currency_chk" CHECK ("currency_code" IS NULL OR "currency_code" ~ '^[A-Z]{3}$');

ALTER TABLE "team_ranking_snapshots"
  ADD CONSTRAINT "team_ranking_snapshots_rank_chk" CHECK ("rank" >= 1);

-- ---------- Tournaments ----------
ALTER TABLE "tournaments"
  ADD CONSTRAINT "tournaments_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  ADD CONSTRAINT "tournaments_registration_window_chk" CHECK ("registration_open_at" IS NULL OR "registration_close_at" IS NULL OR "registration_close_at" >= "registration_open_at"),
  ADD CONSTRAINT "tournaments_schedule_chk" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" >= "starts_at"),
  ADD CONSTRAINT "tournaments_max_teams_chk" CHECK ("max_teams" IS NULL OR "max_teams" >= 2),
  ADD CONSTRAINT "tournaments_settings_object_chk" CHECK (jsonb_typeof("settings_json") = 'object');

ALTER TABLE "tournament_stages"
  ADD CONSTRAINT "tournament_stages_sequence_chk" CHECK ("sequence" >= 1);

ALTER TABLE "tournament_registrations"
  ADD CONSTRAINT "tournament_registrations_seed_chk" CHECK ("seed" IS NULL OR "seed" >= 1);

ALTER TABLE "tournament_rosters"
  ADD CONSTRAINT "tournament_rosters_version_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "tournament_rosters_locked_at_chk" CHECK ("status" = 'DRAFT' OR "locked_at" IS NOT NULL);
-- At most one LOCKED (current) roster per registration; older versions become SUPERSEDED.
CREATE UNIQUE INDEX "tournament_rosters_one_locked_per_registration_uniq"
  ON "tournament_rosters" ("tournament_registration_id") WHERE "status" = 'LOCKED';

ALTER TABLE "tournament_roster_entries"
  ADD CONSTRAINT "tournament_roster_entries_steam_id64_format_chk" CHECK ("steam_id64_snapshot" ~ '^[0-9]{17}$');

ALTER TABLE "brackets"
  ADD CONSTRAINT "brackets_generation_version_chk" CHECK ("generation_version" >= 1);

ALTER TABLE "bracket_slots"
  ADD CONSTRAINT "bracket_slots_numbers_chk" CHECK ("round_number" >= 1 AND "slot_number" >= 1),
  ADD CONSTRAINT "bracket_slots_not_self_chk" CHECK ("next_slot_id" IS DISTINCT FROM "id" AND "loser_next_slot_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "bracket_slots_next_position_chk" CHECK (("next_slot_id" IS NULL) = ("next_slot_position" IS NULL)),
  ADD CONSTRAINT "bracket_slots_loser_next_position_chk" CHECK (("loser_next_slot_id" IS NULL) = ("loser_next_slot_position" IS NULL));
-- Two slots cannot feed the same position of the same next slot.
CREATE UNIQUE INDEX "bracket_slots_next_position_uniq"
  ON "bracket_slots" ("next_slot_id", "next_slot_position") WHERE "next_slot_id" IS NOT NULL;

-- ---------- Matches ----------
ALTER TABLE "matches"
  ADD CONSTRAINT "matches_distinct_teams_chk" CHECK ("team_a_id" IS NULL OR "team_b_id" IS NULL OR "team_a_id" <> "team_b_id"),
  ADD CONSTRAINT "matches_winner_is_participant_chk" CHECK ("winner_team_id" IS NULL OR "winner_team_id" = "team_a_id" OR "winner_team_id" = "team_b_id"),
  ADD CONSTRAINT "matches_scores_non_negative_chk" CHECK (coalesce("team_a_score", 0) >= 0 AND coalesce("team_b_score", 0) >= 0),
  ADD CONSTRAINT "matches_completed_after_started_chk" CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "completed_at" >= "started_at"),
  ADD CONSTRAINT "matches_version_chk" CHECK ("version" >= 0);

ALTER TABLE "match_maps"
  ADD CONSTRAINT "match_maps_order_chk" CHECK ("map_order" >= 1),
  ADD CONSTRAINT "match_maps_scores_non_negative_chk" CHECK ("team_a_score" >= 0 AND "team_b_score" >= 0),
  ADD CONSTRAINT "match_maps_completed_after_started_chk" CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "completed_at" >= "started_at");

ALTER TABLE "match_map_players"
  ADD CONSTRAINT "match_map_players_steam_id64_format_chk" CHECK ("steam_id64_snapshot" ~ '^[0-9]{17}$');

ALTER TABLE "map_veto_actions"
  ADD CONSTRAINT "map_veto_actions_sequence_chk" CHECK ("sequence" >= 1),
  ADD CONSTRAINT "map_veto_actions_side_chk" CHECK (("action" = 'SIDE_PICK') = ("side" IS NOT NULL));
-- A map is banned / picked / decided at most once per match.
CREATE UNIQUE INDEX "map_veto_actions_map_once_per_match_uniq"
  ON "map_veto_actions" ("match_id", "map_name") WHERE "action" IN ('BAN', 'PICK', 'DECIDER');

ALTER TABLE "match_rounds"
  ADD CONSTRAINT "match_rounds_round_number_chk" CHECK ("round_number" >= 1);

-- ---------- Game servers ----------
ALTER TABLE "game_servers"
  ADD CONSTRAINT "game_servers_port_chk" CHECK ("game_port" BETWEEN 1 AND 65535),
  ADD CONSTRAINT "game_servers_address_not_blank_chk" CHECK (length(btrim("address")) > 0);

ALTER TABLE "server_allocations"
  ADD CONSTRAINT "server_allocations_lease_chk" CHECK ("lease_expires_at" > "allocated_at"),
  ADD CONSTRAINT "server_allocations_released_chk" CHECK ("released_at" IS NULL OR "released_at" >= "allocated_at");
-- Never double-book: one active allocation per server and per match.
CREATE UNIQUE INDEX "server_allocations_one_active_per_server_uniq"
  ON "server_allocations" ("server_id") WHERE "released_at" IS NULL;
CREATE UNIQUE INDEX "server_allocations_one_active_per_match_uniq"
  ON "server_allocations" ("match_id") WHERE "released_at" IS NULL;

ALTER TABLE "server_command_requests"
  ADD CONSTRAINT "server_command_requests_attempts_chk" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "server_command_requests_payload_object_chk" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "server_command_requests_ack_chk" CHECK ("state" <> 'ACKNOWLEDGED' OR "ack_at" IS NOT NULL);

-- ---------- Events & stats ----------
ALTER TABLE "match_events"
  ADD CONSTRAINT "match_events_tick_chk" CHECK ("tick" IS NULL OR "tick" >= 0),
  ADD CONSTRAINT "match_events_sequence_chk" CHECK ("sequence" IS NULL OR "sequence" >= 0),
  ADD CONSTRAINT "match_events_external_id_not_blank_chk" CHECK (length(btrim("external_event_id")) > 0);

ALTER TABLE "player_map_stats"
  ADD CONSTRAINT "player_map_stats_non_negative_chk" CHECK (
    "kills" >= 0 AND "deaths" >= 0 AND "assists" >= 0 AND "headshots" >= 0 AND "damage" >= 0
    AND "rounds_played" >= 0 AND "kast_rounds" >= 0 AND "opening_kills" >= 0 AND "opening_deaths" >= 0
    AND "utility_damage" >= 0 AND "clutch_wins" >= 0),
  ADD CONSTRAINT "player_map_stats_headshots_chk" CHECK ("headshots" <= "kills"),
  ADD CONSTRAINT "player_map_stats_kast_chk" CHECK ("kast_rounds" <= "rounds_played"),
  ADD CONSTRAINT "player_map_stats_rating_version_chk" CHECK ("rating_value" IS NULL OR "rating_version" IS NOT NULL);

ALTER TABLE "player_round_stats"
  ADD CONSTRAINT "player_round_stats_non_negative_chk" CHECK ("kills" >= 0 AND "deaths" >= 0 AND "assists" >= 0 AND "damage" >= 0),
  ADD CONSTRAINT "player_round_stats_kast_flags_chk" CHECK ("kast_flags" BETWEEN 0 AND 15);

ALTER TABLE "team_map_stats"
  ADD CONSTRAINT "team_map_stats_non_negative_chk" CHECK ("rounds_won" >= 0 AND "ct_rounds_won" >= 0 AND "t_rounds_won" >= 0),
  ADD CONSTRAINT "team_map_stats_sides_sum_chk" CHECK ("ct_rounds_won" + "t_rounds_won" = "rounds_won");

ALTER TABLE "demos"
  ADD CONSTRAINT "demos_sha256_chk" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "demos_bytes_chk" CHECK ("bytes" IS NULL OR "bytes" >= 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_chk" CHECK ("attempts" >= 0);
-- Dispatcher scan: unpublished events in availability order.
CREATE INDEX "outbox_events_unpublished_idx"
  ON "outbox_events" ("available_at") WHERE "published_at" IS NULL;

-- ---------- Append-only tables (audit_logs, match_events) ----------
-- Guards against accidental mutation by application code. NOT a security boundary against a
-- role that owns the table (it could drop the trigger); production hardening (M7) should also
-- REVOKE UPDATE/DELETE/TRUNCATE from the application role.
-- Deliberate maintenance (e.g. retention pruning) must run in a transaction with:
--   SET LOCAL rage.allow_append_only_maintenance = 'on';
CREATE FUNCTION "rage_reject_append_only_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF coalesce(current_setting('rage.allow_append_only_maintenance', true), '') = 'on' THEN
    IF TG_LEVEL = 'STATEMENT' THEN
      RETURN NULL;
    ELSIF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rage: table "%" is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001', HINT = 'Insert a correcting row instead of mutating history.';
END;
$fn$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "rage_reject_append_only_mutation"();
CREATE TRIGGER "audit_logs_append_only_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "rage_reject_append_only_mutation"();
CREATE TRIGGER "match_events_append_only"
  BEFORE UPDATE OR DELETE ON "match_events"
  FOR EACH ROW EXECUTE FUNCTION "rage_reject_append_only_mutation"();
CREATE TRIGGER "match_events_append_only_truncate"
  BEFORE TRUNCATE ON "match_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "rage_reject_append_only_mutation"();
