# RAGE Platform — product specification

## Personas and roles
- Visitor: view published teams/players/tournaments/matches/rankings.
- Player: Steam login, profile, invitations, accepted memberships, registration-related notices.
- Captain: submit team application; after approval manage team and invite verified players, register qualified roster, participate in veto/ready checks.
- Team manager: manage roster only when explicitly granted by captain/admin.
- Tournament admin: approve team registrations, create brackets, decide disputes, authorize roster substitutions.
- Match admin: assign server, manage pause/restart/forfeit with audited reason.
- Observer: read restricted match telemetry, observer-only functionality.
- Super admin: approve team applications, manage servers, roles, global policies. Require MFA for privileged accounts if feasible.

## Key journeys
**Player:** click Sign in through Steam → external Steam OpenID consent → backend validates assertion (including provider response/nonce/return_to/realm) → create or retrieve user bound to verified SteamID64 → optional public Steam profile info fetch subject to API/privacy → profile shows stats after verified matches.

**Captain:** logged-in player → `Apply for team` (name, unique tag, country, optional logo/description) → `PENDING` → admin approves/rejects with reason → approved creates team and assigns captain via transaction; no team before approval. Avoid double approvals via unique constraints/row locking.

**Invite:** captain searches verified players → invitation `PENDING` → logged-in invited SteamID accepts/declines → transaction checks membership rules, roster cap, duplicate invites → historic membership created. Expiry, rescind, release, captain transfer, admin overrides audited. No manually fabricated player records.

**Tournament:** admin creates event + stages + rules, public registration → captain submits roster of 5 starters (optional max 2 substitutes), eligibility confirmed, snapshot locked at acceptance → bracket schedules BO1/BO3/BO5 matches → only authorized roles perform veto/ready → assign free server → load verified SteamIDs into match configuration → server-confirmed end → results/statistics/demos → advance bracket atomically.

**Team page (/teams/[slug]):** header/logo/name/country/region and RAGE ranking, current roster, staff, match history, upcoming matches, map statistics, achievements, H2H, ranking timeline; date/event/roster filters. All computed data has provenance, zero-data graceful states.

**Player page:** verified SteamID binding, Steam avatar as permitted, stats (K/D, ADR, KAST, HS%, opening duel, utility/clutch), rating version, map and time filters, team timeline, recent matches. Never present a homebrew rating as HLTV rating.

**Matchroom:** team cards, veto turns/actions, readiness, server allocation, connection details visible only to authorized participants (sensitive credentials never shown), current score, round-by-round game events, streaming live player statistics, pause/resume only authorized. Recover after disconnect and replay from authoritative server state.

**Public UX:** original compact dark UI with dense tables, accessible mobile responsive, i18n architecture English/Russian/Kazakh, metadata/SEO; accurate status and empty states.

## Scope boundaries
MVP: Steam auth, team approvals, invitation rosters, admins, tournament registration/roster snapshots, basic single-elim BO1 (optionally BO3 once working), one real CS2 server round-trip, live score, kills/deaths/assists, result persistence, public profiles. Subsequent: double elimination, full veto, complex KAST/ADR validation, demo parsing, rankings/heatmaps, multi-instance scaling, advanced Observer.

## Security principles
Steam proof validated server side. Signed agent identities with rotation, TLS/outbound agent connection for private networks, RCON never exposed publicly; immutable audit trails, CSRF on cookie actions, encrypted secrets, rate limiting, strict RBAC+object access, no untrusted arbitrary admin command, file upload limits and MIME checks.
