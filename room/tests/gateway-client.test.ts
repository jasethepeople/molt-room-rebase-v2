import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { after, test } from "node:test";
import {
  executeGateway,
  isGatewayTarget,
  MAX_GATEWAY_RESPONSE_BYTES,
  normalizeGatewayOrigin,
} from "../src/gateway.ts";

const servers: Server[] = [];
const target = "native/echo";

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Promise<{ server: Server; host: string }> {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
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
  return { server, host: `http://127.0.0.1:${address.port}` };
}

async function readRequest(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function completedResponse(id: unknown, data: Record<string, unknown> = {
  ok: true,
  target,
  result: { echo: { hello: "world" } },
  durationMs: 0,
  attempts: 1,
}): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      kind: "task",
      id: "gateway-task-1",
      contextId: "context-1",
      status: { state: "completed", timestamp: "2026-11-10T00:00:00.000Z" },
      artifacts: [{
        artifactId: "artifact-1",
        name: "execute-response",
        parts: [{ kind: "data", data }],
      }],
    },
  };
}

function requestFor(host: string, overrides: Partial<Parameters<typeof executeGateway>[0]> = {}) {
  return executeGateway({
    host,
    target,
    assignmentEventId: "018b3fb5-5ca4-7b28-8888-7dbdf03a43b4",
    threadId: "main",
    prompt: "keep the full assignment verbatim",
    ...overrides,
  });
}

after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  })));
});

test("gateway origin accepts only literal loopback HTTP origins", async (t) => {
  for (const host of ["http://127.0.0.1:3000", "http://127.12.34.56:3000", "http://[::1]:3000"]) {
    await t.test(`accepts ${host}`, () => {
      assert.equal(normalizeGatewayOrigin(host), host);
    });
  }
  for (const host of [
    "http://example.com:3000",
    "http://localhost:3000",
    "https://127.0.0.1:3000",
    "http://192.0.2.1:3000",
    "http://[2001:db8::1]:3000",
    "http://127.0.0.1:3000/path",
    "http://127.0.0.1:3000/?x=1",
    "http://user:password@127.0.0.1:3000",
    "http://10.1.2.3:3000",
    "http://169.254.169.254:3000",
    "http://1.1.1.1:3000",
    "http://[::ffff:127.0.0.1]:3000",
    "http://[fc00::1]:3000",
    "http://localhost.:3000",
    "http://127.0.0.1:99999",
    "not a URL",
  ]) {
    await t.test(`rejects ${host}`, () => {
      assert.throws(() => normalizeGatewayOrigin(host), /loopback HTTP origin|valid local HTTP origin/);
    });
  }
});

test("gateway target grammar excludes traversal and arbitrary components", async (t) => {
  for (const allowed of ["native/echo", "native/dispatcher-log", "external/openweather_api/get-current-weather-by-location"]) {
    await t.test(`accepts ${allowed}`, () => assert.equal(isGatewayTarget(allowed), true));
  }
  for (const denied of ["", "../echo", "native/../echo", "native/echo?x=1", "external/openweather_api", "external/../echo/run", "native/Echo", "native/echo/extra/segment", "native/%2e%2e/echo", "native\\..\\echo", "native/echo\n", "native/echo\u0000"]) {
    await t.test(`rejects ${denied || "empty target"}`, () => assert.equal(isGatewayTarget(denied), false));
  }
});

test("A2A request is scoped to one target and assignment, without auth or room history", async () => {
  let captured: Record<string, unknown> | undefined;
  let responseFailure: unknown;
  const local = await listen(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/a2a");
      captured = await readRequest(request);
      sendJson(response, completedResponse(captured.id));
    } catch (error) {
      responseFailure = error;
      response.writeHead(500);
      response.end();
    }
  });
  const execution = await requestFor(local.host);
  assert.equal(responseFailure, undefined);
  assert.equal(execution.target, target);
  assert.deepEqual(execution.result, { echo: { hello: "world" } });
  assert.equal(execution.durationMs, 0);
  assert.equal(execution.attempts, 1);
  assert.ok(captured);
  assert.equal(captured.jsonrpc, "2.0");
  assert.equal(captured.method, "message/send");
  const params = captured.params as { message: { contextId: string; parts: Array<{ kind: string; data: Record<string, unknown> }> } };
  assert.equal(params.message.contextId, "018b3fb5-5ca4-7b28-8888-7dbdf03a43b4");
  assert.equal(params.message.parts[0]?.kind, "data");
  const data = params.message.parts[0]?.data;
  assert.ok(data);
  assert.deepEqual(Object.keys(data).sort(), ["event", "target"]);
  assert.equal(data.target, target);
  assert.deepEqual(data.event, {
    assignmentEventId: "018b3fb5-5ca4-7b28-8888-7dbdf03a43b4",
    threadId: "main",
    prompt: "keep the full assignment verbatim",
  });
});

test("unsafe URL and target inputs are rejected before any network request", async () => {
  let requests = 0;
  const local = await listen((_request, response) => {
    requests += 1;
    sendJson(response, {});
  });
  await assert.rejects(requestFor(local.host, { host: "http://localhost:3000" }), /loopback HTTP origin/);
  await assert.rejects(requestFor(local.host, { target: "native/../echo" }), /invalid format/);
  assert.equal(requests, 0);
});

