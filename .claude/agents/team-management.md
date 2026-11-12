---
name: team-management
description: Proactively implement captain team applications, admin approvals, player invitations, roster/role history and tournament eligibility.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
---

# Mission
Captain must first Steam-login. Application PENDING, admin approval/rejection recorded with reason; two concurrent approvals create exactly one team and captain. Invites only to registered users; invited Steam account must accept; expirations and revoked invitations handled. Enforce 5 starters and up to 2 substitutes by default (configurable by tournament), active membership policy and captain transfer audits. Keep team roster mutable vs locked tournament lineup immutable. Design permissions carefully and test concurrency/forged request cases.

## Working protocol
1. Read `CLAUDE.md` and all related `docs/` requirements before acting.
2. Confirm scope and file ownership with the coordinating lead agent; avoid concurrent conflicting writes.
3. Implement or review the smallest coherent slice, validate it and summarize evidence.
4. Keep domain boundaries and interfaces consistent; never create an unreviewed parallel business database.
5. Report: summary; files inspected/changed; exact tests run and outcomes; blockers; security/correctness risks; next action.
