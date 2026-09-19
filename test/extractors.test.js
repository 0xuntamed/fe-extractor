import test from "node:test";
import assert from "node:assert/strict";
import {
  countValues,
  extractColors,
  categorizeColorValue,
  extractFonts,
  extractMeasurements,
  extractLibraries,
  extractComponents,
  buildSnapshot
} from "../src/extractors.js";

test("countValues tallies, normalizes whitespace, and sorts by frequency", () => {
  const result = countValues(["a", "a", "  a  ", "b", "", null]);
  assert.deepEqual(result[0], { value: "a", count: 3 });
  assert.deepEqual(result[1], { value: "b", count: 1 });
  assert.equal(result.length, 2);
});

test("extractColors detects hex, rgb, tailwind, and named colors with counts", () => {
  const text = "#fff #ffffff color: rgb(0, 0, 0); class='bg-blue-500 bg-blue-500' white";
  const colors = extractColors(text);
  const byValue = Object.fromEntries(colors.map((c) => [c.value, c.count]));

  assert.equal(byValue["bg-blue-500"], 2);
  assert.equal(byValue["rgb(0, 0, 0)"], 1);
  assert.equal(byValue["#ffffff"], 1);
  assert.equal(byValue["white"], 1);
});

test("categorizeColorValue buckets neutral, state, and brand", () => {
  assert.equal(categorizeColorValue("slate-200"), "neutral");
  assert.equal(categorizeColorValue("#ffffff"), "neutral"); // very bright
  assert.equal(categorizeColorValue("#111111"), "neutral"); // very dark
  assert.equal(categorizeColorValue("bg-red-500"), "state");
  assert.equal(categorizeColorValue("#0f766e"), "brand"); // saturated teal
});

test("extractFonts reads font-family and skips generic keywords", () => {
  const fonts = extractFonts('font-family: "Testface", ui-sans-serif, sans-serif;');
  const values = fonts.map((f) => f.value);
  assert.ok(values.includes("Testface"));
  assert.ok(values.includes("ui-sans-serif"));
  assert.ok(!values.includes("sans-serif"));
});

test("extractFonts decodes Google Fonts references", () => {
  const fonts = extractFonts("https://fonts.googleapis.com/css2?family=Zzz+Grotesk&display=swap");
  assert.ok(fonts.some((f) => f.value === "Zzz Grotesk"));
});

test("extractMeasurements groups radii, shadows, and spacing", () => {
  const text = "rounded-md rounded-md rounded-lg shadow-sm p-4 gap-6";
  const { radii, spacing, shadows } = extractMeasurements(text);
  assert.equal(radii.find((r) => r.value === "rounded-md").count, 2);
  assert.ok(spacing.some((s) => s.value === "p-4"));
  assert.ok(spacing.some((s) => s.value === "gap-6"));
  assert.ok(shadows.some((s) => s.value === "shadow-sm"));
});

test("extractLibraries finds hints in text and in package.json deps", () => {
  const packageJson = {
    path: "package.json",
    content: JSON.stringify({ dependencies: { "lucide-react": "^1.0.0" } })
  };
  const libs = extractLibraries("import 'tailwindcss'", [packageJson]);
  const values = libs.map((l) => l.value);
  assert.ok(values.includes("tailwindcss"));
  assert.ok(values.includes("lucide-react"));
});

test("extractLibraries ignores malformed package.json without throwing", () => {
  const bad = { path: "package.json", content: "{ not valid json" };
  assert.doesNotThrow(() => extractLibraries("", [bad]));
});

test("extractComponents classifies buttons, inputs, and cards", () => {
  const text = `
    <button class="inline-flex rounded-md bg-teal-700 px-4 py-2 text-white">Save</button>
    <input class="rounded-md border px-3 py-2" />
    <div class="rounded-lg border bg-white p-6 shadow-sm">card</div>
  `;
  const { buttons, inputs, cards } = extractComponents(text);
  assert.equal(buttons[0].name, "Primary button candidate");
  assert.equal(inputs[0].name, "Input field candidate");
  assert.equal(cards[0].name, "Card/surface candidate");
});

test("extractComponents labels a destructive button as danger", () => {
  const { buttons } = extractComponents('<button class="bg-red-600 text-white">Delete</button>');
  assert.equal(buttons[0].name, "Danger button candidate");
});

test("buildSnapshot returns the expected report shape", () => {
  const html = `
    <style>:root { --a: #0f766e; } .btn { border-radius: 8px; }</style>
    <button class="rounded-md bg-teal-700 px-4 py-2">Go</button>
    <div class="rounded-lg border bg-white p-6 shadow-sm">card</div>
  `;
  const snapshot = buildSnapshot({
    mode: "live",
    source: { inputUrl: "https://example.com", displayName: "example.com" },
    files: [{ path: "https://example.com", content: html }],
    text: html
  });

  assert.equal(snapshot.mode, "live");
  assert.ok(Array.isArray(snapshot.colors));
  assert.ok(snapshot.colorGroups.brand);
  assert.ok(["low", "medium", "high"].includes(snapshot.confidence));
  assert.equal(snapshot.summary.filesScanned, 1);
  assert.ok(Array.isArray(snapshot.warnings));
  assert.equal("health" in snapshot, false); // audit score is gone
});

test("buildSnapshot warns when signals are sparse", () => {
  const snapshot = buildSnapshot({
    mode: "live",
    source: { inputUrl: "https://blank.example", displayName: "blank.example" },
    files: [{ path: "https://blank.example", content: "<p>hello</p>" }],
    text: "<p>hello</p>"
  });
  assert.ok(snapshot.warnings.includes("No explicit font family was detected."));
  assert.ok(snapshot.warnings.includes("No clear button pattern was detected."));
});
