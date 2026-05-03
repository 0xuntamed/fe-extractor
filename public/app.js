const form = document.querySelector("#analyze-form");
const input = document.querySelector("#source-url");
const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const errorState = document.querySelector("#error-state");
const snapshotEl = document.querySelector("#snapshot");
const exportJsonButton = document.querySelector("#export-json");
const exportMdButton = document.querySelector("#export-md");
const demoButton = document.querySelector("#demo-button");
const emptyDemoButton = document.querySelector("#empty-demo-button");

let currentSnapshot = null;

const demoSnapshot = {
  source: {
    inputUrl: "demo://interface-auditor/saas-dashboard",
    displayName: "Demo SaaS Dashboard"
  },
  mode: "demo",
  analyzedAt: new Date().toISOString(),
  confidence: "high",
  health: {
    overallScore: 82,
    tokenCoverage: 88,
    componentCoverage: 78,
    librarySignals: 74,
    warningCount: 2
  },
  summary: {
    filesScanned: 42,
    colors: 15,
    fonts: 3,
    libraries: 4,
    components: 9
  },
  colors: [
    { value: "#0f766e", count: 28 },
    { value: "#17211b", count: 18 },
    { value: "#f8fafc", count: 16 },
    { value: "#d97706", count: 7 },
    { value: "#dc2626", count: 5 }
  ],
  colorGroups: {
    brand: [
      { value: "#0f766e", count: 28, label: "Brand color candidate" },
      { value: "#2563eb", count: 11, label: "Brand color candidate" }
    ],
    neutral: [
      { value: "#17211b", count: 18, label: "Neutral color candidate" },
      { value: "#f8fafc", count: 16, label: "Neutral color candidate" },
      { value: "#64748b", count: 12, label: "Neutral color candidate" }
    ],
    state: [
      { value: "#d97706", count: 7, label: "State color candidate" },
      { value: "#dc2626", count: 5, label: "State color candidate" }
    ],
    raw: []
  },
  fonts: [
    { value: "Inter", count: 18 },
    { value: "ui-sans-serif", count: 9 },
    { value: "font-mono", count: 3 }
  ],
  spacing: [
    { value: "gap-4", count: 34 },
    { value: "px-4", count: 29 },
    { value: "py-2", count: 22 },
    { value: "p-6", count: 14 }
  ],
  radii: [
    { value: "rounded-md", count: 27 },
    { value: "8px", count: 15 }
  ],
  shadows: [
    { value: "shadow-sm", count: 12 },
    { value: "0 1px 2px rgba(15, 23, 42, 0.08)", count: 8 }
  ],
  libraries: [
    { value: "tailwindcss", count: 7 },
    { value: "lucide-react", count: 4 },
    { value: "@radix-ui/react-dialog", count: 2 },
    { value: "next/font", count: 1 }
  ],
  components: {
    buttons: [
      { name: "Primary button candidate", signature: "inline-flex items-center rounded-md bg-teal-700 px-4 py-2 text-white", count: 12 },
      { name: "Secondary button candidate", signature: "rounded-md border border-slate-300 bg-white px-4 py-2", count: 9 }
    ],
    inputs: [
      { name: "Input field candidate", signature: "rounded-md border border-slate-300 px-3 py-2 focus:ring-2", count: 11 }
    ],
    cards: [
      { name: "Card/surface candidate", signature: "rounded-lg border bg-white p-6 shadow-sm", count: 14 }
    ]
  },
  warnings: [
    "Several brand-like colors are close enough to review for consolidation.",
    "Card surfaces are consistent, but input and button spacing use separate scales."
  ]
};

