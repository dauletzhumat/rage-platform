# RAGE Platform — Claude Code project instructions

## Mission
Build a reliable CS2 tournament platform with FACEIT-inspired competitive workflows, HLTV-inspired information architecture, and original RAGE black/white/red visual identity. Avoid copying third-party protected designs, source code, trademarks or assets. The platform is **not** an external FACEIT/HLTV/eBot integration. It has its own backend and eBot-style match control powered by verified CS2 integrations.

## Source of truth / reading order
1. Read `docs/MASTER_PROMPT.md` completely.
2. Read `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, `docs/ACCEPTANCE.md`.
3. Inspect repository and existing code before any implementation.
4. Maintain `docs/DECISIONS.md`, `docs/PROGRESS.md` while working.

## Non-negotiable product rules
- **Steam OpenID** is mandatory for player sign-in; verified SteamID64 is stable identity; never trust an unverified SteamID from browser.
- Every prospective captain must sign in first, submit a **team creation application**; only admin approval produces a team.
- Players are registered independently and explicitly accept a captain's invitation. Manager cannot impersonate a player.
- Tournament roster snapshots are locked separately from mutable team roster; substitutions require tournament policy and auditing.
- Public team/player/match/tournament pages are accessible without logging in.
- Public team pages resemble HLTV's information organization (not exact visual copies); Matchroom and tournament workflows resemble FACEIT (not exact visual copies).
- Match authority is RAGE API + state machine; server adapter uses MatchZy/CounterStrikeSharp after compatibility evaluation.
- Admin server commands are not arbitrary shell or RCON inputs. Use a strict allowlist, authorization, audit and acknowledgement.
- Live events are idempotent; scores and results must be server-confirmed; raw events are retained for recalculation.
- No fake production statistics; clearly mark sample UI/seed data.
- Never claim end-to-end Steam/CS2 integration without verified real credentials and a running game server.

## Default implementation stack (check latest compatibility before installing)
- TypeScript, pnpm workspaces + Turborepo (if useful); Next.js App Router, Tailwind, shadcn/ui, React.
- NestJS API with OpenAPI, DTO validation, REST and Socket.IO.
- PostgreSQL + Prisma; Redis + BullMQ; S3-compatible demo storage.
- CS2 bridge: MatchZy + CounterStrikeSharp C# plugin where needed; .NET server agent / adapter. Version pin and inspect supported runtime.
- Docker Compose local development, CI, logs, health checks, tests.
- Prefer supported stable releases, commit lockfile. Avoid inventing version numbers.

## Agent dispatch
Delegate bounded tasks to project subagents in `.claude/agents/`. Proactively use architect for cross-cutting changes, steam-auth for sign-in, team-management for roster flows, cs2-integration for real game adapters, security and qa for every release gate. Agents should return a focused summary, files changed, risks, and tests. Do not let multiple agents modify the same files simultaneously; assign explicit file ownership.

## Delivery behavior
- Follow milestones in `docs/MASTER_PROMPT.md`, not a monolithic code dump.
- First create a working Foundation (infra, web, API, DB, auth scaffolding, admin shell, seed, tests).
- Before coding each milestone: requirements + planned files + verification + blockers. Then implement immediately without requiring unnecessary user confirmations.
- After changes: typecheck, lint, unit tests, integration tests where feasible, build; report commands and actual outcomes.
- Never overwrite existing project work or secrets. No dangerous production migrations or destructive commands without explicit approval.
- Update docs and report `Done / Verified / Blocked / Next` precisely.
