# Teams, applications, invitations, rosters — M2 contract

Status: **contract for M2** (ADR-019). Source of truth for API, DB and web work in M2. Builds on
`docs/AUTH.md` (sessions, CSRF, RBAC, error envelope) and `docs/API_CONVENTIONS.md`.

## 1. Principles
- A team exists **only** after a SUPER_ADMIN approves a captain's application (ADR-002), or via the
  audited super-admin `POST /teams` (ADR-018 Q1). No team is ever created from client input alone.
- Players join **only** by explicitly accepting an invitation in their own signed-in session. No
  captain, manager or admin can add a player to a roster on their behalf (no impersonation).
- Identity is the verified SteamID64 (M1). Sample users/teams (`is_sample`) never take part in
  any M2 mutation (409 `SAMPLE_RESOURCE`).
- Correctness comes from DB constraints, row locks and state checks inside one transaction;
  idempotency keys are a convenience layer on top (API_CONVENTIONS §8).
- Every mutation is audited (§9) in the same transaction.
- Roster history is never rewritten: a role change closes the membership row (`left_at`) and
  opens a new one.

## 2. Policy constants (ADR-019)
| Constant | Value | Notes |
|---|---|---|
| `ROSTER_CAP` | 7 | active CAPTAIN + PLAYER + SUBSTITUTE memberships per team (5 starters + 2 subs) |
| Membership roles used in M2 | CAPTAIN, PLAYER, SUBSTITUTE | `MANAGER`/`COACH` enum values are NOT used for memberships; managers are `TEAM_MANAGER` role grants (ADR-018 Q4), coaches are `team_staff` (later) |
| One active membership per user | across **all** teams, substitutes included | DB: `team_memberships_one_active_per_user_uniq` |
| `INVITATION_TTL` | 7 days | lazy expiry (§6.4) |
| `MAX_PENDING_INVITATIONS_PER_TEAM` | 10 | anti-spam |
| Application name | 3–32 chars, NFC, trimmed, `^[\p{L}\p{N}][\p{L}\p{N} ._-]*$`u, no control/bidi chars | unique case-insensitive among teams and PENDING applications |
| Application tag | 2–6 chars `^[A-Za-z0-9]+$` | unique case-insensitive among teams and PENDING applications |
| Slug | derived server-side from name: NFKD → strip diacritics → lowercase → non `[a-z0-9]` runs → `-` → trim `-` → max 48; empty → `team-<random6>`; on collision append `-2`, `-3`… (at approval) | never client-supplied |
| Description | ≤ 500 chars, same rules as biography (AUTH: no control/bidi chars except `\n`/`\t`) | optional |
| Reject / remove / revoke / admin-create reason | 3–500 chars | required where listed |

## 3. Authorization matrix
"Team operator" = active CAPTAIN of that team, or holder of an active `TEAM_MANAGER` grant scoped
`TEAM:<teamId>`, or SUPER_ADMIN (admin override, audited with `detail.override = true`).

| Action | Who | Notes |
|---|---|---|
| Submit application | signed-in ACTIVE non-sample user, **no active membership**, no PENDING application | |
| Withdraw application | its applicant, while PENDING | |
| List/approve/reject applications | SUPER_ADMIN | |
| Create team directly (`POST /teams`) | SUPER_ADMIN | requires captain user + reason |
| Invite / revoke invitation | team operator | |
| Accept / decline invitation | **only the invitee** | other users get **404** (hide existence) |
| Remove member | team operator; a TEAM_MANAGER cannot remove the captain; nobody removes the captain (transfer first) | |
| Leave team | the member themself, except the captain (409 `CAPTAIN_MUST_TRANSFER`) | |
| Transfer captaincy | current captain or SUPER_ADMIN; target must be an active member of the same team | TEAM_MANAGER cannot |
| Team manage view | team operator | others 403 `FORBIDDEN_ROLE` (team itself is public) |
| Public team/player pages, roster history | everyone, no login | |

All unsafe requests require session + CSRF exactly as in M1 (`SessionGuard` → `CsrfGuard`).

## 4. Endpoints (all under `/api/v1`)
Unsafe endpoints accept an optional `Idempotency-Key` header (§7). Error codes in §8.

### 4.1 Applications
| Method & path | Auth | Request → Response |
|---|---|---|
| `POST /team-applications` | session+CSRF | `{ name, tag, countryCode?, description? }` → 201 `TeamApplicationDto` |
| `GET /me/team-applications` | session | own applications, newest first, `TeamApplicationDto[]` (max 20) |
| `POST /team-applications/:id/withdraw` | session+CSRF (applicant) | → `TeamApplicationDto` (WITHDRAWN); non-owner → 404 |
| `GET /admin/team-applications?status&page&pageSize` | SUPER_ADMIN | paginated `AdminTeamApplicationDto` (default status PENDING, oldest first) |
| `POST /admin/team-applications/:id/approve` | SUPER_ADMIN+CSRF | `{ note? }` → `TeamApplicationDto` (APPROVED, `createdTeam` set) |
| `POST /admin/team-applications/:id/reject` | SUPER_ADMIN+CSRF | `{ reason }` → `TeamApplicationDto` (REJECTED) |

