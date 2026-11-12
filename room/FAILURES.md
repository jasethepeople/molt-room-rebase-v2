# Build and verification failures

## Gateway baseline in parallel

- The first parallel Gateway baseline run timed out one registry-listing test at 20 seconds (`reports/baseline-gateway-incomplete-parallel-attempt.log`); 24 other tests passed.
- Cause was the test's 20-second timeout under concurrent Room/Gateway load, not a Gateway assertion failure.
- The isolated serial retry passed all 25 Gateway tests; its full output is `reports/baseline-gateway-serial-retry.log`. The final Gateway build and suite were also rerun serially.

## Initial typecheck

- The first new-test typecheck reported one unused callback parameter, two unused imports, and optional usage fields read without narrowing (`reports/first-typecheck-errors.log`).
- These were test-code issues. The unused values were removed and the usage assertion narrowed; the final `npm run typecheck` output is in `reports/typecheck.log`.

## First full Room run

- The first run had 88 tests: 86 passed, 1 failed, 1 skipped (`reports/first-full-suite-failed-expectation.log`). Its only failure compared the raw prompt fixture to the signed assignment body. The Room's existing assignment admission strips allowed filler before it signs the assignment, so the e2e assertion was testing the unsaved raw input, not the signed source of truth.
- The fixture was changed to use ordinary exact text, and the test now checks the Gateway echo against the exact prompt in the signed assignment. No Room behavior or acceptance check was weakened.

## Offline status wording

- One focused test initially expected the phrase `Gateway is not available`; the code correctly returned `Gateway is not reachable at the configured loopback host`. The assertion was changed to check the stable `configured loopback host` wording. The focused tests were rerun afterward.

## First independent audit of the 61-case candidate

- The verifier found a mistyped Gateway commit hash and an overstatement that the unavailable-path test had exercised the CLI. The report now uses the exact 40-character commit and says `runGatewayAssignedTask()` returned `not-available`.
- The verifier identified a race where concurrent calls for one assignment could both pass the sequential duplicate check. An exclusive per-assignment lock and a concurrent-dispatch regression assertion were added; a process crash can leave a lock that must be inspected before manual removal.
- The candidate's quarantine wording was corrected: budget preflight records reason/hash metadata without the result text, but the stored hash is a failure identifier, not a hash of the rejected result.
- A clean Gateway dependency install reported 6 upstream vulnerabilities (3 moderate, 1 high, 2 critical). The pinned Gateway manifest/lock were not changed.
- The first independent run tested the same Room source/tests but the older candidate docs. A final archive rerun is required after these corrections.

## Final status

See the final suite summaries and raw output paths in `REPORT.md`. The failed first attempts above remain included to make the repair history auditable.
