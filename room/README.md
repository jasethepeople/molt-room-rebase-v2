# The Room — contract-shaped local core

## Repository status

This tree starts from `jasethepeople/molt-room` commit `d6f975f7c0b7394246503ff637a1461a4c38cac4`. The gateway integration is pinned to `jasethepeople/integration-gateway` commit `acb4c399ad6ba19ee87ba01bb7bbd5b678591791`. The frozen contract and root `verify.ts` remain byte-identical to the Room source pin. No Gateway source, live service, deployment, or production Room was changed or started.

The existing laptop live-member acceptance and the still-open human exit review remain owner-reported; this bundle does not claim to have re-run either. Automated validation and its one optional Ollama skip are recorded in the bundle-level report and test logs.

The Room remains a standalone Node.js/TypeScript signed ledger. The gateway adapter is an explicit harness-member path over local A2A `message/send`; the JSONL transcript stays the authority, and existing challenge, verdict, canon, seal, and verifier rules are unchanged. Tests create disposable identities only in isolated temporary homes.

## Run

Requires Node.js 22.18 or newer.

```sh
npm ci
npm run typecheck
npm test
npm run room -- spawn evidence-room "A room for careful evidence" --home /tmp/room-home
npm run room -- verify evidence-room-12345678 --home /tmp/room-home
```

Use the actual `roomId` printed by `spawn`; the example suffix is illustrative. The default home is `~/.the-room` or `ROOM_HOME`. `spawn` loads `template/default/template.json`, creates fresh Ed25519 identities, writes a typed genesis registry and signed system event, then runs the root verifier before returning. The default is one human plus one `fixture:*` harness member. `--members N` adds fixture identities only; it does not start models.

Private keys are stored outside each room under `<home>/keys/`, with owner-only permissions. A room lives under `<home>/rooms/<room-id>/`; public-key fingerprints are the lowercase SHA-256 of the decoded SPKI public-key bytes. Runtime keys and rooms are not part of the source bundle.

## Contract behavior

`transcript.jsonl` is the authority. Each line is a complete contract event envelope with a UUIDv7 ID, consecutive sequence, previous-event hash, canonical payload hash, and Ed25519 signature. The root verifier is the source of truth: if it rejects a staged candidate, the core rejects it too. Failed admission rolls back the transcript and staged files, writes digest/reason-only quarantine metadata, and emits a local `ALERT JASON` message.

The amendment paste supplies the typed canonical rule `{ id, minCosigns }`; it remains a separate document and does not edit the base contract. The core emits only contract event kinds: system, membership, turn, challenge, verdict, proposal, cosign, canon, budget, seam, and seal. A challenge gets at most one verdict; a superseding proposal must cite an earlier proposal; canon replay uses the typed current rule. Member roles are resolved through their registered public keys.

`transcript.md` renders complete envelopes without replacing or summarizing the log. `seams.md` is the human-readable seam view. A seam operation appends its signed seam event and a signed seal checkpoint. A seal snapshots the exact current `seams.md` bytes to `seams.<seq>.md` before the seal event is appended; if the snapshot cannot be written, the event is not written. The root verifier checks the latest seal against the current seam file and historical seals against their snapshots.

The `task` command records an assignment as an ordinary signed human turn. Fixture output is another signed turn. The optional local Ollama member consumes an assignment by its existing event ID and submits its draft only through ordinary turn admission. Exit requests, human decisions, and releases are also represented by signed turns so no non-contract event kinds are introduced; a release requires the human's signed acceptance at the reviewed chain head and is returned only after post-write verification.

## One local Ollama member

Add the room's single live harness member with `member-add-ollama <room-id> <name...> --budget N`. The existing `task` command assigns work; use its signed event ID with `run-member <room-id> <member-or-fingerprint> <assignment-event-id>`. The member must be assigned to the same existing thread, and the assignment must be a signed turn addressed to that member and authored by a present human.