`TeamApplicationDto`: `{ id, name, tag, slug (requested), countryCode, description, status,
reviewReason, reviewedAt, createdAt, createdTeam: { id, slug, name } | null }`.
`AdminTeamApplicationDto` = `TeamApplicationDto` + `applicant: { userId, steamId64, nickname,
playerSlug }` + `reviewedById`.

**Approve transaction:** `SELECT … FROM team_applications WHERE id = $1 FOR UPDATE` → status must
be PENDING (else 409 `APPLICATION_NOT_PENDING`) → applicant still ACTIVE, non-sample (else 409
`APPLICANT_INELIGIBLE`) and without active membership (409 `APPLICANT_IN_TEAM`) → pick free slug →
insert team (name/tag unique violations → 409 `TEAM_NAME_TAKEN` / `TEAM_TAG_TAKEN`; the admin
then rejects) → insert CAPTAIN membership → set application APPROVED, `created_team_id`,
reviewer → audit `team_application.approve` + `team.create` + `team_membership.join`. Two
concurrent approvals ⇒ exactly one team; the loser gets 409 (or the stored response on an
idempotent replay).

### 4.2 Teams (public + management)
| Method & path | Auth | Request → Response |
|---|---|---|
| `GET /teams`, `GET /teams/:slug` | public | existing M0 DTOs; roster = active memberships of ACTIVE users |
| `GET /teams/:slug/roster-history?page&pageSize` | public | paginated `RosterHistoryEntryDto { playerSlug, nickname, role, joinedAt, leftAt, leftReason }` (newest first; `leftReason` only `left` / `removed` / `role_change` / `captain_transfer` / `admin`, never free text) |
| `GET /teams/:slug/manage` | team operator | `TeamManageDto { team: TeamDetailDto, pendingInvitations: TeamInvitationDto[], permissions: { canInvite, canRemove, canTransfer }, rosterCap, pendingInvitationCap }` |
| `POST /teams` | SUPER_ADMIN+CSRF | `{ name, tag, countryCode?, description?, captainUserId, reason }` → 201 `TeamDetailDto` |
| `POST /teams/:teamId/invitations` | operator+CSRF | `{ steamId64, role: PLAYER\|SUBSTITUTE }` → 201 `TeamInvitationDto` |
| `POST /teams/:teamId/invitations/:invitationId/revoke` | operator+CSRF | `{ reason? }` → `TeamInvitationDto` (REVOKED) |
| `POST /teams/:teamId/members/:userId/remove` | operator+CSRF | `{ reason }` → 204 |
| `POST /teams/:teamId/leave` | member+CSRF | → 204 |
| `POST /teams/:teamId/transfer-captain` | captain/SUPER_ADMIN+CSRF | `{ newCaptainUserId }` → `TeamDetailDto` |

`TeamRosterEntryDto` (existing) gains `userId` (needed for remove/transfer; it is not secret).

### 4.3 Invitations (invitee side)
| Method & path | Auth | Request → Response |
|---|---|---|
| `GET /me/invitations?status` | session | `MyInvitationDto[]` (default PENDING; max 50) |
| `POST /invitations/:id/accept` | invitee+CSRF | → `MyInvitationDto` (ACCEPTED) |
| `POST /invitations/:id/decline` | invitee+CSRF | → `MyInvitationDto` (DECLINED) |

`TeamInvitationDto`: `{ id, status, role, expiresAt, createdAt, respondedAt, invitee: { userId,
steamId64, nickname, playerSlug }, invitedBy: { userId, nickname } }`.
`MyInvitationDto`: `{ id, status, role, expiresAt, createdAt, respondedAt, team: { id, slug,
name, tag }, invitedBy: { nickname } }`.

### 4.4 `/me` addition
`MeDto` gains `membership: { teamId, teamSlug, teamName, role, joinedAt } | null` (active
membership) — lets the web show "My team" / "Manage team" and hide "Apply" when in a team.

## 5. Invite rules
- Invitee resolved by `steamId64`; must be an existing ACTIVE non-sample user (else 404
  `PLAYER_NOT_FOUND` — players must sign in once before they can be invited; no placeholder
  users are ever created).
- Cannot invite yourself (DB CHECK), an active member of this team (409 `ALREADY_MEMBER`), or
  someone with a PENDING invitation to this team (409 `INVITATION_ALREADY_PENDING`, DB partial
  unique). Inviting someone who is in **another** team is allowed; they must leave it before
  accepting.
- Pending invitation cap per team (409 `INVITATION_LIMIT`); team must be ACTIVE (409
  `TEAM_NOT_ACTIVE`).

