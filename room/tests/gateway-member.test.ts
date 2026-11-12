import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import {
  addGatewayMember,
  assignTask,
  challengeTurn,
  createRoom,
  getMemberStates,
  postTurn,
  readRoom,
  resolveChallenge,
  setBudgetState,
  runGatewayAssignedTask,
  verifyRoom,
} from "../src/index.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gatewaySource = process.env.ROOM_GATEWAY_PATH;
const roots: string[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];
const target = "native/echo";

async function newHome(prefix = "room-gateway-test-"): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), prefix));
  roots.push(home);
  return home;
}

async function readJson(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function startStubGateway(result: unknown): Promise<{ host: string; getCalls: () => number; close: () => Promise<void> }> {
  let calls = 0;
  const server = createServer(async (request, response) => {
    calls += 1;
    const body = await readJson(request);
    const rpcResult = {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        kind: "task",
        id: "stub-task",
        contextId: "stub-context",
        status: { state: "completed", timestamp: "2026-11-10T00:00:00.000Z" },
        artifacts: [{
          artifactId: "stub-artifact",
          name: "execute-response",
          parts: [{ kind: "data", data: { ok: true, target, result, durationMs: 0, attempts: 1 } }],
        }],
      },
    };
    sendJson(response, rpcResult);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  return {
    host: `http://127.0.0.1:${address.port}`,
    getCalls: () => calls,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function waitForGateway(child: ChildProcess): Promise<{ address: string; family: string; port: number }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error(`Gateway did not start within 15 seconds. stderr=${stderr}`));
    }, 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const match = /^ROOM_GATEWAY_READY (.+)$/m.exec(stdout);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(match[1]!) as { address: string; family: string; port: number });
      } catch (error) {
        reject(error);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Gateway exited before readiness (code ${code}). stderr=${stderr}; stdout=${stdout}`));
    });
  });
}

async function startPinnedGateway(): Promise<{ host: string; fixtureRoot: string; child: ChildProcess }> {
  if (!gatewaySource) throw new Error("ROOM_GATEWAY_PATH is required for the real gateway test");
  const fixtureRoot = await mkdtemp(join(tmpdir(), "room-gateway-registry-"));
  roots.push(fixtureRoot);
  await mkdir(join(fixtureRoot, "registry", "native"), { recursive: true });
  await cp(join(gatewaySource, "registry", "native", "echo"), join(fixtureRoot, "registry", "native", "echo"), { recursive: true });
  await writeFile(join(fixtureRoot, "package.json"), JSON.stringify({ type: "module" }));
  const runnerPath = join(projectRoot, "tests", "fixtures", "gateway-loopback-server.mjs");
  const child = spawn(process.execPath, ["--import", "tsx/esm", runnerPath], {
    cwd: gatewaySource,
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: fixtureRoot,
      TMPDIR: fixtureRoot,
      ROOM_GATEWAY_PATH: gatewaySource,
      ROOM_GATEWAY_FIXTURE_ROOT: fixtureRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const ready = await waitForGateway(child);
  assert.equal(ready.address, "127.0.0.1");
  assert.equal(ready.family, "IPv4");
  assert.ok(Number.isSafeInteger(ready.port) && ready.port > 0 && ready.port <= 65_535);
  return { host: `http://127.0.0.1:${ready.port}`, fixtureRoot, child };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit").then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function rootVerify(roomDir: string): Promise<Record<string, unknown>> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [join(projectRoot, "verify.ts"), roomDir], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

after(async () => {
  await Promise.all(children.map(stopChild));
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  })));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("gateway member validates its signed tool scope and assignment before dispatch", async () => {
  const home = await newHome();
  const room = await createRoom({ roomId: "gateway-scope", roomName: "Gateway scope test", home });
  const before = await readRoom(room.roomId, home);
  await assert.rejects(addGatewayMember({ roomId: room.roomId, name: "Bad scope", budgetTokens: 500, tools: ["native/../echo"], home }), /valid gateway targets/);
  await assert.rejects(addGatewayMember({ roomId: room.roomId, name: "Bad thread", budgetTokens: 500, tools: [target], subscriptions: ["undeclared"], home }), /distinct genesis threads/);
  assert.equal((await readRoom(room.roomId, home)).events.length, before.events.length);

  const membership = await addGatewayMember({ roomId: room.roomId, name: "Echo Member", budgetTokens: 500, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  const fixture = room.genesis.members.find((candidate) => candidate.role === "harness-agent")!;
  const wrongRecipient = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: fixture.fingerprint, prompt: "Not addressed to the gateway member.", home });
  await assert.rejects(runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: wrongRecipient.id, target, gatewayHost: "http://example.com", home }), /not an assignment for this gateway member/);
  const nonhumanAssignment = await assignTask({ roomId: room.roomId, author: fixture.fingerprint, recipient: member.fingerprint, prompt: "A harness member cannot authorize a gateway call.", home });
  await assert.rejects(runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: nonhumanAssignment.id, target, gatewayHost: "http://example.com", home }), /present human member/);
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt: "Only the assigned member may run this.", home });
  await assert.rejects(runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, target: "native/transform", gatewayHost: "http://example.com", home }), /signed tool allowlist/);
  await assert.rejects(runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: "not-an-event", target, gatewayHost: "http://example.com", home }), /existing threaded turn/);
  const after = await readRoom(room.roomId, home);
  assert.equal(after.events.length, before.events.length + 4);
  assert.equal((await verifyRoom(room.roomId, home)).ok, true);
});

