import path from "node:path";
import { pathToFileURL } from "node:url";

const gatewayRoot = process.env.ROOM_GATEWAY_PATH;
const fixtureRoot = process.env.ROOM_GATEWAY_FIXTURE_ROOT;
if (!gatewayRoot || !fixtureRoot) throw new Error("ROOM_GATEWAY_PATH and ROOM_GATEWAY_FIXTURE_ROOT are required");
const { createServer } = await import(pathToFileURL(path.join(gatewayRoot, "src/server.ts")).href);
const server = createServer(fixtureRoot);
const close = () => server.close(() => process.exit(0));
process.on("SIGTERM", close);
process.on("SIGINT", close);
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Gateway did not bind a TCP loopback socket");
  process.stdout.write(`ROOM_GATEWAY_READY ${JSON.stringify({ address: address.address, family: address.family, port: address.port })}\n`);
});
