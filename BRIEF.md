# Build brief — Room gateway member integration

## Source pins
- Room: `jasethepeople/molt-room`, commit `d6f975f7c0b7394246503ff637a1461a4c38cac4`. The Nov 4 prompt and other prior snapshots are reference only.
- Integration gateway: `jasethepeople/integration-gateway`, commit `acb4c399ad6ba19ee87ba01bb7bbd5b678591791`.
- The owner-provided `ROOM-CONTRACT.md`, 2026-10-28 amendments, and backend-prime skill are the current references. Keep `ROOM-CONTRACT.md` and `verify.ts` byte-identical to the pinned source.

## Owner rulings to preserve
- Rebase only Room member integration onto the gateway A2A `message/send` endpoint; gateway components are members' hands, not Room law.
- Keep transcript full-text, append-only, signed, and verifier-compatible. Challenges and verdicts remain ordinary signed MOLT events.
- Loopback only. No public exposure, deploys, pushes, publishes, paid services, external credentials, or changes to the gateway live on the owner's VM.
- No production Room keys in this chat. Tests may create disposable identities only inside isolated temporary test homes; no real room is spawned.
- Never change the frozen contract or verifier hashing path. Do not introduce non-integer or unsafe numbers into signed data.
- Do not silently summarize or rewrite any member turn. Preserve existing budget and thread admission checks.

## Build and attacks
Implement a scoped gateway-backed harness member and a loopback-only A2A client, plus an integration harness that starts the pinned gateway's real server factory on `127.0.0.1` and an ephemeral port. Start with `native/echo`. Test authorization/scope, assignment eligibility, malformed and failed A2A responses, non-loopback URLs, offline behavior, budget preflight, signed transcript admission, verifier replay, and challenge/verdict flow. Do not modify gateway source.

## Deliverables
A durable bundle in this directory containing the complete changed Room tree (from the pinned commit), current owner-provided references, verbatim baseline and final test output, an attack-by-attack report, an independent fresh verifier rerun, and a short README. No deployment or push. Note explicitly if a requested property conflicts with the frozen contract or existing behavior.