test("gateway response over budget is never truncated or admitted and produces a signed exhaustion pause", async () => {
  const home = await newHome();
  const room = await createRoom({ roomId: "gateway-output-budget", roomName: "Gateway output budget test", home });
  const membership = await addGatewayMember({ roomId: room.roomId, name: "Small Budget", budgetTokens: 4, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt: "x", home });
  const stub = await startStubGateway({ echo: { note: "full response content must not be truncated" } });
  const before = await readRoom(room.roomId, home);
  await assert.rejects(
    runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, target, gatewayHost: stub.host, home }),
    /exceeded the signed member budget/,
  );
  assert.equal(stub.getCalls(), 1);
  const afterData = await readRoom(room.roomId, home);
  const last = afterData.events.at(-1);
  assert.ok(last);
  assert.equal(last.body.kind, "budget");
  if (last.body.kind === "budget") {
    assert.equal(last.body.member, member.fingerprint);
    assert.equal(last.body.state, "paused");
    assert.equal(last.body.reason, "exhausted");
  }
  assert.equal(afterData.events.length, before.events.length + 1);
  assert.ok(!afterData.events.some((event) => event.author === member.fingerprint && event.body.kind === "turn" && event.body.text.includes("full response content")));
  const quarantine = await readFile(room.paths.quarantine, "utf8");
  assert.doesNotMatch(quarantine, /full response content must not be truncated/);
  const state = (await getMemberStates(room.roomId, home)).find((entry) => entry.member.fingerprint === member.fingerprint);
  assert.ok(state);
  assert.equal(state.consumedTokens, 0);
  assert.equal(state.threadUsage.main, 0);
  assert.equal(state.paused, true);
  assert.equal((await verifyRoom(room.roomId, home)).ok, true);
});

