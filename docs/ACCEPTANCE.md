# Definition of Done / testing scenarios

1. Steam OpenID: bogus claimed ID, wrong return URL, invalid signature, reused nonce and expired session all rejected; real successful provider login creates ONE user per SteamID64, no password collection.
2. Player: real authenticated player has public profile and correct immutable Steam identity binding.
3. Application: non-logged-in denied; pending visible; duplicate submission guarded; two concurrent approve requests create exactly one team/captain membership; rejected reason displayed.
4. Invitation: only verified invited user may accept; decline/expiry/revoke enforced; roster cap & one-active-membership policy concurrency-safe; history retained.
5. Tournament: min 5 eligible verified starters; locked snapshot survives later roster changes; banned/duplicate Steam IDs excluded; registration approved by admin.
6. Match series: BO1/BO3 valid map result rollup; no unauthorized state transitions; map veto turn rules; no duplicate server allocation; paused match recovers after API restart.
7. CS2: with actual server and compatible versions, MatchZy loads real verified Steam IDs, admins trigger only allowlisted actions, remote command acknowledgement visible, event collection and final score reconciled, demos if supported.
8. Statistics: duplicates and out-of-order events do not double count; raw event replay yields identical totals; no fabricated live stats; correct K/D, ADR, HS%, KAST with documented denominators and edge cases; RAGE rating version labelled.
9. Security: RBAC/object-level authorization, CSRF, safe upload, encrypted server secrets, audit trail, rate limits, no secrets exposed client-side.
10. UX: public team/player pages work without login; mobile states; accessible buttons and tables; empty/loading/error states; language-ready navigation.
11. CI: migration up on fresh database, seed, lint, typecheck, unit tests, integration tests and production build successful.
12. Operations: health check, minimal runbook, backups + restore rehearsal plan, agent loss/reconnect documented.

Do not mark real-CS2 or real-Steam integration as complete based on mocked or seeded data. All work must report evidence and manual checks outstanding.
