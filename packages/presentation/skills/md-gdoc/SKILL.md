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

```bash
# Authenticate gws with Drive + Docs (one-time per machine)
gws auth login -s drive,docs

# Verify curl is available (used for mermaid rendering)
curl --version
```

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
   Updates the H1 heading in `input.md` to hyperlink the document-type phrase back
   to the GDoc (e.g. `# Architecture Gap Report — X` → `# [Architecture Gap Report](url) — X`).
   Then re-run convert.js with `--doc-id DOC_ID` to push the updated title to the same doc.

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
> `convert.js --doc-id` uses `drive.files.update` which re-imports the markdown
> as a brand-new document body, silently destroying all tabs except Tab 1.
> The script detects this and refuses with an error if the target doc has > 1 tab.
> Use `md-to-tab-native.js` for all tab updates.

## What the Scripts Do

### `convert.js`

| Step | Action |
|------|--------|
| 1 | Scans for `mermaid` fenced blocks → renders each via mermaid.ink → uploads PNG to Drive (public) |
| 2 | Injects blank lines before tables (Drive import requires them) and trailing `  ` between consecutive `**Field**: value` lines (so metadata renders one-per-line) |
| 3 | Uploads `.md` as `text/markdown` with `mimeType: application/vnd.google-apps.document` — Drive natively converts |
| 4 | Sets pageless mode |
| 5 | Replaces mermaid placeholder paragraphs with `insertInlineImage` |
| 6 | Applies table borders, header shading, and sqrt-weighted column widths |
| 7 | Deletes temporary mermaid PNGs from Drive |

### `update-title-link.js`

Embeds the GDoc URL into the report's H1 title.  Auto-detects the heading pattern:

| Pattern | Before | After |
|---|---|---|
| Bare bracketed tag (RCA style) | `# [RCA] [TC-5328](...): Title` | `# [[RCA]](url) [TC-5328](...): Title` |
| Phrase before `—` (arch-gap style) | `# Architecture Gap Report — Domain` | `# [Architecture Gap Report](url) — Domain` |
| Phrase before `:` | `# My Report: Subtitle` | `# [My Report](url): Subtitle` |
| Bare title | `# My Report` | `# [My Report](url)` |
| Already linked | `# [Phrase](old_url) ...` | `# [Phrase](new_url) ...` (URL updated) |

Idempotent — safe to call multiple times. Writes the `.md` file in-place.

### `md-to-tab-native.js`

| Step | Action |
|------|--------|
| 1 | Runs `convert.js` on the input file → creates a perfectly-formatted temporary Doc |
| 2 | Reads the temp doc's structured body via `documents.get` |
| 3 | Clears the target tab's existing content |
| 4 | Inserts all body text into the tab via one `insertText` call |
| 5 | Applies paragraph styles (headings) + text-run styles (bold/italic/link/mono). Note: native Docs bullet formatting is NOT replayed (list-item text `- ` / `1. ` is preserved verbatim) — see element-map.md for why |
| 6 | Replaces `TABLE_N` placeholders (reverse order) with real `insertTable` + fills cells + applies column widths + borders + header shading |
| 7 | Deletes the temporary doc |

## Gotchas

- **curl MUST be installed** — used to fetch mermaid PNGs from mermaid.ink. Available by default on macOS and most Linux distros.
- **Mermaid requires internet access** — mermaid.ink is a public render service. On restricted networks, mermaid blocks fall back to a plain text placeholder with a `⚠` warning; the rest of the document still converts.
- **Table column widths** use character count as a proxy for content width. This works well for text-heavy tables; tables with many short words may need manual adjustment afterward.
- **Page width default is 468pt** (US Letter, 1-inch margins). For A4 with 1-inch margins pass `--page-width 451`.
- **Images in source .md** — only publicly accessible remote URLs are supported; Drive's native import cannot resolve local file paths.
- **Table optimization is non-fatal** — if `updateTableColumnProperties` fails (e.g., single-column table), it logs a warning and the script still succeeds.
- **Auth scopes** — `gws auth login` without `-s` grants all scopes; `-s drive,docs` is sufficient and narrower.
- **Mermaid diagrams in tabs** — `md-to-tab-native.js` cannot re-insert mermaid diagrams into a tab (Drive has no API to copy embedded images between documents). Diagrams render as blank spaces in tab replays; they render correctly in standalone docs via `convert.js`.

## References

- Load `references/element-map.md` when: a specific markdown element is missing or wrong in the output, or manual Docs API requests are needed to fix up the converted document.
- Load `references/mermaid-guide.md` when: mermaid diagrams fail to render, the user wants to render diagrams separately, or the mermaid.ink service is unreachable.