test("gateway runner verifies the full signed chain before dispatch and makes no request for a tampered room", async () => {
  const home = await newHome();
  const room = await createRoom({ roomId: "gateway-tampered-chain", roomName: "Gateway tampered chain", home });
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  const membership = await addGatewayMember({ roomId: room.roomId, name: "Verifier Guard", budgetTokens: 500, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt: "Verify this assignment before dispatch.", home });
  const accepted = await readFile(room.paths.transcript, "utf8");
  const corrupted = accepted.replace("Verify this assignment before dispatch.", "Verify this assignment after dispatch.");
  assert.notEqual(corrupted, accepted);
  await writeFile(room.paths.transcript, corrupted);
  const stub = await startStubGateway({ echo: "must never be requested" });
  await assert.rejects(
    runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, target, gatewayHost: stub.host, home }),
    /room verification failed/,
  );
  assert.equal(stub.getCalls(), 0);
  assert.equal(await readFile(room.paths.transcript, "utf8"), corrupted);
});

test("gateway member budget exhaustion pauses before making a gateway request and reports per-thread usage", async () => {
  const home = await newHome();
  const room = await createRoom({ roomId: "gateway-budget-pause", roomName: "Gateway budget pause test", home });
  const membership = await addGatewayMember({ roomId: room.roomId, name: "Exhausted Member", budgetTokens: 12, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  await postTurn({ roomId: room.roomId, author: member.fingerprint, text: "Budget accounting fixture.", threadId: "main", inputTokens: 5, outputTokens: 7, home });
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt: "Do not dispatch after exhaustion.", home });
  await assert.rejects(
    runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, target, gatewayHost: "http://192.0.2.1:3000", home }),
    /signed budget is exhausted/,
  );
  const data = await readRoom(room.roomId, home);
  const pause = data.events.at(-1);
  assert.ok(pause?.body.kind === "budget");
  if (pause?.body.kind === "budget") {
    assert.equal(pause.body.state, "paused");
    assert.equal(pause.body.reason, "exhausted");
    assert.equal(pause.body.consumedTokens, 12);
    assert.equal(pause.body.thread, undefined);
  }
  const state = (await getMemberStates(room.roomId, home)).find((entry) => entry.member.fingerprint === member.fingerprint);
  assert.ok(state);
  assert.equal(state.consumedTokens, 12);
  assert.equal(state.threadUsage.main, 12);
  assert.equal(state.paused, true);
  assert.equal((await verifyRoom(room.roomId, home)).ok, true);
});

test("a thread-scoped signed budget pause blocks only gateway dispatch on that thread", async () => {
  const home = await newHome();
  const room = await createRoom({ roomId: "gateway-thread-pause", roomName: "Gateway thread pause", home });
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  const membership = await addGatewayMember({ roomId: room.roomId, name: "Thread Paused", budgetTokens: 500, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const pause = await setBudgetState({ roomId: room.roomId, member: member.fingerprint, state: "paused", reason: "human", threadId: "main", home });
  assert.equal(pause.body.kind, "budget");
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt: "This thread is paused.", home });
  const stub = await startStubGateway({ echo: "must not be called" });
  const before = await readRoom(room.roomId, home);
  await assert.rejects(
    runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, target, gatewayHost: stub.host, home }),
    /assignment-thread budget is paused/,
  );
  assert.equal(stub.getCalls(), 0);
  assert.deepEqual((await readRoom(room.roomId, home)).events.map((event) => event.hash), before.events.map((event) => event.hash));
  assert.equal((await verifyRoom(room.roomId, home)).ok, true);
});