The host defaults to `http://127.0.0.1:11434`. Override it with `--ollama-host URL` or `ROOM_OLLAMA_HOST`; both must resolve to a loopback HTTP origin. Select a model with `--model NAME` or `ROOM_OLLAMA_MODEL`. Without a selection, the member uses the first model name returned by the live Ollama `/api/tags` probe. No model name is built into the project or assumed to be installed. The adapter uses built-in `fetch` only for the local `/api/tags` and `/api/generate` endpoints and rejects redirects.

The member registry uses `ollama:runtime` as an adapter marker, not as the name of an installed model. The actual local model name is resolved only by the runtime probe.

The generated text is an in-memory draft, never a direct ledger write. The runner verifies the room before contacting Ollama, limits requested generation using remaining budget, validates the returned integer usage, and submits the draft to the existing `postTurn` admission path. That path checks policy and budget on original text, applies wrapper stripping before filler stripping, signs, and uses the existing local and root-verifier checks. The command reports the admitted turn as pending human exit review. If Ollama is unavailable, it reports `NOT AVAILABLE` and does not append an event. It does not retry. The server's returned token counts are checked before admission; the project's pre-call prompt estimate is not an independent model tokenizer or backend usage meter.

## Gateway-backed member

Add a gateway harness member with `member-add-gateway <room-id> <name...> --budget N --tool native/echo`. Add more `--tool TARGET` entries only when intentionally granting those targets; `--subscribe THREAD` restricts the member to declared threads. Assign a signed human task with `task`, then run it with `run-gateway-member <room-id> <member-or-fingerprint> <assignment-event-id>`. If only one target is granted, `--target` may be omitted.

The A2A client posts JSON-RPC `message/send` to `/a2a`. Its default origin is `http://127.0.0.1:3000`; `--gateway-host` and `ROOM_GATEWAY_HOST` accept only literal IPv4/IPv6 loopback HTTP origins, with no path, query, credentials, or redirects. The request contains only the selected target and the signed assignment's ID, thread, and text—not room history, credentials, or a separate `auth`/`config` payload. A completed task must return one valid `execute-response` artifact for the same target. The full component result is JSON-encoded into one ordinary signed Room turn; no summarizer or truncation path is used. An exclusive local dispatch lock rejects concurrent requests for the same assignment; a signed response marker rejects later sequential replay. A process crash can leave a lock file, which must be inspected against Gateway execution before manual removal.

The runner verifies the Room before dispatch, checks the member's signed target list, human assignment, subscription, pause state, and remaining token budget. If a complete result would exceed budget, the turn is rejected without partial text, a failure-reason/hash metadata record is written without the result payload, and a signed budget pause is recorded. That record's current hash is an admission-failure identifier, not a digest of the rejected result. Status includes per-member and per-thread usage. The frozen `budgetTokens` field remains the existing room-lifetime cap; per-thread usage is reported and thread-scoped pauses are supported, but the frozen contract has no independent per-thread allowance field.

The pinned Gateway A2A endpoint has no caller-authentication gate, and its A2A message projection does not forward a request-level retry override; the router may use its default retries. Treat targets as read-only/idempotent, keep the Gateway bound to loopback, and do not use this path with write-capable targets until those Gateway controls exist. The real end-to-end test uses only `native/echo`, a temporary registry containing that pinned component, a clean child-process environment, and an explicitly loopback-bound ephemeral listener. It does not call external integrations or use secrets.

## Turn stripping and receipts

Turn admission checks policy and size on the original text, applies the existing wrapper strip, then the additive filler strip, and signs the resulting text. A rejected or oversized turn does not receive a receipt. The sidecar retains the original/stripped SHA-256 hashes, byte and line counts, rule IDs, token estimates, and hash-chain fields; `ruleSet` is `wrapper`, `filler`, or `both`.

Filler rules are deterministic and removal-only:

