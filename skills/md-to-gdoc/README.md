# md-to-gdoc

Convert a Markdown file to a Google Doc — with **mermaid diagrams rendered as images**, **tables auto-sized by content**, headings, bold/italic, code blocks, links, and lists all faithfully preserved.

## How It Works

```mermaid
flowchart TD
    A["`**.md file**`"] --> B{Contains\nmermaid blocks?}
    B -- Yes --> C[Render each block\nvia mermaid.ink → PNG]
    B -- No --> D
    C --> D[Replace fences with\n local image references]
    D --> E["pandoc\nmarkdown → .docx\n(images embedded)"]
    E --> F["gws drive files upload\nmimeType: gdoc\n→ Drive auto-converts"]
    F --> G[gws docs documents get\nfetch doc structure]
    G --> H{Tables\nfound?}
    H -- Yes --> I[Measure max text length\nper column → distribute\n468pt proportionally]
    I --> J[updateTableColumnProperties\nFIXED_WIDTH per column]
    H -- No --> K
    J --> K[/"✓ Google Doc URL"/]
```

## Conversion Pipeline — Step by Step

| Step | Mechanism |
|------|-----------|
| **1 — Mermaid** | Extracts ` ```mermaid ` blocks → renders PNG via `mermaid.ink` (tries raw base64url, falls back to JSON envelope) → embeds as local image reference |
| **2 — DOCX** | `pandoc --from=markdown+smart --to=docx` — handles headings, bold/italic, tables, lists, blockquotes, links, code blocks, images natively |
| **3 — Upload** | `gws drive files upload` with `mimeType: application/vnd.google-apps.document` — Google Drive auto-converts the `.docx` to a Google Doc |
| **4 — Column widths** | Fetches doc structure → measures max text length per column → distributes 468 pt page width proportionally → `updateTableColumnProperties` with `FIXED_WIDTH` |

## Quick Start

```bash
# 1. Authenticate (one-time)
gws auth login -s drive,docs

# 2. Install pandoc (one-time)
brew install pandoc   # macOS
# apt install pandoc  # Ubuntu

# 3. Convert
node skills/md-to-gdoc/scripts/convert.js path/to/document.md --title "My Doc"
# → https://docs.google.com/document/d/DOC_ID/edit
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--title "My Title"` | filename (no extension) | Google Doc title |
| `--folder-id ID` | My Drive root | Destination Drive folder |
| `--page-width 468` | `468` (US Letter, 1" margins) | Page body width in points for column sizing |

## What Gets Preserved

| Markdown | Google Doc |
|----------|-----------|
| `# H1` … `###### H6` | HEADING_1 … HEADING_6 styles |
| `**bold**`, `*italic*`, `***both***` | Bold, italic, bold+italic |
| `` `inline code` `` | Courier New inline |
| ```` ```code block``` ```` | Preformatted monospace |
| `[text](url)` | Hyperlink |
| `![alt](src)` | Embedded inline image |
| `- item`, `1. item` | Unordered / ordered lists (nested ✓) |
| `> blockquote` | Indented paragraph |
| `\| table \|` | Table with proportional column widths |
| ` ```mermaid ` | Rendered PNG inline image |
| `---` | Horizontal rule |
| `[^1]` footnotes | Footnotes |

## Pseudo-Logic: Column Width Algorithm

```javascript
// For each table in the document:
const PAGE_WIDTH_PT = 468;  // US Letter, 1-inch margins
const MIN_PT = 40;

// 1. Measure max text length per column (includes header row)
const maxLens = Array(numCols).fill(1);
for (const row of table.tableRows) {
  row.tableCells.forEach((cell, colIndex) => {
    const len = extractText(cell).length;
    if (len > maxLens[colIndex]) maxLens[colIndex] = len;
  });
}

// 2. Distribute page width proportionally
const totalLen = maxLens.reduce((a, b) => a + b, 0);
let widths = maxLens.map(l =>
  Math.max(MIN_PT, Math.round((l / totalLen) * PAGE_WIDTH_PT))
);

// 3. Scale down if columns overflow page
const sum = widths.reduce((a, b) => a + b, 0);
if (sum > PAGE_WIDTH_PT) {
  const scale = PAGE_WIDTH_PT / sum;
  widths = widths.map(w => Math.max(MIN_PT, Math.round(w * scale)));
}

// 4. Apply via Docs API
widths.forEach((magnitude, columnIndex) => {
  batchUpdate({ updateTableColumnProperties: {
    tableStartLocation: { index: tableStartIndex },
    columnIndices: [columnIndex],
    tableColumnProperties: { widthType: "FIXED_WIDTH", width: { magnitude, unit: "PT" } },
    fields: "width,widthType",   // both required — API returns 400 without widthType
  }});
});
```

## Mermaid Rendering Details

```mermaid
sequenceDiagram
    participant Script as convert.js
    participant Ink as mermaid.ink
    participant Pandoc as pandoc
    participant Drive as Google Drive

    Script->>Ink: GET /img/base64url?type=png&width=2000
    alt Render OK — PNG larger than 200 bytes
        Ink-->>Script: PNG file
    else Render failed
        Script->>Ink: GET /img/json_envelope (fallback)
        alt Fallback OK
            Ink-->>Script: PNG file
        else Both failed
            Script-->>Script: Keep as plain code block
        end
    end
    Script->>Pandoc: markdown with local image refs
    Pandoc-->>Script: output.docx with images embedded
    Script->>Drive: upload docx, mimeType gdoc
    Drive-->>Script: converted Google Doc ID
```

## Gotchas

- **pandoc is required** — install before running; the script exits early with instructions if missing.
- **Mermaid needs internet** — mermaid.ink is a public service. On offline/restricted networks, mermaid blocks fall back to plain code blocks; the rest of the document still converts.
- **Column widths use character count** as a proxy for visual width — works well for prose-heavy tables. Tables with many short values (e.g., status columns) may need manual fine-tuning in Google Docs.
- **Drive conversion fidelity** — Google's docx importer is excellent but not pixel-perfect. Complex pandoc-specific styles (e.g., custom reference.docx themes) may not survive.
- **Table optimization is non-fatal** — a failure to set column widths logs a warning but never blocks the upload.

## Dependencies

| Tool | Purpose | Install |
|------|---------|---------|
| `gws` CLI | Google Drive upload + Docs API | [buildwithpi.ai](https://buildwithpi.ai) |
| `pandoc` | Markdown → DOCX conversion | `brew install pandoc` |
| `curl` | mermaid.ink PNG download | pre-installed on macOS/Linux |
| `node` | Run `convert.js` | [nodejs.org](https://nodejs.org) |

## File Structure

```
skills/md-to-gdoc/
├── SKILL.md                     ← pi skill definition (auto-loaded by pi)
├── README.md                    ← this file
├── scripts/
│   └── convert.js               ← conversion script (no npm deps)
└── references/
    ├── element-map.md           ← markdown → Docs API mapping + manual request examples
    └── mermaid-guide.md         ← mermaid troubleshooting + alternative renderers
```