## 6. Membership transactions
### 6.1 Accept
Lock the team row (`SELECT … FROM teams WHERE id = $1 FOR UPDATE`) → lock the invitation → it
must belong to the session user (else 404) and be PENDING (else 409 `INVITATION_NOT_PENDING`) and
unexpired (else mark EXPIRED, 409 `INVITATION_EXPIRED`) → team ACTIVE → user has no active
membership (409 `ALREADY_IN_TEAM`) → active roster count < `ROSTER_CAP` (409 `ROSTER_FULL`) →
insert membership (`invitation_id` unique ⇒ idempotent) → mark ACCEPTED + `responded_at` → audit
`team_invitation.accept` + `team_membership.join`. Concurrent accepts by different users into the
last slot ⇒ exactly one succeeds (team row lock). Accepting two teams concurrently ⇒ one
membership (DB unique). Accepting does **not** auto-decline other invitations; they fail on
accept while the user is in a team.

### 6.2 Remove / leave / transfer
- Remove/leave: set `left_at = now()`, `left_reason` (`removed` / `left`). The caller's operator
  status is re-checked inside the transaction (lock team row).
- Transfer: lock team row → current captain row and target row active in this team → close both
  rows (`left_reason = captain_transfer`) → open CAPTAIN row for target and PLAYER row for the old
  captain (same `joined_at` = now) → audit `team.captain_transfer`.

### 6.3 Revoke / decline
State must be PENDING; set REVOKED/DECLINED + `responded_at`; audit.

### 6.4 Lazy expiry
No background job in M2. Any read or action that touches a PENDING invitation with
`expires_at <= now()` treats it as EXPIRED and persists `status = EXPIRED, responded_at =
expires_at`-or-now in the same request (best effort for reads, mandatory inside accept). A
BullMQ sweep may be added later.

## 7. Idempotency (implements API_CONVENTIONS §8)
- Header `Idempotency-Key`: 16–64 chars `^[A-Za-z0-9_-]+$` (UUIDs fit). Optional on all M2 unsafe
  endpoints; the web client sends a fresh UUID per user intent.
- Table `idempotency_keys(id, user_id, key, method, route, request_hash, status IN_PROGRESS|
  COMPLETED, response_status, response_body jsonb, created_at, expires_at)`, unique
  `(user_id, key)`, retention 24 h (expired rows ignored and overwritten).
- Same key + same method/route/body hash after completion ⇒ stored status/body, header
  `Idempotency-Replayed: true`. Same key, different request ⇒ 409 `IDEMPOTENCY_KEY_REUSED`.
  Still in progress ⇒ 409 `IDEMPOTENCY_IN_PROGRESS` + `Retry-After: 1`. Only 2xx responses are
  stored; an error releases the key.
- `request_hash` = SHA-256 of `method + route template + params + canonical JSON body`.

## 8. Error codes (added to AUTH.md §9a set)
`SAMPLE_RESOURCE`, `APPLICATION_ALREADY_PENDING`, `APPLICATION_NOT_PENDING`, `APPLICANT_IN_TEAM`,
`APPLICANT_INELIGIBLE`, `TEAM_NAME_TAKEN`, `TEAM_TAG_TAKEN`, `TEAM_NOT_ACTIVE`,
`PLAYER_NOT_FOUND`, `ALREADY_MEMBER`, `INVITATION_ALREADY_PENDING`, `INVITATION_LIMIT`,
`INVITATION_NOT_PENDING`, `INVITATION_EXPIRED`, `ALREADY_IN_TEAM`, `ROSTER_FULL`,
`NOT_TEAM_MEMBER`, `CAPTAIN_MUST_TRANSFER`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`.
Plus M1 `UNAUTHENTICATED`, `CSRF_FAILED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`, `RATE_LIMITED`.

## 9. Audit actions (M2)
`team_application.submit`, `team_application.withdraw`, `team_application.approve`,
`team_application.reject`, `team.create`, `team.captain_transfer`, `team_invitation.create`,
`team_invitation.revoke`, `team_invitation.accept`, `team_invitation.decline`,
`team_invitation.expire`, `team_membership.join`, `team_membership.leave`,
`team_membership.remove`. `detail` carries ids, roles, reasons and `override: true` for
SUPER_ADMIN acting on someone else's team. No free-text reasons are shown publicly.

## 10. Web
| Route | Behaviour |
|---|---|
| `/teams/apply` | signed-in: form + own applications with status and reject reason; hidden/disabled when in a team or PENDING exists; anonymous → login |
| `/me/invitations` | pending invitations with Accept/Decline; history tab |
| `/teams/[slug]` | public roster (current) + roster history; "Manage" link for operators |
| `/teams/[slug]/manage` | roster with Remove / Make captain; invite by SteamID64 (or picking from `/players` search); pending invitations with Revoke |
| `/admin/team-applications` | PENDING queue (filter by status), Approve / Reject with reason |
| `/me` | shows current team membership + Leave |

All mutations go through the existing CSRF-aware browser client, send an `Idempotency-Key`, and
map every error code above to a translated message (en/ru/kk).

## 11. Acceptance mapping
A3 (applications, concurrent approvals), A4 (invitations, expiry, revoke, cap, one-active
policy, history), A9 (object-level auth, 404 for others' invitations/applications), A10
(public pages, states, i18n). Concurrency tests are mandatory for: double approve, double accept
(same and different users at the last slot), accept vs revoke, transfer vs remove.
