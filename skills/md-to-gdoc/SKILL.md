---
name: md-to-gdoc
description: >
  Use this skill when asked to convert a Markdown file (.md) to a Google Doc,
  upload markdown to Google Docs, or turn a .md file into a Google Docs
  document. Handles headings, bold, italic, code blocks, tables (with
  auto-sized column widths), mermaid diagrams (rendered as inline images),
  ordered/unordered lists, blockquotes, and links. Requires the gws CLI
  authenticated with drive and docs scopes, and pandoc installed. Does NOT
  handle LaTeX math, raw HTML embeds, or multi-tab documents.
---

## Setup

```bash
# Authenticate gws with Drive + Docs (one-time per machine)
gws auth login -s drive,docs

# Install pandoc (one-time)
brew install pandoc          # macOS
sudo apt install pandoc      # Ubuntu/Debian
# Windows: https://pandoc.org/installing.html

pandoc --version  # verify
```

## Workflow

1. **Confirm inputs** with the user:
   - Path to the `.md` file
   - Desired Google Doc title (default: filename without extension)
   - Optional: Drive folder ID (from the folder URL in Drive)

2. **Run the converter:**
   ```bash
   node skills/md-to-gdoc/scripts/convert.js <input.md> \
     [--title "My Title"] \
     [--folder-id DRIVE_FOLDER_ID] \
     [--page-width 468]
   ```
   The script prints the Google Doc URL to stdout on success.

3. **If the script errors**, diagnose with the checklist below, then re-run:
   - `gws auth login -s drive,docs` → re-authenticate if token expired
   - `pandoc --version` → install pandoc if missing
   - Mermaid warnings → see References: mermaid-guide

4. **Share the Google Doc URL** with the user.

## What the Script Does

| Step | Action |
|------|--------|
| 1 | Scans for `mermaid` fenced blocks → renders each via mermaid.ink → saves PNG to temp dir |
| 2 | Replaces each mermaid fence with `![Mermaid diagram](path/to/png)` |
| 3 | Runs `pandoc --from=markdown+smart --to=docx` (embeds local images into the docx) |
| 4 | Uploads the `.docx` to Google Drive with `mimeType: application/vnd.google-apps.document` — Drive auto-converts to Google Doc |
| 5 | Fetches the resulting doc structure via `gws docs documents get` |
| 6 | For each table: measures max content length per column → distributes page width proportionally (min 40pt/col) → applies `updateTableColumnProperties` |

## Gotchas

- **pandoc MUST be installed** — the script exits early with install instructions if missing.
- **Mermaid requires internet access** — mermaid.ink is a public render service. On restricted networks, mermaid blocks fall back to a plain code block with a `⚠` warning; the rest of the document still converts.
- **Table column widths** use character count as a proxy for content width. This works well for text-heavy tables; tables with many short words may need manual adjustment in Google Docs afterward.
- **Page width default is 468pt** (US Letter, 1-inch margins). For A4 with 1-inch margins pass `--page-width 451`. The constant lives at the top of `convert.js` as `PAGE_WIDTH_PT`.
- **Drive conversion** — uploading a `.docx` with `mimeType: application/vnd.google-apps.document` triggers Google Drive's built-in import. Formatting fidelity is high but not pixel-perfect; complex custom styles may flatten.
- **Images in the source .md** — local image paths are resolved relative to the `.md` file's directory. Remote URLs work if they are publicly accessible during the pandoc run.
- **Table optimization is non-fatal** — if the Docs API call to set column widths fails (e.g., a table has only one column), it logs a warning and the script still succeeds with the uploaded doc.
- **Auth scopes** — `gws auth login` without `-s` grants all scopes; `-s drive,docs` is sufficient and narrower.

## References

- Load `references/element-map.md` when: a specific markdown element (e.g., footnotes, definition lists, strikethrough) is missing or wrong in the output, or the pandoc/upload path is unavailable and manual Docs API requests are needed.
- Load `references/mermaid-guide.md` when: mermaid diagrams fail to render, the user wants to render diagrams separately before conversion, or the mermaid.ink service is unreachable.