- **F1:** remove a leading `please` (optionally followed by a comma) and trailing `thanks`, `thank you`, `thank you so much`, or `thanks so much` (optionally followed by `!` or `.`).
- **F2:** at sentence starts, remove `could you please`, `can you please`, `would you please`, `will you please`, `would you mind`, `could you`, `can you`, `would you`, `will you`, `kindly`, or bare `please`.
- **F3:** remove `if you don't mind`, `when you get a chance`, `whenever you get a chance`, `if you have a moment`, `I was wondering if you could`, `I would appreciate it if you could`, `it would be great if you could`, `I'd like you to`, and `I would like you to` in prose.
- **F4:** remove `basically`, `essentially`, and `as a matter of fact`; `in order to` becomes `to` by deleting `in order`.
- **F5:** filler matching leaves fenced and inline code, URLs, file paths and filenames, JSON, camelCase/PascalCase identifiers, and text inside single or double quotes untouched.
- **F6:** after removal, collapse repeated spaces, trim outer whitespace, remove spaces before punctuation, drop orphan terminal commas, doubled punctuation, and sentences emptied by stripping. No capitalization or other case conversion is performed.
- **F7:** matching is case-insensitive and whole-word/phrase only.

The existing receipt's token and cost fields are deterministic estimates retained by the strip implementation. They are not Ollama token counts, provider charges, or measured savings. Integer micro-dollar fields remain part of the existing receipt format; displayed decimal-dollar text is not hashed.

## Commands

Run `npm run room -- help` for the full CLI. It supports spawn, verify, status, members, fixture/Ollama/Gateway member join and leave, signed task assignment, explicit local Ollama or Gateway execution, turns, challenges/verdicts, proposal/cosign/canon, global or thread-scoped budget pause/resume, seams/seals, exit review/release, and importing already-signed events. Thread declarations remain in genesis; member subscriptions are checked against them.

## Verifiers and tests

`verify.ts` is the contract-first standalone verifier. It imports only Node built-ins and remains independent of `src/`. The unchanged contract test includes the empty-copy test: the verifier runs with only `genesis.json` and `transcript.jsonl` beside it. A separate end-to-end test spawns a room through the migrated CLI and runs the unchanged root verifier against it. `tools/verify-transcript.mjs` is preserved as a dependency-free checker for the earlier scaffold format only; it is not valid for migrated rooms.

The contract-verifier tests and root verifier remain unchanged. Ollama stub coverage uses local fixed responses; the optional live-Ollama test reports `NOT RUN` if no configured model is reachable. Gateway protocol tests use local HTTP stubs, while the end-to-end test starts the pinned Gateway server factory on loopback and executes the pinned `native/echo` component. Run `npm run typecheck` and `ROOM_GATEWAY_PATH=/path/to/integration-gateway npm test` to include that real gateway test; without the path, only that test is skipped.

## Deliberate scope and stubs

Fixture members never call models. Ollama tests are labeled STUB unless the optional local-model case runs. The Gateway test does not exercise any external app, the owner's Oracle VM, Foundry, connector grants, or real credentials. Gateway result token counts are deterministic Room estimates, not Gateway/provider billing meters. The existing room-wide lifetime budget remains authoritative, with added per-thread counters and thread-scoped pause accounting. No new database, UI, public API, external alerting, or deployment wiring is included. The legacy portable verifier remains for legacy files only. The pinned Gateway A2A route is unauthenticated and does not forward per-request retry settings, so public or write-capable use is explicitly out of scope.

## Contract documents

`ROOM-CONTRACT.md` is byte-identical to the pinned contract and the owner attachment. The owner-provided `ROOM-CONTRACT-AMENDMENTS-2026-10-28.md` is included as the current reference. The pinned tree also contains the differently named historical `ROOM-CONTRACT-PASTE-2026-10-28.md`; it is retained unchanged and is not substituted for the owner attachment. No contract or verifier edit is part of this change.
