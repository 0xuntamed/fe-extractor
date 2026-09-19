import { fetchTextGuarded, pooledMap } from "./net.js";
import { buildSnapshot } from "./extractors.js";

const MAX_STYLESHEETS = 12;
const FETCH_CONCURRENCY = 6;

export async function analyzeLive(inputUrl) {
  const url = new URL(inputUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Live mode requires an http or https URL.");
  }

  // The SSRF guard runs inside fetchTextGuarded for the page and every stylesheet.
  const html = await fetchTextGuarded(url.href);
  const warnings = [];

  const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);

  const cssLinks = [...html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => new URL(match[1], url.href).href)
    .slice(0, MAX_STYLESHEETS);

  const linkedStyles = (
    await pooledMap(cssLinks, FETCH_CONCURRENCY, async (cssUrl) => {
      try {
        return await fetchTextGuarded(cssUrl);
      } catch {
        warnings.push(`Skipped stylesheet ${cssUrl} because it could not be fetched.`);
        return null;
      }
    })
  ).filter((content) => content !== null);

  const cssBlocks = [...inlineStyles, ...linkedStyles];

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
