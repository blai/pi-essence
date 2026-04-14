---
name: md-gdoc
description: >
  Use this skill when asked to convert a Markdown file (.md) to a Google Doc,
  upload markdown to Google Docs, turn a .md file into a Google Docs document,
  or publish multiple markdown files as separate tabs in one Google Doc.
  Handles headings, bold, italic, code blocks, tables (with auto-sized column
  widths), mermaid diagrams (rendered as inline images), ordered/unordered
  lists, blockquotes, and links. Requires the gws CLI authenticated with drive
  and docs scopes, and curl.
---

## Setup

Authenticate: `gws auth login -s drive,docs`. Verify curl is installed (`curl --version`).

## Workflow — Single document (one .md file)

1. **Run the converter:**
   ```bash
   node skills/md-gdoc/scripts/convert.js <input.md> \
     [--title "My Title"] \
     [--folder-id DRIVE_FOLDER_ID] \
     [--page-width 468]
   # → prints: https://docs.google.com/document/d/DOC_ID/edit
   ```

2. **Back-link the report title to the GDoc** (optional but recommended):
   ```bash
   node skills/md-gdoc/scripts/update-title-link.js <input.md> <gdoc_url>
   ```
   Auto-detects the heading pattern and embeds the GDoc URL in the H1. Then re-run convert.js with `--doc-id DOC_ID` to push the updated title to the same doc.

3. **If the script errors**, diagnose with the checklist below, then re-run:
   - `gws auth login -s drive,docs` → re-authenticate if token expired
   - `curl --version` → install curl if missing
   - Mermaid warnings → see References: mermaid-guide

4. **Share the Google Doc URL** with the user.

## Workflow — Multi-tab document (multiple .md files → one Doc)

Use this when the user asks for separate tabs, e.g.
"publish report.md as Tab 1 and journey.md as Tab 2 in the same Google Doc."

### Step A — Create the document and Tab 1

```bash
node skills/md-gdoc/scripts/convert.js first.md --title "My Report"
# → prints: https://docs.google.com/document/d/DOC_ID/edit
```

### Step B — Add a new tab

```bash
gws docs documents batchUpdate \
  --params '{"documentId": "DOC_ID"}' \
  --json '{"requests": [{"addDocumentTab": {"tabProperties": {"title": "Tab Title"}}}]}'
# → response includes: tabProperties.tabId  (e.g. "t.bvkkezvf5hzx")
```

### Step C — Populate the new tab

```bash
node skills/md-gdoc/scripts/md-to-tab-native.js second.md \
  --doc-id DOC_ID \
  --tab-id TAB_ID \
  [--page-width 468]
```

Repeat Steps B–C for each additional tab.

### Updating an existing tab (re-publish)

To refresh a tab's content after the source `.md` changes:
```bash
node skills/md-gdoc/scripts/md-to-tab-native.js updated.md \
  --doc-id DOC_ID \
  --tab-id TAB_ID
```

> **Important — do NOT use `convert.js --doc-id` on a multi-tab document.**
> `convert.js --doc-id` re-imports the markdown as a brand-new document body, silently destroying all tabs except Tab 1.
> The script detects this and refuses with an error if the target doc has > 1 tab.
> Use `md-to-tab-native.js` for all tab updates.

## Gotchas

- **curl MUST be installed** — used to fetch mermaid PNGs from mermaid.ink. Available by default on macOS and most Linux distros.
- **Mermaid requires internet access** — mermaid.ink is a public render service. On restricted networks, mermaid blocks fall back to a plain text placeholder with a `⚠` warning; the rest of the document still converts.
- **Table column widths** use character count as a proxy for content width. This works well for text-heavy tables; tables with many short words may need manual adjustment afterward.
- **Page width default is 468pt** (US Letter, 1-inch margins). For A4 with 1-inch margins pass `--page-width 451`.
- **Images in source .md** — only publicly accessible remote URLs are supported; Drive's native import cannot resolve local file paths.
- **Table optimization is non-fatal** — if `updateTableColumnProperties` fails (e.g., single-column table), it logs a warning and the script still succeeds.
- **Auth scopes** — `gws auth login` without `-s` grants all scopes; `-s drive,docs` is sufficient and narrower.
- **Mermaid diagrams in tabs** — `md-to-tab-native.js` cannot re-insert mermaid diagrams into a tab. Diagrams render as blank spaces in tab replays; they render correctly in standalone docs via `convert.js`.

## References

- Load `references/element-map.md` when: a specific markdown element is missing or wrong in the output, or manual Docs API requests are needed to fix up the converted document.
- Load `references/mermaid-guide.md` when: mermaid diagrams fail to render, the user wants to render diagrams separately, or the mermaid.ink service is unreachable.