test("bad JSON-RPC, task, target, counters, and failed tasks are all rejected", async (t) => {
  const cases: Array<{ name: string; build: (id: unknown) => unknown; pattern: RegExp }> = [
    { name: "mismatched JSON-RPC id", build: () => completedResponse("other-id"), pattern: /mismatched JSON-RPC/ },
    { name: "JSON-RPC error", build: (id) => ({ jsonrpc: "2.0", id, error: { code: -32600, message: "bad request" } }), pattern: /rejected the A2A request/ },
    { name: "missing task", build: (id) => ({ jsonrpc: "2.0", id, result: null }), pattern: /invalid A2A task/ },
    { name: "failed task", build: (id) => ({ ...completedResponse(id), result: { ...(completedResponse(id) as { result: Record<string, unknown> }).result, status: { state: "failed" } } }), pattern: /did not complete successfully/ },
    { name: "missing artifact", build: (id) => ({ ...completedResponse(id), result: { ...(completedResponse(id) as { result: Record<string, unknown> }).result, artifacts: [] } }), pattern: /missing its unique/ },
    { name: "duplicate execute-response artifacts", build: (id) => {
      const response = completedResponse(id);
      const task = response.result as Record<string, unknown>;
      const artifacts = task.artifacts as unknown[];
      return { ...response, result: { ...task, artifacts: [...artifacts, ...artifacts] } };
    }, pattern: /missing its unique/ },
    { name: "wrong target", build: (id) => completedResponse(id, { ok: true, target: "native/transform", result: {}, durationMs: 0, attempts: 1 }), pattern: /failed or returned invalid metadata/ },
    { name: "fractional duration", build: (id) => completedResponse(id, { ok: true, target, result: {}, durationMs: 1.5, attempts: 1 }), pattern: /failed or returned invalid metadata/ },
    { name: "zero attempts", build: (id) => completedResponse(id, { ok: true, target, result: {}, durationMs: 0, attempts: 0 }), pattern: /failed or returned invalid metadata/ },
    { name: "component reports failure", build: (id) => completedResponse(id, { ok: false, target, result: null, error: { message: "failed" }, durationMs: 0, attempts: 1 }), pattern: /failed or returned invalid metadata/ },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const local = await listen(async (request, response) => {
        const body = await readRequest(request);
        sendJson(response, entry.build(body.id));
      });
      await assert.rejects(requestFor(local.host), entry.pattern);
    });
  }
});

test("invalid content type, malformed JSON, oversized body, and redirect fail closed", async (t) => {
  const cases: Array<{ name: string; respond: (response: ServerResponse, destination?: string) => void; pattern: RegExp }> = [
    {
      name: "HTTP 401 without credentials",
      respond: (response) => { response.writeHead(401); response.end(); },
      pattern: /Gateway returned HTTP 401/,
    },
    {
      name: "HTTP 404",
      respond: (response) => { response.writeHead(404); response.end(); },
      pattern: /Gateway returned HTTP 404/,
    },
    {
      name: "HTTP 500",
      respond: (response) => { response.writeHead(500); response.end(); },
      pattern: /Gateway returned HTTP 500/,
    },
    {
      name: "invalid content type",
      respond: (response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<html>error</html>"); },
      pattern: /not JSON/,
    },
    {
      name: "malformed JSON",
      respond: (response) => { response.writeHead(200, { "content-type": "application/json" }); response.end("{"); },
      pattern: /invalid JSON/,
    },
    {
      name: "declared response over 1 MiB",
      respond: (response) => {
        const body = Buffer.alloc(MAX_GATEWAY_RESPONSE_BYTES + 1, 0x20);
        response.writeHead(200, { "content-type": "application/json", "content-length": String(body.byteLength) });
        response.end(body);
      },
      pattern: /1 MiB size limit/,
    },
    {
      name: "chunked response over 1 MiB",
      respond: (response) => {
        const body = Buffer.alloc(MAX_GATEWAY_RESPONSE_BYTES + 1, 0x20);
        response.writeHead(200, { "content-type": "application/json" });
        response.write(body.subarray(0, MAX_GATEWAY_RESPONSE_BYTES));
        response.end(body.subarray(MAX_GATEWAY_RESPONSE_BYTES));
      },
      pattern: /1 MiB size limit/,
    },
    {
      name: "redirect is not followed",
      respond: (response, destination) => { response.writeHead(302, { location: destination }); response.end(); },
      pattern: /not reachable/,
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let destinationHits = 0;
      const destination = await listen((_request, response) => { destinationHits += 1; sendJson(response, {}); });
      const local = await listen((_request, response) => {
        if (entry.name === "redirect is not followed") {
          entry.respond(response, `${destination.host}/a2a`);
          return;
        }
        entry.respond(response);
      });
      await assert.rejects(requestFor(local.host), entry.pattern);
      assert.equal(destinationHits, 0);
    });
  }
});
