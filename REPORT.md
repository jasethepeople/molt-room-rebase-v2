# Build and verification report — Room gateway-member rebase

## Verdict

The gateway-member rebase passes the acceptance criteria that can be exercised without the owner's VM or production credentials. A first independent audit of the earlier 61-case candidate found a report pin typo, an overstated CLI test claim, and a concurrent-dispatch gap. Those were corrected, the adapter gained an exclusive per-assignment lock with a regression test, and a fresh extraction of the updated candidate passed typecheck and the complete Room and pinned Gateway suites.

No deployment, push, publish, live-VM request, database write, or external app action from the new Room integration was performed. The pinned Gateway's existing suite makes one unauthenticated read-only GET to public GitHub. No production Room identity/key or real Room was created. The automated suites create disposable test identities only in isolated temporary homes and remove them after each run; this is test-only key generation, not a deploy identity.

## Pinned inputs and protected files

- Room source: `jasethepeople/molt-room` commit `d6f975f7c0b7394246503ff637a1461a4c38cac4`.
- Gateway source: `jasethepeople/integration-gateway` commit `acb4c399ad6ba19ee87ba01bb7bbd5b678591791`.
- Owner-supplied `ROOM-CONTRACT.md` is byte-identical to the pinned Room file; `verify.ts` is unchanged. SHA-256 values and byte comparisons are retained in `reports/source-integrity.txt` after final assembly.
- The attached amendments file is also included. It differs from the Room repo's older `ROOM-CONTRACT-PASTE-2026-10-28.md`: the old copy contains an additional typed-template/anatomy/seal-write-path note and middleware/timing closing notes. Both copies are retained separately and unmodified; the attached amendments are the current reference. Neither alters the frozen base contract.
- No database or SQL migration exists or was needed. No Gateway source, `package.json`, or Room lockfile was changed; the adapter uses Node's built-in `fetch`.

## Changed Room files

- `room/src/gateway.ts` — loopback-only A2A client; strict origin/target validation; bounded response reading, timeout, no redirects, JSON-RPC/task/artifact validation.
- `room/src/room.ts` — gateway-backed harness membership and assignment runner; verifies the signed Room chain and assignment, enforces target/thread/budget policy, records the complete component result as one ordinary signed turn, and pauses on exhaustion.
- `room/src/cli.ts` — `member-add-gateway` and `run-gateway-member` commands; status includes thread usage.
- `room/src/index.ts` — exports the adapter.
- `room/src/ledger.ts`, `room/src/types.ts` — additive thread-usage accounting and runtime status fields. The existing `budgetTokens` lifetime cap and all contract event shapes remain unchanged.
- `room/tests/gateway-client.test.ts`, `room/tests/gateway-member.test.ts`, `room/tests/fixtures/gateway-loopback-server.mjs` — protocol/security attacks and a real, loopback-bound integration test.
- Project README, design proof, and failure log updated for this build. `room/FAILURES.md` preserves the first-attempt errors and their corrections.

## Acceptance and builder-run results

| Acceptance | Result | Evidence |
|---|---|---|
| Existing Room verifier, ledger, and live-member tests | PASS | Full Room run includes unchanged contract/verifier and Ollama stub tests. |
| Gateway component executes and becomes a signed Room turn | PASS | Pinned `native/echo` executed through actual Gateway `message/send`; Room root verification passed. |
| Challenge and signed verdict with gateway member | PASS | Same end-to-end Room; challenged the gateway turn, admitted a signed verdict, then verified the chain. |
| Loopback-only integration | PASS | Test starts the pinned Gateway server factory on an ephemeral `127.0.0.1` socket and asserts the actual bound address; client rejects non-loopback hosts and redirects. |
| Complete source, report, final bundle, and archive integrity | PASS | All 57 pinned Room files are present; the shipped zip passed integrity checks and byte-matched every file in the bundle. |

- Room: `npm ci` passed, 0 audit vulnerabilities reported; `npm run typecheck` passed; final `npm test` passed **107, failed 0, skipped 1** (**108 total**). The single skip is the existing optional local-Ollama check because no local model was reachable. Complete output: `reports/full-room-suite.log`.
- Focused gateway security/member suite: **66 passed, 0 failed**. Complete output: `reports/gateway-focused-tests.log`.
- Pinned Gateway `npm run build`: passed; full test suite: **25 passed, 0 failed**. Outputs: `reports/gateway-build.log` and `reports/gateway-suite.log`.
- CLI help ran and includes both gateway commands: `reports/cli-help.log`.
- Baseline before the rebase: Room **41 passed, 0 failed, 1 skipped**; Gateway serial retry **25 passed**. The first parallel Gateway baseline attempt hit its registry-listing test's 20-second timeout under concurrent load; the isolated retry and final serial run passed. Raw output is preserved in `reports/baseline-*.log`.
- Initial typecheck and first full-suite assertion failures were test-code mistakes, not softened acceptance criteria. They were fixed and rerun; the first-attempt logs and explanations remain in `reports/first-*.log` and `room/FAILURES.md`.

## Attack outcomes

The 62 listed attack cases passed across the final builder run and focused post-lock regression run. The first independent verifier run on the prior candidate passed its then-existing 61-case suite but identified report/archive drift and an untested concurrent-dispatch race; those findings were fixed and included in the fresh-extraction rerun. Host/target/error groups are individual nested subtests in `gateway-client.test.ts`; ledger/member cases are in `gateway-member.test.ts`.