const stateViews = {
  empty: emptyState,
  loading: loadingState,
  error: errorState,
  snapshot: snapshotEl
};
function showState(name) {
  for (const [key, element] of Object.entries(stateViews)) {
    element.classList.toggle("hidden", key !== name);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function colorForSwatch(value) {
  if (/^#|^rgb|^hsl|^black$|^white$|^transparent$/i.test(value)) {
    return value;
  }
  return "linear-gradient(135deg, #f3f4f0, #d8e3dc)";
}

function ensureHealth(snapshot) {
  if (snapshot.health) return snapshot.health;

  const tokenCoverage = Math.min(100, Math.round(((snapshot.colors?.length || 0) + (snapshot.fonts?.length || 0) * 2 + (snapshot.spacing?.length || 0)) * 4));
  const componentCount =
    (snapshot.components?.buttons?.length || 0) +
    (snapshot.components?.inputs?.length || 0) +
    (snapshot.components?.cards?.length || 0);
  const componentCoverage = Math.min(100, componentCount * 18);
  const librarySignals = Math.min(100, (snapshot.libraries?.length || 0) * 22);
  const warningCount = snapshot.warnings?.length || 0;
  const overallScore = Math.max(12, Math.round(tokenCoverage * 0.42 + componentCoverage * 0.38 + librarySignals * 0.2 - warningCount * 7));

  return { overallScore, tokenCoverage, componentCoverage, librarySignals, warningCount };
}

function ensureColorGroups(snapshot) {
  if (snapshot.colorGroups) return snapshot.colorGroups;
  return {
    brand: (snapshot.colors || []).slice(0, 8).map((item) => ({ ...item, label: "Brand color candidate" })),
    neutral: [],
    state: [],
    raw: snapshot.colors || []
  };
}

function renderList(items, fallback = "No clear signal detected.") {
  if (!items?.length) return `<span class="pill">${fallback}</span>`;
  return items
    .map((item) => `<span class="pill">${escapeHtml(item.value)} | ${item.count}</span>`)
    .join("");
}

function renderTokenList(items, fallback = "No repeated token detected.") {
  if (!items?.length) return `<span class="token-row">${fallback}</span>`;
  return items
    .map((item) => `<span class="token-row"><strong>${escapeHtml(item.value)}</strong><span>${item.count}</span></span>`)
    .join("");
}

function renderColorGroup(title, items, fallback) {
  const body = items?.length
    ? items
        .map(
          (item) => `
            <div class="swatch">
              <div class="swatch-chip" style="background: ${escapeHtml(colorForSwatch(item.value))}"></div>
              <div>
                <strong>${escapeHtml(item.value)}</strong>
                <span>${escapeHtml(item.label || title)} | ${item.count} hits</span>
              </div>
            </div>
          `
        )
        .join("")
    : `<span class="pill">${fallback}</span>`;

  return `
    <div class="color-group">
      <h4>${title}</h4>
      <div class="swatch-grid">${body}</div>
    </div>
  `;
}

function renderSnapshot(snapshot) {
  currentSnapshot = {
    ...snapshot,
    health: ensureHealth(snapshot),
    colorGroups: ensureColorGroups(snapshot)
  };

  const { health, colorGroups } = currentSnapshot;
  document.querySelector("#snapshot-mode").textContent = `${currentSnapshot.mode} analysis | ${currentSnapshot.confidence} confidence`;
  document.querySelector("#snapshot-title").textContent = currentSnapshot.source.displayName || currentSnapshot.source.inputUrl;
  document.querySelector("#snapshot-meta").textContent = `${currentSnapshot.summary.filesScanned} source files or documents scanned`;
  document.querySelector("#overall-score").textContent = health.overallScore;

  document.querySelector("#health-grid").innerHTML = [
    ["Token coverage", health.tokenCoverage],
    ["Component coverage", health.componentCoverage],
    ["Library signals", health.librarySignals],
    ["Audit notes", health.warningCount]
  ]
    .map(([label, value]) => `<div class="health-item"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");

  document.querySelector("#metrics").innerHTML = [
    ["Colors", currentSnapshot.summary.colors],
    ["Fonts", currentSnapshot.summary.fonts],
    ["Libraries", currentSnapshot.summary.libraries],
    ["Families", currentSnapshot.summary.components]
  ]
    .map(([label, value]) => `<div class="metric-card"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");

  document.querySelector("#colors").innerHTML = [
    renderColorGroup("Brand candidates", colorGroups.brand, "No brand color candidates detected."),
    renderColorGroup("Neutral candidates", colorGroups.neutral, "No neutral color candidates detected."),
    renderColorGroup("State candidates", colorGroups.state, "No state color candidates detected.")
  ].join("");

  document.querySelector("#fonts").innerHTML = renderList(currentSnapshot.fonts, "No font families detected.");
  document.querySelector("#libraries").innerHTML = renderList(currentSnapshot.libraries, "No libraries detected.");

  const componentCards = [
    ...(currentSnapshot.components.buttons || []).map((item) => ({ ...item, kind: "button", preview: "Button" })),
    ...(currentSnapshot.components.inputs || []).map((item) => ({ ...item, kind: "input", preview: "Input" })),
    ...(currentSnapshot.components.cards || []).map((item) => ({ ...item, kind: "card", preview: "Surface" }))
  ];

  document.querySelector("#components").innerHTML = componentCards.length
    ? componentCards
        .map(
          (item) => `
            <div class="component-card">
              <div class="component-preview ${item.kind}">${escapeHtml(item.preview)}</div>
              <strong>${escapeHtml(item.name)}</strong>
              <span>${item.count} matches | ${escapeHtml(item.signature)}</span>
            </div>
          `
        )
        .join("")
    : `<span class="pill">No common component families detected.</span>`;

  document.querySelector("#surface-tokens").innerHTML = [
    ...renderTokenItems(currentSnapshot.radii, "Radius"),
    ...renderTokenItems(currentSnapshot.shadows, "Shadow")
  ].join("") || `<span class="token-row">No surface tokens detected.</span>`;

  document.querySelector("#spacing").innerHTML = renderTokenList(currentSnapshot.spacing);

  const warningsSection = document.querySelector("#warnings-section");
  const warnings = document.querySelector("#warnings");
  warningsSection.classList.toggle("hidden", !currentSnapshot.warnings.length);
  warnings.innerHTML = currentSnapshot.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");

  showState("snapshot");
}

function renderTokenItems(items, label) {
  return (items || []).map(
    (item) => `<span class="token-row"><strong>${label}: ${escapeHtml(item.value)}</strong><span>${item.count}</span></span>`
  );
}

async function analyze(url, mode) {
  showState("loading");
  errorState.textContent = "";

  const payload = { url };
  if (mode !== "auto") payload.mode = mode;

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Analysis failed.");
  }

  renderSnapshot(data);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function listMarkdown(items, fallback) {
  if (!items?.length) return `- ${fallback}`;
  return items.map((item) => `- ${item.value} (${item.count} hits)`).join("\n");
}

function componentMarkdown(items, fallback) {
  if (!items?.length) return `- ${fallback}`;
  return items.map((item) => `- ${item.name}: ${item.count} matches\n  Evidence: ${item.signature}`).join("\n");
}

function generateDesignMarkdown(snapshot) {
  const health = ensureHealth(snapshot);
  const colorGroups = ensureColorGroups(snapshot);

  return `# Interface Audit: ${snapshot.source.displayName || snapshot.source.inputUrl}

Source: ${snapshot.source.inputUrl}
Mode: ${snapshot.mode}
Confidence: ${snapshot.confidence}
Generated: ${snapshot.analyzedAt}

## Audit Summary
- Overall score: ${health.overallScore}
- Token coverage: ${health.tokenCoverage}
- Component coverage: ${health.componentCoverage}
- Library signals: ${health.librarySignals}
- Audit notes: ${health.warningCount}

## Detected Palette
### Brand candidates
${listMarkdown(colorGroups.brand, "No brand color candidates detected.")}

### Neutral candidates
${listMarkdown(colorGroups.neutral, "No neutral color candidates detected.")}

### State candidates
${listMarkdown(colorGroups.state, "No state color candidates detected.")}

## Typography
${listMarkdown(snapshot.fonts, "No font families detected.")}

## Detected Libraries
${listMarkdown(snapshot.libraries, "No libraries detected.")}

## Component Families
### Buttons
${componentMarkdown(snapshot.components.buttons, "No button families detected.")}

### Inputs
${componentMarkdown(snapshot.components.inputs, "No input families detected.")}

### Cards and surfaces
${componentMarkdown(snapshot.components.cards, "No card or surface families detected.")}

## Spacing
${listMarkdown(snapshot.spacing, "No spacing scale detected.")}

## Radii and Shadows
${listMarkdown([...(snapshot.radii || []), ...(snapshot.shadows || [])], "No surface tokens detected.")}

## Audit Notes
${snapshot.warnings?.length ? snapshot.warnings.map((warning) => `- ${warning}`).join("\n") : "- No warnings."}
`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = new FormData(form).get("mode");

  try {
    await analyze(input.value.trim(), mode);
  } catch (error) {
    errorState.textContent = error.message;
    showState("error");
  }
});

document.querySelectorAll("[data-sample]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.sample;
    form.requestSubmit();
  });
});

function runDemo() {
  renderSnapshot({ ...demoSnapshot, analyzedAt: new Date().toISOString() });
}

demoButton.addEventListener("click", runDemo);
emptyDemoButton.addEventListener("click", runDemo);

exportJsonButton.addEventListener("click", () => {
  if (!currentSnapshot) return;
  downloadFile(`interface-audit-${currentSnapshot.mode}.json`, JSON.stringify(currentSnapshot, null, 2), "application/json");
});

exportMdButton.addEventListener("click", () => {
  if (!currentSnapshot) return;
  downloadFile("design.md", generateDesignMarkdown(currentSnapshot), "text/markdown");
});
