# Fresh independent verification

## Fresh extraction and commands

The first candidate archive was extracted into `/tmp/room-gateway-independent-verify.xelunZ/`; dependencies were installed in that extracted Room tree. The Gateway checkout was verified at commit `acb4c399ad6ba19ee87ba01bb7bbd5b678591791`. The raw outputs are under `reports/first-independent/results/` and the full audit is `reports/first-independent-verifier.log`.

- Room `npm ci`: passed.
- Room `npm run typecheck`: passed.
- `ROOM_GATEWAY_PATH=/home/.z/workspaces/con_IR1cdiGfdjGG0gU4/src/integration-gateway npm test`: 108 total; 107 passed, 0 failed, 1 skipped. The only skip is the optional local-Ollama test with no local model.
- Gateway `npm run build`: passed.
- Gateway `npm test`: 25 passed, 0 failed.

The fresh Gateway and Room test commands ran concurrently in this verifier pass; both completed without failures. The builder's final serial Gateway run also passed 25/25. No production Room, external connector, deployment, push, or write-capable action was used.

## Audit findings

- The owner contract and `verify.ts` match the pinned Room source; hashes and all 57 tracked-file comparisons are in `source-integrity.txt`. There are 8 intentional tracked changes and 4 new Room files; no tracked file is missing. Both source checkouts were clean.
- The 61 negative cases in the first candidate report are backed by executable tests. The focused gateway suites passed 66/66. Invalid origins/targets and HTTP/A2A failures fail closed; the actual `native/echo` call reaches a signed Room turn, survives challenge/verdict, and passes the Room root verifier.
- The first candidate's report contained a Gateway hash typo and incorrectly described the unavailable-path test as a CLI run. Its quarantine wording also overclaimed the hash: preflight stores reason/hash metadata without result text, but the hash is an admission-failure identifier, not a digest of the rejected result. Those report issues were corrected afterward.
- This first run did not cover simultaneous requests for one assignment. The verifier identified that gap; the adapter subsequently gained an exclusive per-assignment lock and a regression test. See the final report and final fresh rerun for the corrected version.
- No new package dependency, SQL migration, or secret/key file was added. The archive scan found no secret-like values or key files. The Room package and lockfile are unchanged.

## Scope caveats

The pinned Gateway A2A endpoint has no caller-authentication gate and drops request-level retry settings, so the adapter is loopback-only and must be restricted to read-only/idempotent component targets. The budget remains the frozen room-lifetime member cap; per-thread usage and scoped pauses are tracked, but independent per-thread allowances would require a contract change. No owner VM, Foundry credential, or OpenWeather action was used. The Gateway suite includes its existing unauthenticated, read-only public GitHub GET.
