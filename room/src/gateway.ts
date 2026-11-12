import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

export const DEFAULT_GATEWAY_HOST = "http://127.0.0.1:3000";
export const GATEWAY_MEMBER_MODEL_ID = "gateway:a2a";
export const MAX_GATEWAY_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 15_000;

export class GatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayUnavailableError";
  }
}

export class GatewayProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayProtocolError";
  }
}

export interface GatewayExecution {
  target: string;
  taskId: string;
  result: unknown;
  durationMs: number;
  attempts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isGatewayTarget(target: string): boolean {
  return /^(?:native\/[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)?|external\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*)$/.test(target);
}

export function normalizeGatewayOrigin(host: string): string {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    throw new Error("Gateway host must be a valid local HTTP origin");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const ipv4Loopback = isIP(hostname) === 4 && Number(hostname.split(".")[0]) === 127;
  const ipv6Loopback = isIP(hostname) === 6 && hostname === "::1";
  if (url.protocol !== "http:" || (!ipv4Loopback && !ipv6Loopback)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Gateway host must be a loopback HTTP origin with no path or credentials");
  }
  return url.origin;
}

export function resolveGatewayHost(host?: string): string {
  return normalizeGatewayOrigin(host ?? process.env.ROOM_GATEWAY_HOST ?? DEFAULT_GATEWAY_HOST);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_GATEWAY_RESPONSE_BYTES)) {
    throw new GatewayProtocolError("Gateway A2A response exceeds the 1 MiB size limit");
  }
  if (!response.body) throw new GatewayProtocolError("Gateway A2A response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_GATEWAY_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GatewayProtocolError("Gateway A2A response exceeds the 1 MiB size limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  let text: string;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GatewayProtocolError("Gateway A2A response is not valid UTF-8");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GatewayProtocolError("Gateway A2A response is invalid JSON");
  }
}

export async function executeGateway(input: {
  host?: string;
  target: string;
  assignmentEventId: string;
  threadId: string;
  prompt: string;
}): Promise<GatewayExecution> {
  if (!isGatewayTarget(input.target)) throw new Error("Gateway target has an invalid format");
  const origin = resolveGatewayHost(input.host);
  const requestId = randomUUID();
  const request = {
    jsonrpc: "2.0",
    id: requestId,
    method: "message/send",
    params: {
      message: {
        kind: "message",
        messageId: randomUUID(),
        role: "user",
        contextId: input.assignmentEventId,
        parts: [{
          kind: "data",
          data: {
            target: input.target,
            event: {
              assignmentEventId: input.assignmentEventId,
              threadId: input.threadId,
              prompt: input.prompt,
            },
          },
        }],
      },
    },
  };
  let response: Response;
  try {
    response = await fetch(new URL("/a2a", origin), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GatewayUnavailableError("Gateway is not reachable at the configured loopback host");
  }
  if (!response.ok) throw new GatewayUnavailableError(`Gateway returned HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new GatewayProtocolError("Gateway A2A response is not JSON");
  }
  const envelope = await readBoundedJson(response);
  if (!isRecord(envelope) || envelope.jsonrpc !== "2.0" || envelope.id !== requestId) {
    throw new GatewayProtocolError("Gateway returned a mismatched JSON-RPC response");
  }
  if (isRecord(envelope.error)) throw new GatewayProtocolError("Gateway rejected the A2A request");
  const task = envelope.result;
  if (!isRecord(task) || task.kind !== "task" || typeof task.id !== "string" || !task.id
    || !isRecord(task.status) || typeof task.status.state !== "string") {
    throw new GatewayProtocolError("Gateway returned an invalid A2A task");
  }
  if (task.status.state !== "completed" || !Array.isArray(task.artifacts)) {
    throw new GatewayProtocolError("Gateway task did not complete successfully");
  }
  const artifacts = task.artifacts.filter((artifact) => isRecord(artifact) && artifact.name === "execute-response");
  if (artifacts.length !== 1 || !isRecord(artifacts[0]) || !Array.isArray(artifacts[0].parts)) {
    throw new GatewayProtocolError("Gateway task is missing its unique execute-response artifact");
  }
  const parts = artifacts[0].parts.filter((part) => isRecord(part) && part.kind === "data" && isRecord(part.data));
  if (parts.length !== 1 || !isRecord(parts[0]) || !isRecord(parts[0].data)) {
    throw new GatewayProtocolError("Gateway execute-response artifact has an invalid shape");
  }
  const result = parts[0].data;
  if (result.ok !== true || result.target !== input.target
    || !Number.isSafeInteger(result.durationMs) || (result.durationMs as number) < 0
    || !Number.isSafeInteger(result.attempts) || (result.attempts as number) < 1) {
    throw new GatewayProtocolError("Gateway component execution failed or returned invalid metadata");
  }
  return {
    target: input.target,
    taskId: task.id,
    result: result.result,
    durationMs: result.durationMs as number,
    attempts: result.attempts as number,
  };
}
