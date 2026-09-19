import { extname } from "node:path";
import { fetchText, pooledMap } from "./net.js";
import { buildSnapshot } from "./extractors.js";

const MAX_REPO_FILES = 90;
const MAX_FILE_CHARS = 180_000;
const FETCH_CONCURRENCY = 6;

const FRONTEND_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json"
]);

export function parseGitHubUrl(inputUrl) {
  const url = new URL(inputUrl);
  if (!["github.com", "www.github.com"].includes(url.hostname)) {
    return null;
  }

  const [owner, repoRaw, maybeTree, branch] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repoRaw) {
    return null;
  }

  return {
    owner,
    repo: repoRaw.replace(/\.git$/, ""),
    branch: maybeTree === "tree" && branch ? branch : null
  };
}

export function scoreRepoPath(path) {
  let score = 0;
  if (/tailwind\.config\./i.test(path)) score += 80;
  if (/package\.json$/i.test(path)) score += 70;
  if (/(global|style|theme|token|design|app|index)\.(css|scss|ts|js|tsx|jsx)$/i.test(path)) score += 50;
  if (/\b(src|app|pages|components|styles)\b/i.test(path)) score += 25;
  if (/\b(button|input|card|ui)\b/i.test(path)) score += 25;
  if (/\.(tsx|jsx|css|scss)$/i.test(path)) score += 15;
  return score;
}

export async function analyzeRepo(inputUrl) {
  const parsed = parseGitHubUrl(inputUrl);
  if (!parsed) {
    throw new Error("Please enter a valid public GitHub repository URL.");
  }

  const repoMeta = JSON.parse(await fetchText(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`));
  const branch = parsed.branch || repoMeta.default_branch;
  const treeUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const tree = JSON.parse(await fetchText(treeUrl));

  const candidates = tree.tree
    .filter((item) => item.type === "blob")
    .filter((item) => FRONTEND_EXTENSIONS.has(extname(item.path).toLowerCase()))
    .filter((item) => !/(\bnode_modules\b|\bdist\b|\bbuild\b|\.next\b|coverage\b|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)/i.test(item.path))
    .sort((a, b) => scoreRepoPath(b.path) - scoreRepoPath(a.path))
    .slice(0, MAX_REPO_FILES);

  const warnings = [];
  const fetched = await pooledMap(candidates, FETCH_CONCURRENCY, async (candidate) => {
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${candidate.path}`;
    try {
      const content = (await fetchText(rawUrl)).slice(0, MAX_FILE_CHARS);
      return { path: candidate.path, content };
    } catch {
      warnings.push(`Skipped ${candidate.path} because it could not be fetched.`);
      return null;
    }
  });
  const files = fetched.filter(Boolean);

  if (!files.length) {
    throw new Error("No frontend files could be read from this repository.");
  }

  return buildSnapshot({
    mode: "repo",
    source: {
      inputUrl,
      displayName: `${parsed.owner}/${parsed.repo}`,
      branch
    },
    files,
    text: files.map((file) => `\n/* ${file.path} */\n${file.content}`).join("\n"),
    warnings
  });
}
