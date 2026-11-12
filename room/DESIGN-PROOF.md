# Gateway-member design proof

## Frozen surfaces and pins

- The Room source is pinned to `jasethepeople/molt-room` commit `d6f975f7c0b7394246503ff637a1461a4c38cac4`; the integration gateway is pinned to `jasethepeople/integration-gateway` commit `acb4c399ad6ba19ee87ba01bb7bbd5b678591791`.
- `ROOM-CONTRACT.md` and `verify.ts` are unchanged byte-for-byte from the Room pin. Gateway functionality is represented using the existing `membership`, `turn`, and `budget` event bodies; no new signed event type or hashed numeric field was added.
- The Gateway repository was not modified. No remote push, service publish, live-VM call, production Room, or database write was made.

## Dispatch and admission

- `member-add-gateway` creates an explicit `harness-agent` membership with model marker `gateway:a2a`, a signed `tools` target list, declared thread subscriptions, and the existing integer `budgetTokens` field.
- `run-gateway-member` verifies the complete Room chain and stable head before dispatch. It accepts only an existing signed turn addressed to that member, authored by a present human, on a subscribed thread. A selected target must appear in the member's signed tool list and match the gateway target grammar.
- The A2A request sends only `{ target, event: { assignmentEventId, threadId, prompt } }`. It sends no Room history, app auth, gateway config, or credentials. The prompt is read from the signed assignment event after the Room's normal assignment admission rules have run.
- The host accepts only literal `127.0.0.0/8` or `::1` HTTP origins. Paths, queries, fragments, credentials, non-loopback hosts, redirects, and malformed origins fail closed. Requests have a 15-second deadline and response bodies are bounded to 1 MiB.
- The response validator requires the matching JSON-RPC id, a completed task, one `execute-response` artifact, matching target, `ok: true`, and safe-integer attempt/duration metadata. Invalid or failed responses do not append a member turn.
- The full component `result` object is JSON-encoded with target/task/assignment/thread metadata into one ordinary signed turn. The Gateway result does not pass through the text-stripper or a summarizer. The existing Room ledger preflight, thread subscription rules, signatures, and root verifier remain authoritative.
- An exclusive local per-assignment lock rejects concurrent dispatches; the signed response marker rejects sequential replays. A process crash may leave the lock and requires inspection against the Gateway execution log before manual cleanup. The Gateway itself has no caller authentication or idempotency key and may retry internally, so use only read-only/idempotent targets.

## Budget behavior

- The member's actual turn records integer Room-side estimates for input and output. These are not provider or Gateway billing measurements.
- Member totals and per-thread usage are tracked. Thread-scoped pause events report the selected thread's consumed usage, and an exhausted lifetime budget is recorded as a signed human pause. A result that would exceed the existing limit is not truncated or partially admitted; failure-reason/hash metadata is retained without result text and a signed pause is appended. Because budget preflight rejects before building the candidate event, its current hash is an admission-failure identifier, not a digest of the rejected result.
- The frozen contract defines `budgetTokens` as the member's room-lifetime cap. Per-thread usage and pause state are visible, but independent per-thread allowances would require a contract change; none was made.

## Executed verification

- The integration harness imports the pinned Gateway's real `createServer` factory, copies only the pinned `native/echo` component into a disposable registry, and binds an ephemeral port explicitly to `127.0.0.1` with a clean child-process environment.
- The Room e2e test admits a full Gateway result as a signed turn, checks the root verifier, rejects a sequential duplicate, then completes the existing signed challenge/verdict flow.
- Protocol and ledger attack outcomes, test counts, caveats, and the independent verifier's result are recorded in the bundle-level `REPORT.md` and `reports/`.

## Remaining limits

The pinned Gateway `/a2a` endpoint has no caller-authentication gate. Its A2A projection also drops request-level retry settings, leaving the router's default retries. Keep it bound to loopback and do not run write-capable targets through this adapter. The Oracle VM, Foundry, OpenWeather, and any external app credentials were not used. The owner's laptop run and still-open human exit review remain owner-reported, not revalidated here.