1. DNS host `example.com` — rejected.
2. `localhost` hostname — rejected; only numeric loopback literals are accepted.
3. HTTPS loopback — rejected; only HTTP loopback is accepted.
4. Documentation IPv4 `192.0.2.1` — rejected.
5. Documentation IPv6 `2001:db8::1` — rejected.
6. URL path suffix — rejected.
7. URL query string — rejected.
8. URL user/password — rejected.
9. Private IPv4 `10.1.2.3` — rejected.
10. Link-local metadata address `169.254.169.254` — rejected.
11. Public address `1.1.1.1` — rejected.
12. IPv4-mapped loopback IPv6 — rejected.
13. Unique-local IPv6 — rejected.
14. Trailing-dot `localhost.` — rejected.
15. Invalid port `99999` — rejected.
16. Malformed URL — rejected.
17. Empty component target — rejected.
18. Parent-relative target `../echo` — rejected.
19. In-component traversal `native/../echo` — rejected.
20. Target with query syntax — rejected.
21. Incomplete external target lacking a component — rejected.
22. External target traversal — rejected.
23. Uppercase target segment — rejected.
24. Excess target path segments — rejected.
25. Percent-encoded dot traversal — rejected.
26. Backslash traversal — rejected.
27. Newline in target — rejected.
28. NUL in target — rejected.
29. Unsafe host supplied to a request — rejected before the local stub received a request.
30. Unsafe target supplied to a request — rejected before the local stub received a request.
31. Mismatched JSON-RPC response ID — rejected.
32. JSON-RPC error object — rejected.
33. Missing A2A task — rejected.
34. Failed task state — rejected.
35. Missing `execute-response` artifact — rejected.
36. Duplicate `execute-response` artifacts — rejected.
37. Response for a different component target — rejected.
38. Fractional duration metadata — rejected.
39. Zero attempt count — rejected.
40. Component response with `ok: false` — rejected.
41. HTTP 401 without credentials — surfaced as unavailable; no credential was sent.
42. HTTP 404 — rejected.
43. HTTP 500 — rejected.
44. HTML instead of JSON — rejected.
45. Malformed JSON body — rejected.
46. Declared response larger than 1 MiB — rejected before parsing.
47. Chunked response larger than 1 MiB — rejected while streaming.
48. Redirect to another local server — rejected; destination received zero requests.
49. Gateway membership with a traversal target — rejected before key creation or ledger append.
50. Gateway membership with an undeclared thread — rejected before key creation or ledger append.
51. Assignment addressed to a different member — rejected before network dispatch.
52. Assignment authored by a non-human member — rejected before network dispatch.
53. Target not in the member's signed tool list — rejected before network dispatch.
54. Missing assignment event ID — rejected before network dispatch.
55. Result larger than the remaining member budget — full result was neither truncated nor admitted; a reason/hash-only quarantine record (no result text) and signed exhaustion pause were recorded; Room verification passed. The current quarantine hash is an admission-failure identifier, not a hash of the rejected result.
56. Tampered Room chain — runner stopped at verification; stub received zero requests.
57. Exhausted member lifetime budget — gateway not called; signed human budget pause recorded; usage snapshot was 12 tokens.
58. Thread-scoped signed budget pause — gateway not called; ledger unchanged after pause; verifier passed.
59. Concurrent usage consuming the remaining budget while Gateway was responding — locked admission rejected the Gateway turn, retained no partial output, and recorded a signed pause; verifier passed.
60. Offline loopback Gateway — `runGatewayAssignedTask()` returned `not-available`; event hashes before and after were equal; verifier passed.
61. Sequential duplicate execution of an already recorded assignment — rejected; the pinned Gateway execution log still contained exactly one execution.
62. Concurrent duplicate invocation while the first A2A call is pending — exclusive per-assignment lock rejected the second call before dispatch; Gateway saw exactly one request.

## Open items and hard boundaries

- The pinned Gateway's `/a2a` route has no caller-authentication gate. Its A2A request projection drops request-level retry settings, so router defaults can retry. The Room adapter's exclusive lock prevents concurrent local dispatches for one assignment, but cannot prevent Gateway-internal retries or direct calls. Keep the Gateway process bound to loopback; restrict configured targets to read-only/idempotent components. Do not use write-capable targets or expose `/a2a` publicly. A process crash can leave a local dispatch lock; inspect Gateway execution before manually removing it.
- A fresh `npm ci` of the pinned Gateway reported 6 dependency vulnerabilities (3 moderate, 1 high, 2 critical). The Gateway manifest and lockfile were not changed, and no audit fix was applied.
- The Gateway integration test uses only `native/echo`; it does not call OpenWeather, the owner's Oracle VM, Foundry, or any external app connector. The Gateway repo's existing test suite makes one unauthenticated, read-only GET to a public GitHub repository; it performs no write and uses no credentials.
- Room `budgetTokens` remains the frozen room-lifetime member cap. Thread usage is counted and thread-scoped pauses are recorded, but independent per-thread allowances would require a contract amendment; none was made. Usage estimates are Room-side estimates, not Gateway/provider billing measurements.
- The owner's laptop live-member result and the still-open human exit review are historical owner-reported facts; neither was re-run or represented as complete.
- No deploy or production-key checklist was executed. A separate owner go would be required before any future live configuration.

## Fresh-extraction verification

The updated candidate archive (SHA-256 `bf22448eb972b32ccb54f4924c385fa4d0a277efe3f97627686e2d190731f24d`) was extracted to a clean temporary directory and verified without source edits. Room `npm ci` and `npm run typecheck` passed; the full Room suite passed 107/108 tests with one pre-existing optional live-Ollama skip. A fresh Gateway dependency install, build, and test run passed all 25 tests at the pinned commit. Raw output is in `reports/final-verification/`. This rerun includes the per-assignment dispatch lock and its concurrency regression test. The separate first independent audit and its findings are retained in `reports/first-independent-verifier.log`; all identified issues are resolved in the final tree.
