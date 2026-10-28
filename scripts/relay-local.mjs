// Local test of relay/worker.js: node scripts/relay-local.mjs relay/worker.js  then  node scripts/probe-relay.js http://localhost:4777
// Runs relay/worker.js inside Node on a local port so the relay logic can be tested without a Cloudflare account.
import http from "node:http";
import { pathToFileURL } from "node:url";
const worker = (await import(pathToFileURL(process.argv[2]).href)).default;
const env = { RELAY_SECRET: process.env.RELAY_SECRET || "" };
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const out = await worker.fetch(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
});
server.listen(4777, () => console.log("harness on 4777"));
setTimeout(() => process.exit(0), 90000);
