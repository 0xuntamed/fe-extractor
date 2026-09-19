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

export function countValues(values) {
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

export function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

export function extractColors(text) {
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

export function parseHexColor(value) {
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

export function categorizeColorValue(value) {
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

export function categorizeColors(colors) {
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

export function extractFonts(text) {
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

export function extractMeasurements(text) {
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

export function extractLibraries(text, packageJsonFiles = []) {
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

export function extractComponents(text) {
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

export function buildSnapshot({ mode, source, files, text, warnings = [] }) {
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