test("Gateway output loses a concurrent budget race at the signed ledger lock and is not admitted", async () => {
  const home = await newHome();
  const room = await createRoom({ roomId: "gateway-budget-race", roomName: "Gateway concurrent budget race", home });
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  const membership = await addGatewayMember({ roomId: room.roomId, name: "Racing Member", budgetTokens: 1000, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt: "Read the status.", home });

  let markReceived!: () => void;
  let releaseResponse!: () => void;
  const requestReceived = new Promise<void>((resolve) => { markReceived = resolve; });
  const responseReleased = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let gatewayCalls = 0;
  const server = createServer(async (request, response) => {
    const rpc = await readJson(request);
    gatewayCalls += 1;
    if (gatewayCalls === 1) {
      markReceived();
      await responseReleased;
    }
    sendJson(response, {
      jsonrpc: "2.0",
      id: rpc.id,
      result: {
        kind: "task",
        id: "race-task",
        contextId: assignment.id,
        status: { state: "completed", timestamp: "2026-11-10T00:00:00.000Z" },
        artifacts: [{
          artifactId: "race-artifact",
          name: "execute-response",
          parts: [{ kind: "data", data: { ok: true, target, result: { echo: "complete response" }, durationMs: 0, attempts: 1 } }],
        }],
      },
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  const gatewayHost = `http://127.0.0.1:${address.port}`;
  const run = runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, gatewayHost, home });
  await requestReceived;
  let duplicateAssertionError: unknown;
  try {
    try {
      await assert.rejects(
        runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, gatewayHost, home }),
        /already active or unfinished/,
      );
    } catch (error) {
      duplicateAssertionError = error;
    }
    const memberState = (await getMemberStates(room.roomId, home)).find((entry) => entry.member.fingerprint === member.fingerprint);
    assert.ok(memberState);
    const remainingTokens = member.budgetTokens - memberState.consumedTokens;
    assert.ok(remainingTokens > 0);
    await postTurn({ roomId: room.roomId, author: member.fingerprint, text: "Concurrent usage consumed the remaining budget.", threadId: "main", inputTokens: remainingTokens, outputTokens: 0, home });
  } finally {
    releaseResponse();
  }
  await assert.rejects(run, /exceeded the signed member budget/);
  assert.equal(gatewayCalls, 1);
  if (duplicateAssertionError) throw duplicateAssertionError;

  const after = await readRoom(room.roomId, home);
  const pause = after.events.at(-1);
  assert.ok(pause?.body.kind === "budget");
  if (pause?.body.kind === "budget") {
    assert.equal(pause.body.state, "paused");
    assert.equal(pause.body.reason, "exhausted");
    assert.equal(pause.body.consumedTokens, 1000);
  }
  assert.equal(after.events.filter((event) => event.author === member.fingerprint && event.body.kind === "turn").length, 1);
  assert.equal((await getMemberStates(room.roomId, home)).find((entry) => entry.member.fingerprint === member.fingerprint)?.threadUsage.main, 1000);
  assert.equal((await verifyRoom(room.roomId, home)).ok, true);
});

test("unavailable loopback gateway reports NOT AVAILABLE and appends no Room event", async () => {
  const home = await newHome();
  const room = await createRoom({ roomId: "gateway-offline", roomName: "Gateway offline path", home });
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  const membership = await addGatewayMember({ roomId: room.roomId, name: "Offline Member", budgetTokens: 500, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt: "Do not write when the gateway is offline.", home });
  const before = await readRoom(room.roomId, home);
  const result = await runGatewayAssignedTask({
    roomId: room.roomId,
    member: member.fingerprint,
    assignmentEventId: assignment.id,
    gatewayHost: "http://127.0.0.1:1",
    home,
  });
  assert.equal(result.status, "not-available");
  if (result.status !== "not-available") return;
  assert.match(result.reason, /configured loopback host/);
  const after = await readRoom(room.roomId, home);
  assert.deepEqual(after.events.map((event) => event.hash), before.events.map((event) => event.hash));
  assert.equal((await verifyRoom(room.roomId, home)).ok, true);
});

