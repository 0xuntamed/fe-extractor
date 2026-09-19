import http from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseGitHubUrl, analyzeRepo } from "./src/github.js";
import { analyzeLive } from "./src/live.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleAnalyze(req, res) {
  try {
    const payload = JSON.parse(await readBody(req));
    const inputUrl = String(payload.url || "").trim();
    if (!inputUrl) {
      return json(res, 400, { error: "Enter a GitHub repository URL or live site URL." });
    }

    try {
      new URL(inputUrl);
    } catch {
      return json(res, 400, { error: "Enter a valid http(s) site URL or public GitHub repository URL." });
    }

    const requestedMode = payload.mode === "repo" || payload.mode === "live" ? payload.mode : null;
    const inferredMode = parseGitHubUrl(inputUrl) ? "repo" : "live";
    const mode = requestedMode || inferredMode;
    const snapshot = mode === "repo" ? await analyzeRepo(inputUrl) : await analyzeLive(inputUrl);
    return json(res, 200, snapshot);
  } catch (error) {
    return json(res, 400, { error: error.message || "Analysis failed." });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, normalized);

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/analyze") {
    return handleAnalyze(req, res);
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(req, res);
  }

  res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Interface Auditor running at http://localhost:${PORT}`);
});
