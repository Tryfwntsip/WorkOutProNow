import { createReadStream, existsSync } from "node:fs";
import { createServer, request as proxyRequest } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const clientDir = fileURLToPath(new URL("../../../packages/client/dist/", import.meta.url));
const port = Number(process.env.CLIENT_PORT ?? 3000);
const types: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function safeFile(root: string, path: string): string | undefined {
  const candidate = normalize(join(root, path));
  return candidate.startsWith(root) && existsSync(candidate) ? candidate : undefined;
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const path = url.pathname.slice("/api".length) + url.search;
    const port = path.startsWith("/auth") ? 4001 : path.startsWith("/profile") ? 4002 : 4003;
    const upstream = proxyRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: request.method,
        headers: request.headers
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      }
    );
    upstream.on("error", () => {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { code: "service_unavailable", message: "Local API service is unavailable" }
        })
      );
    });
    request.pipe(upstream);
    return;
  }
  const isClientModule = url.pathname.startsWith("/client/");
  const relative = isClientModule ? url.pathname.slice("/client/".length) : url.pathname.slice(1);
  const root = isClientModule ? clientDir : publicDir;
  const file =
    safeFile(root, relative || "index.html") ??
    (!isClientModule && !extname(relative) ? safeFile(publicDir, "index.html") : undefined);
  if (!file) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache"
  });
  createReadStream(file).pipe(response);
}).listen(port, "0.0.0.0", () => {
  console.log(`WorkOutProNow client listening on http://localhost:${port}`);
});
