import http from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = join(__dirname, "public");
const MAX_REPO_FILES = 90;
const MAX_FILE_CHARS = 180_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

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

const LIBRARY_HINTS = [
  "tailwindcss",
  "@tailwindcss/forms",
  "lucide-react",
  "lucide",
  "@heroicons/react",
  "@fortawesome",
  "react-icons",
  "@mui/material",
  "@chakra-ui/react",
  "antd",
  "radix-ui",
  "@radix-ui/react-icons",
  "@radix-ui/react-dialog",
  "shadcn",
  "next/font",
  "framer-motion",
  "motion"
];

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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "interface-auditor-v1",
      "accept": "text/html,application/json,text/css,text/plain,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseGitHubUrl(inputUrl) {
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

function countValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    const key = value.trim().replace(/\s+/g, " ");
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractColors(text) {
  const colors = [];
  colors.push(...(text.match(/#[0-9a-fA-F]{3,8}\b/g) || []));
  colors.push(...(text.match(/\brgba?\([^)]+\)/g) || []));
  colors.push(...(text.match(/\bhsla?\([^)]+\)/g) || []));

  const tailwindColors = text.match(
    /\b(?:bg|text|border|ring|from|via|to|stroke|fill|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[1-9]00\b/g
  ) || [];
  colors.push(...tailwindColors);

  const named = text.match(/\b(?:black|white|transparent|currentColor)\b/g) || [];
  colors.push(...named);

  return countValues(colors).slice(0, 24);
}

function parseHexColor(value) {
  const hex = value.trim().replace("#", "");
  if (![3, 6].includes(hex.length)) return null;

  const normalized = hex.length === 3
    ? hex.split("").map((char) => char + char).join("")
    : hex;

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  if ([red, green, blue].some(Number.isNaN)) return null;
  return { red, green, blue };
}

function categorizeColorValue(value) {
  const lower = value.toLowerCase();
  if (/(slate|gray|zinc|neutral|stone|black|white|transparent|currentcolor)/.test(lower)) {
    return "neutral";
  }
  if (/(red|rose|orange|amber|yellow|green|emerald|lime|danger|success|warning|error)/.test(lower)) {
    return "state";
  }

  if (lower.startsWith("#")) {
    const rgb = parseHexColor(lower);
    if (rgb) {
      const spread = Math.max(rgb.red, rgb.green, rgb.blue) - Math.min(rgb.red, rgb.green, rgb.blue);
      const brightness = (rgb.red + rgb.green + rgb.blue) / 3;
      if (spread < 18 || brightness < 28 || brightness > 232) return "neutral";
      if (rgb.red > 150 && rgb.green < 130 && rgb.blue < 130) return "state";
      if (rgb.green > 135 && rgb.red < 150 && rgb.blue < 150) return "state";
    }
  }

  return "brand";
}

function categorizeColors(colors) {
  const groups = {
    brand: [],
    neutral: [],
    state: [],
    raw: colors
  };

  for (const color of colors) {
    const category = categorizeColorValue(color.value);
    groups[category].push({
      ...color,
      label:
        category === "brand"
          ? "Brand color candidate"
          : category === "neutral"
            ? "Neutral color candidate"
            : "State color candidate"
    });
  }

  return {
    brand: groups.brand.slice(0, 8),
    neutral: groups.neutral.slice(0, 8),
    state: groups.state.slice(0, 8),
    raw: groups.raw.slice(0, 24)
  };
}

function extractFonts(text) {
  const fonts = [];
  const familyMatches = text.matchAll(/font-family\s*:\s*([^;}]+)/gi);
  for (const match of familyMatches) {
    fonts.push(
      ...match[1]
        .split(",")
        .map((font) => font.replace(/['"]/g, "").trim())
        .filter((font) => font && !/^(sans-serif|serif|monospace|system-ui)$/i.test(font))
    );
  }

  const googleMatches = text.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^'")&]+)/gi);
  for (const match of googleMatches) {
    fonts.push(decodeURIComponent(match[1]).replace(/\+/g, " "));
  }

  const nextFontMatches = text.matchAll(/from\s+["']next\/font\/(google|local)["']/gi);
  for (const match of nextFontMatches) {
    fonts.push(`next/font/${match[1]}`);
  }

  const tailwindFontMatches = text.match(/\bfont-(?:sans|serif|mono|display|body|heading)\b/g) || [];
  fonts.push(...tailwindFontMatches);

  return countValues(fonts).slice(0, 12);
}

function extractMeasurements(text) {
  const radii = countValues([
    ...(text.match(/border-radius\s*:\s*[^;}]+/gi) || []).map((x) => x.split(":")[1]),
    ...(text.match(/\brounded(?:-[a-z0-9[\]./]+)?\b/g) || [])
  ]).slice(0, 10);

  const shadows = countValues([
    ...(text.match(/box-shadow\s*:\s*[^;}]+/gi) || []).map((x) => x.split(":")[1]),
    ...(text.match(/\bshadow(?:-[a-z0-9[\]./]+)?\b/g) || [])
  ]).slice(0, 10);

  const spacing = countValues([
    ...(text.match(/\b(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-x|space-y)-[a-z0-9[\]./]+\b/g) || []),
    ...(text.match(/(?:padding|margin|gap)\s*:\s*[^;}]+/gi) || []).map((x) => x.split(":")[1])
  ]).slice(0, 16);

  return { radii, shadows, spacing };
}

function extractLibraries(text, packageJsonFiles = []) {
  const found = [];
  for (const hint of LIBRARY_HINTS) {
    if (text.toLowerCase().includes(hint.toLowerCase())) {
      found.push(hint);
    }
  }

  for (const file of packageJsonFiles) {
    try {
      const pkg = JSON.parse(file.content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const dep of Object.keys(deps)) {
        if (LIBRARY_HINTS.some((hint) => dep.includes(hint) || hint.includes(dep))) {
          found.push(dep);
        }
      }
    } catch {
      // package-like JSON can be malformed in fixtures; ignore and keep scanning text.
    }
  }

  return countValues(found).slice(0, 16);
}

function compactClass(value = "") {
  return value
    .replace(/\{[^}]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function classifyButton(signature) {
  const lower = signature.toLowerCase();
  if (/(danger|destructive|error|red-|rose-)/.test(lower)) return "Danger button candidate";
  if (/(ghost|link|transparent)/.test(lower)) return "Ghost button candidate";
  if (/(secondary|outline|border)/.test(lower)) return "Secondary button candidate";
  return "Primary button candidate";
}

function extractComponents(text) {
  const buttons = [];
  const inputs = [];
  const cards = [];

  const buttonTagMatches = text.matchAll(/<(button|a)\b[^>]*(?:class(?:Name)?=["'`]([^"'`]+)["'`])?[^>]*>/gi);
  for (const match of buttonTagMatches) {
    const raw = match[0];
    const className = compactClass(match[2] || raw);
    if (match[1].toLowerCase() === "button" || /\b(btn|button|rounded|px-|py-|inline-flex)\b/i.test(className)) {
      buttons.push({ name: classifyButton(className), signature: className || raw.slice(0, 120) });
    }
  }

  const inputMatches = text.matchAll(/<(input|textarea|select)\b[^>]*(?:class(?:Name)?=["'`]([^"'`]+)["'`])?[^>]*>/gi);
  for (const match of inputMatches) {
    const type = match[1].toLowerCase();
    const className = compactClass(match[2] || match[0]);
    inputs.push({ name: type === "textarea" ? "Textarea candidate" : type === "select" ? "Select input candidate" : "Input field candidate", signature: className });
  }

  const classMatches = text.matchAll(/class(?:Name)?=["'`]([^"'`]+)["'`]/gi);
  for (const match of classMatches) {
    const className = compactClass(match[1]);
    const lower = className.toLowerCase();
    const looksLikeCard =
      lower.includes("card") ||
      ((/\brounded(?:-|$)/.test(lower) || /\bborder\b/.test(lower)) &&
        (/\bshadow(?:-|$)/.test(lower) || /\bp-[0-9]/.test(lower) || /\bbg-/.test(lower)));
    if (looksLikeCard) {
      cards.push({ name: "Card/surface candidate", signature: className });
    }
  }

  return {
    buttons: groupComponents(buttons, 8),
    inputs: groupComponents(inputs, 8),
    cards: groupComponents(cards, 8)
  };
}

function groupComponents(items, limit) {
  const grouped = new Map();
  for (const item of items) {
    const key = item.signature || item.name;
    const current = grouped.get(key) || { ...item, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function calculateHealth({ colors, fonts, measurements, libraries, components, warnings }) {
  const tokenSignals =
    Math.min(colors.length, 12) +
    Math.min(fonts.length * 2, 8) +
    Math.min(measurements.spacing.length, 8) +
    Math.min(measurements.radii.length + measurements.shadows.length, 8);
  const tokenCoverage = Math.min(100, Math.round((tokenSignals / 36) * 100));

  const componentSignals =
    Math.min(components.buttons.length * 18, 36) +
    Math.min(components.inputs.length * 14, 28) +
    Math.min(components.cards.length * 18, 36);
  const componentCoverage = Math.min(100, componentSignals);

  const librarySignals = Math.min(100, libraries.length * 22);
  const warningPenalty = Math.min(28, warnings.length * 7);
  const overallScore = Math.max(
    12,
    Math.min(
      98,
      Math.round(tokenCoverage * 0.42 + componentCoverage * 0.38 + librarySignals * 0.2 - warningPenalty)
    )
  );

  return {
    overallScore,
    tokenCoverage,
    componentCoverage,
    librarySignals,
    warningCount: warnings.length
  };
}

function buildSnapshot({ mode, source, files, text, warnings = [] }) {
  const packageJsonFiles = files.filter((file) => file.path.endsWith("package.json"));
  const colors = extractColors(text);
  const fonts = extractFonts(text);
  const measurements = extractMeasurements(text);
  const libraries = extractLibraries(text, packageJsonFiles);
  const components = extractComponents(text);

  if (colors.length < 3) warnings.push("Only a few color values were detected.");
  if (fonts.length === 0) warnings.push("No explicit font family was detected.");
  if (!components.buttons.length) warnings.push("No clear button pattern was detected.");
  if (!components.cards.length) warnings.push("No clear card pattern was detected.");
  const uniqueWarnings = uniq(warnings);
  const health = calculateHealth({ colors, fonts, measurements, libraries, components, warnings: uniqueWarnings });

  const signalCount =
    colors.length +
    fonts.length +
    libraries.length +
    components.buttons.length +
    components.inputs.length +
    components.cards.length;

  return {
    source,
    mode,
    analyzedAt: new Date().toISOString(),
    confidence: signalCount > 28 ? "high" : signalCount > 12 ? "medium" : "low",
    summary: {
      filesScanned: files.length,
      colors: colors.length,
      fonts: fonts.length,
      libraries: libraries.length,
      components:
        components.buttons.length + components.inputs.length + components.cards.length
    },
    health,
    colors,
    colorGroups: categorizeColors(colors),
    fonts,
    spacing: measurements.spacing,
    radii: measurements.radii,
    shadows: measurements.shadows,
    libraries,
    components,
    warnings: uniqueWarnings
  };
}

async function analyzeRepo(inputUrl) {
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

  const files = [];
  const warnings = [];
  for (const candidate of candidates) {
    const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${candidate.path}`;
    try {
      const content = (await fetchText(rawUrl)).slice(0, MAX_FILE_CHARS);
      files.push({ path: candidate.path, content });
    } catch {
      warnings.push(`Skipped ${candidate.path} because it could not be fetched.`);
    }
  }

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

function scoreRepoPath(path) {
  let score = 0;
  if (/tailwind\.config\./i.test(path)) score += 80;
  if (/package\.json$/i.test(path)) score += 70;
  if (/(global|style|theme|token|design|app|index)\.(css|scss|ts|js|tsx|jsx)$/i.test(path)) score += 50;
  if (/\b(src|app|pages|components|styles)\b/i.test(path)) score += 25;
  if (/\b(button|input|card|ui)\b/i.test(path)) score += 25;
  if (/\.(tsx|jsx|css|scss)$/i.test(path)) score += 15;
  return score;
}

async function analyzeLive(inputUrl) {
  const url = new URL(inputUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Live mode requires an http or https URL.");
  }

  const html = await fetchText(url.href);
  const cssBlocks = [];
  const warnings = [];

  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    cssBlocks.push(match[1]);
  }

  const cssLinks = [...html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => new URL(match[1], url.href).href)
    .slice(0, 12);

  for (const cssUrl of cssLinks) {
    try {
      cssBlocks.push(await fetchText(cssUrl));
    } catch {
      warnings.push(`Skipped stylesheet ${cssUrl} because it could not be fetched.`);
    }
  }

  return buildSnapshot({
    mode: "live",
    source: {
      inputUrl,
      displayName: url.hostname
    },
    files: [{ path: url.href, content: html }, ...cssBlocks.map((content, index) => ({ path: `stylesheet-${index + 1}.css`, content }))],
    text: [html, ...cssBlocks].join("\n"),
    warnings
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