test("real pinned gateway native/echo runs on loopback, signs a full turn, and preserves the challenge/verdict chain", { skip: !gatewaySource ? "ROOM_GATEWAY_PATH not set" : false }, async () => {
  const home = await newHome();
  const gateway = await startPinnedGateway();
  const health = await fetch(`${gateway.host}/health`);
  assert.deepEqual(await health.json(), { ok: true });

  const room = await createRoom({ roomId: "gateway-echo", roomName: "Gateway A2A end-to-end", home });
  const human = room.genesis.members.find((candidate) => candidate.role === "human")!;
  const membership = await addGatewayMember({ roomId: room.roomId, name: "Loopback Echo", budgetTokens: 5000, tools: [target], home });
  assert.equal(membership.body.kind, "membership");
  const member = membership.body.kind === "membership" ? membership.body.member : undefined;
  assert.ok(member);
  const prompt = "Echo this exact assignment payload: alpha=17; beta=blue.";
  const assignment = await assignTask({ roomId: room.roomId, author: human.fingerprint, recipient: member.fingerprint, prompt, home });
  const result = await runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, gatewayHost: gateway.host, home });
  assert.equal(result.status, "admitted");
  if (result.status !== "admitted") return;
  assert.equal(result.target, target);
  assert.equal(result.event.author, member.fingerprint);
  assert.equal(result.event.threadId, assignment.threadId);
  assert.equal(result.event.body.kind, "turn");
  if (result.event.body.kind !== "turn") return;
  const marker = `[[room:gateway-result:v1|assignment=${assignment.id}]]\n`;
  assert.ok(result.event.body.text.startsWith(marker));
  const signedResult = JSON.parse(result.event.body.text.slice(marker.length)) as Record<string, unknown>;
  assert.equal(signedResult.target, target);
  assert.equal(signedResult.assignmentEventId, assignment.id);
  assert.equal(signedResult.threadId, "main");
  assert.deepEqual(signedResult.result, {
    echo: { assignmentEventId: assignment.id, threadId: "main", prompt },
  });
  assert.equal(assignment.body.kind, "turn");
  const assignmentPrefix = `Assignment for ${member.name} (${member.fingerprint}):\n\n`;
  assert.ok(assignment.body.text.startsWith(assignmentPrefix));
  assert.equal((signedResult.result as { echo: { prompt: string } }).echo.prompt, assignment.body.text.slice(assignmentPrefix.length));
  assert.ok(result.event.body.text.includes(prompt));

  await assert.rejects(
    runGatewayAssignedTask({ roomId: room.roomId, member: member.fingerprint, assignmentEventId: assignment.id, gatewayHost: gateway.host, home }),
    /already has a signed response/,
  );
  const executions = await readFile(join(gateway.fixtureRoot, "logs", "executions.jsonl"), "utf8");
  assert.equal(executions.trim().split("\n").length, 1);

  const challenge = await challengeTurn({
    roomId: room.roomId,
    author: human.fingerprint,
    targetEventId: result.event.id,
    claim: "The gateway-backed member changed the assigned text.",
    evidence: [{ type: "event", id: assignment.id }],
    home,
  });
  const verdict = await resolveChallenge({
    roomId: room.roomId,
    author: member.fingerprint,
    challengeId: challenge.id,
    outcome: "unproven",
    rationale: "The signed gateway result preserves the assignment text exactly.",
    evidence: [{ type: "event", id: result.event.id }],
    home,
  });
  assert.equal(challenge.body.kind, "challenge");
  assert.equal(verdict.body.kind, "verdict");
  assert.equal(verdict.author, member.fingerprint);
  const final = await readRoom(room.roomId, home);
  assert.deepEqual(final.events.slice(-3).map((event) => event.body.kind), ["turn", "challenge", "verdict"]);
  assert.equal((await verifyRoom(room.roomId, home)).ok, true);
  const rootReport = await rootVerify(room.paths.room);
  assert.equal(rootReport.ok, true);
  const state = (await getMemberStates(room.roomId, home)).find((entry) => entry.member.fingerprint === member.fingerprint);
  assert.ok(state);
  assert.ok(result.event.body.usage);
  assert.equal(state.threadUsage.main, (result.event.body.usage.inputTokens ?? 0) + (result.event.body.usage.outputTokens ?? 0));
  assert.deepEqual(await readFile(join(home, "rooms", room.roomId, "transcript.jsonl"), "utf8"), await readFile(room.paths.transcript, "utf8"));
});
