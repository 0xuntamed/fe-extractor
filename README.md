# Interface Auditor

Interface Auditor turns a public frontend project into a compact design-system audit. Give it a public GitHub repository or a live website and it will scan the available source for colors, typography, spacing, surface styles, UI libraries, and repeated component patterns.

The resulting report includes an audit score, confidence notes, and exports for both JSON and `design.md`.

## Features

- Analyze public GitHub repositories or live websites
- Detect color values and group likely brand, neutral, and state colors
- Inventory font families, spacing, border radii, and shadows
- Identify common frontend and component libraries
- Find repeated button, input, and card patterns
- Score token coverage, component coverage, and library signals
- Export the report as JSON or Markdown
- Run a built-in demo without making an external request

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer

The project uses only built-in Node.js APIs, so there are no runtime dependencies to install.

## Quick start

```bash
git clone <repository-url>
cd fe-extractor
npm start
```

Open [http://localhost:4173](http://localhost:4173) in your browser.

To use another port:

```bash
PORT=3000 npm start
```

On PowerShell:

```powershell
$env:PORT=3000
npm start
```

## Usage

1. Enter a public GitHub repository URL or live website URL.
2. Choose an analysis mode:
   - **Auto** detects GitHub URLs and otherwise treats the URL as a live site.
   - **Repo** reads frontend files from a public GitHub repository.
   - **Live** reads a page's HTML, inline styles, and linked stylesheets.
3. Select **Audit** to generate the report.
4. Use **Export design.md** or **Export JSON** to save the results.

You can also select **Analyze demo** to explore a sample report locally.

## What gets analyzed

### Repository mode

Repository mode uses the public GitHub API to find likely frontend files, prioritizing configuration, styles, components, and package manifests. It scans up to 90 files with extensions such as:

```text
.css .scss .sass .less .html .js .jsx .ts .tsx .mjs .cjs .json
```

Generated output, dependency folders, coverage data, and lockfiles are skipped. Each selected file is limited to 180,000 characters.

### Live mode

Live mode fetches:

- The page HTML
- Inline `<style>` blocks
- Up to 12 linked stylesheets

It analyzes the fetched source rather than a fully rendered browser page. Styles or components created only after client-side JavaScript runs may therefore be absent from the report.

## API

The browser client uses a single endpoint:

```http
POST /api/analyze
Content-Type: application/json
```

Example request:

```json
{
  "url": "https://github.com/tailwindlabs/headlessui",
  "mode": "repo"
}
```

`mode` is optional and accepts `repo` or `live`. When omitted, the server infers the mode from the URL.

Example with `curl`:

```bash
curl -X POST http://localhost:4173/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"url":"https://nextjs.org","mode":"live"}'
```

The response contains source metadata, summary counts, health scores, detected tokens, component candidates, and warnings.

## Project structure

```text
.
├── server.js          # HTTP server, source fetching, and audit logic
├── package.json       # Project metadata and start script
└── public/
    ├── index.html     # Application markup
    ├── app.js         # Client-side rendering and exports
    └── styles.css     # Interface styles
```

## How detection works

Interface Auditor uses lightweight pattern matching rather than a browser engine or JavaScript parser. It counts repeated source-level signals such as:

- Hex, RGB, HSL, named, and Tailwind color values
- CSS font declarations, Google Fonts references, and font utility classes
- CSS measurements and common spacing, radius, and shadow utilities
- Known package and import names
- HTML or JSX-like button, input, and surface patterns

The audit score is an estimate of how much reusable design-system evidence was detected. It is intended to guide review, not serve as a pass/fail quality score.

## Limitations

- Only public repositories are supported; private GitHub authentication is not implemented.
- GitHub API rate limits apply to repository analysis.
- Sites that block server-side requests or stylesheet access may return incomplete results.
- Live mode does not execute client-side JavaScript.
- Minified, generated, dynamic, or unconventional source can reduce detection accuracy.
- Extracted values are candidates and should be reviewed before becoming design tokens.

## Scripts

```bash
npm start
```

Starts the application with `node server.js`.

## License

No license file is currently included. Add one before distributing or accepting external contributions.
