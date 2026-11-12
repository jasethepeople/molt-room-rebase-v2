# Room → Integration Gateway rebase bundle

This bundle contains the Room source tree based on `jasethepeople/molt-room` commit `d6f975f7c0b7394246503ff637a1461a4c38cac4`, with a loopback-only A2A member adapter. The gateway reference is pinned to `jasethepeople/integration-gateway` commit `acb4c399ad6ba19ee87ba01bb7bbd5b678591791`.

## Contents

- `room/` — complete Room source tree, the gateway adapter, and gateway-specific tests.
- `room/delivery/` — historical files from the pinned Room tree; the current run's outputs are under top-level `reports/`.
- `references/` — the required build skill. Owner-provided contract and amendments are in `room/` beside the source.
- `reports/` — baseline, build, typecheck, test, and independent-verifier outputs.
- `BRIEF.md` — pinned scope and owner rulings.
- `REPORT.md` — change summary, attack outcomes, validation, and remaining caveats.

The Room contract and `verify.ts` are byte-identical to the pinned source. The Gateway repository was not modified. No database or SQL migration exists for this change. No public service, deployment, push, or live-VM call was made. The pinned Gateway suite includes an existing unauthenticated read-only GET to a public GitHub repository; no credentials or writes were involved.

## Re-run

Use Node.js 22.18 or newer. Check out the gateway at the exact pinned commit and install its dependencies; then, in `room/`:

```sh
npm ci
npm run typecheck
ROOM_GATEWAY_PATH=/path/to/integration-gateway npm test
```

The gateway integration test imports the pinned server factory, copies only its `native/echo` component into a disposable registry, and binds the server to `127.0.0.1` on an ephemeral port. The child process receives a clean environment without app credentials. The optional Ollama test is the one expected skip when no local model is available.

Tests create temporary identities only inside isolated temporary homes and remove them afterward. The `member-add-gateway` CLI command creates a persistent Room member identity under the selected Room home; it was not run against a real Room here. Do not use this adapter for write-capable Gateway targets: the pinned A2A endpoint has no caller-authentication gate and does not forward per-request retry settings.

See `REPORT.md` for the exact acceptance results and open items.
