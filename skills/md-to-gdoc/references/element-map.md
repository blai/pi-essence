# Markdown → Google Docs API Element Map

Load this file when:
- A specific markdown element is missing or wrong in the converted Google Doc
- The pandoc/upload approach is unavailable and manual Docs API requests are needed
- You need to understand which Docs API request type handles a given markdown construct

---

## Element Coverage by pandoc → Drive conversion

Most elements are handled transparently by pandoc's docx output + Google Drive's import.

| Markdown element | Pandoc handling | Drive import | Notes |
|-----------------|-----------------|--------------|-------|
| `# H1` – `###### H6` | HEADING_1–6 styles | ✓ Preserved | |
| `**bold**` / `__bold__` | Bold character style | ✓ Preserved | |
| `*italic*` / `_italic_` | Italic character style | ✓ Preserved | |
| `***bold italic***` | Bold + italic | ✓ Preserved | |
| `` `inline code` `` | Courier New font | ✓ Preserved | |
| ```` ```code block``` ```` | Preformatted text | ✓ Preserved (monospace) | Language hint dropped |
| `[text](url)` | Hyperlink | ✓ Preserved | |
| `![alt](src)` | Inline image | ✓ Embedded in docx | Local paths resolved via `--resource-path` |
| `- item` / `* item` | Unordered list | ✓ Preserved | Nested lists ✓ |
| `1. item` | Ordered list | ✓ Preserved | Nested lists ✓ |
| `> blockquote` | Indented paragraph | ✓ (style may vary) | No native blockquote style in Docs |
| `---` / `***` | Horizontal rule | ✓ (page-width line) | |
| `| table |` | Table | ✓ Preserved; widths post-processed by script | |
| `~~strikethrough~~` | Strikethrough | ✓ if `--from=markdown+strikeout` | Add `+strikeout` to pandoc flags |
| `[^1]` footnotes | Footnote | ✓ Preserved | |
| Definition lists | Definition list | Partial — flattened | pandoc extension `definition_lists` |
| Math `$...$` | Not supported | ✗ Dropped | Pre-render to image with MathJax/KaTeX |
| Raw HTML `<div>` | Stripped | ✗ | Use native markdown equivalents |
| Mermaid ` ```mermaid ` | Pre-rendered to PNG | ✓ as inline image | Handled in Step 1 of convert.js |

---

## Manual Docs API requests (fallback)

Use this section when you must construct `batchUpdate` requests by hand (e.g., pandoc unavailable, post-conversion fixups).

### Key rules
- Document body starts at **index 1** (index 0 is a structural segment start).
- Every paragraph ends with `\n` — counts as 1 character toward indices.
- Build requests in **reverse order** (end → start) so earlier insertions don't shift later indices. Or track `currentIndex` forward.
- Always include `fields` mask in style requests.

### Insert plain text
```json
{ "insertText": { "location": { "index": 1 }, "text": "Hello World\n" } }
```

### Apply paragraph style (heading)
```json
{
  "updateParagraphStyle": {
    "range": { "startIndex": 1, "endIndex": 12 },
    "paragraphStyle": { "namedStyleType": "HEADING_1" },
    "fields": "namedStyleType"
  }
}
```
Named style types: `NORMAL_TEXT`, `HEADING_1` – `HEADING_6`, `TITLE`, `SUBTITLE`

### Bold / italic text
```json
{
  "updateTextStyle": {
    "range": { "startIndex": 1, "endIndex": 6 },
    "textStyle": { "bold": true, "italic": false },
    "fields": "bold,italic"
  }
}
```

### Insert hyperlink
```json
{
  "updateTextStyle": {
    "range": { "startIndex": 5, "endIndex": 10 },
    "textStyle": { "link": { "url": "https://example.com" } },
    "fields": "link"
  }
}
```

### Insert table
```json
{
  "insertTable": {
    "rows": 3,
    "columns": 2,
    "location": { "index": 1 }
  }
}
```
After insertion, call `documents.get` to find exact cell indices before inserting text into cells.

### Set table column width (per column)
```json
{
  "updateTableColumnProperties": {
    "tableStartLocation": { "index": 5 },
    "columnIndices": [0],
    "tableColumnProperties": {
      "widthType": "FIXED_WIDTH",
      "width": { "magnitude": 150, "unit": "PT" }
    },
    "fields": "width,widthType"
  }
}
```
- `fields` MUST include both `width` and `widthType` — omitting `widthType` returns a 400 error.
- Omit `columnIndices` (empty array) to apply to ALL columns.
- Minimum column width: **5 PT** (API enforced).

### Inline image (from URL)
```json
{
  "insertInlineImage": {
    "location": { "index": 1 },
    "uri": "https://publicly-accessible-image-url.png",
    "objectSize": {
      "height": { "magnitude": 200, "unit": "PT" },
      "width":  { "magnitude": 300, "unit": "PT" }
    }
  }
}
```
The URL must be publicly accessible at call time. For local images, upload to Drive first and get a shareable link.

---

## Page width reference

| Paper | Margins | Page width | Body width (pt) |
|-------|---------|-----------|-----------------|
| US Letter (8.5") | 1" each side | 8.5" | **468 pt** |
| A4 (8.27") | 1" each side | 8.27" | **451 pt** |
| A4 (8.27") | 2.54 cm each | 8.27" | **453 pt** |
| US Letter | 0.75" each | 8.5" | **504 pt** |

Use `--page-width <pt>` when running `convert.js` for non-Letter documents.
