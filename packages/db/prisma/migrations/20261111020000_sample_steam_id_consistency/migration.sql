-- Security review LOW-5 (2026-11-11): bind `users.is_sample` to the reserved sample
-- SteamID64 range at the database level (ADR-011).
--
--   * Sample users MUST use 76561190000000001..76561190000000999 (below the individual
--     account base 76561197960265728, so no real Steam account can ever have them).
--   * Real users (is_sample = false) can NEVER use that range, and a real account can
--     never be flagged as sample.
--
-- Both sides are fixed-length 17-digit strings (enforced by users_steam_id64_format_chk),
-- so a byte-wise ("C" collation) comparison equals numeric ordering.
-- Raw CHECK constraint: Prisma does not model it, `migrate diff` ignores it (see README).
-- Forward-only; to revert, write a new migration that drops the constraint.

ALTER TABLE "users"
  ADD CONSTRAINT "users_sample_steam_id_range_chk"
  CHECK (
    "is_sample" = (
      "steam_id64" COLLATE "C" BETWEEN '76561190000000001' AND '76561190000000999'
    )
  );
