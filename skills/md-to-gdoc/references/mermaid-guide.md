# Mermaid Diagram Handling

Load this file when:
- Mermaid diagrams fail to render during conversion
- The user wants to render mermaid diagrams separately before running `convert.js`
- mermaid.ink is unreachable and an alternative renderer is needed

---

## How mermaid.ink rendering works

`convert.js` uses [mermaid.ink](https://mermaid.ink) — a free public rendering service.

**URL format:**
```
https://mermaid.ink/img/<base64url_encoded_source>?type=png
```
Where `base64url_encoded_source` = `Buffer.from(mermaidCode).toString('base64url')` in Node.js.

**Fallback URL (JSON envelope):**
```
https://mermaid.ink/img/<base64url_encoded_json>?type=png
```
Where the JSON is `{"code":"...","mermaid":{"theme":"default"}}`.

The script tries both. If both fail (no internet, service down, diagram syntax error), the block is kept as a plain code block with a warning.

---

## Diagnosing render failures

### 1. Check internet access
```bash
curl -sI https://mermaid.ink/img/eyJjb2RlIjoiZ3JhcGggVEQ7QS0tPkIiLCJtZXJtYWlkIjp7InRoZW1lIjoiZGVmYXVsdCJ9fQ==?type=png | head -5
# Expect: HTTP/2 200
```

### 2. Validate diagram syntax
Paste the mermaid code at https://mermaid.live — invalid syntax causes mermaid.ink to return an error image (small file, <200 bytes), which the script detects and treats as a failure.

### 3. Test the URL manually
```bash
# Encode your mermaid code and test
node -e "
const code = \`graph TD; A-->B; B-->C\`;
const enc = Buffer.from(code).toString('base64url');
console.log('https://mermaid.ink/img/' + enc + '?type=png');
"
# Copy the URL and open in a browser — should show a PNG
```

---

## Manual pre-rendering (before running convert.js)

If mermaid.ink is unreliable, pre-render diagrams locally using Mermaid CLI:

```bash
# Install Mermaid CLI
npm install -g @mermaid-js/mermaid-cli

# Render a single diagram
echo "graph TD; A-->B" | mmdc -i /dev/stdin -o diagram.png

# Or from a file
mmdc -i diagram.mmd -o diagram.png -t default
```

Then replace the mermaid fence in your `.md` file:
```markdown
<!-- Before -->
```mermaid
graph TD; A-->B
```

<!-- After -->
![System diagram](./diagram.png)
```

Now run `convert.js` — it will embed the pre-rendered PNG via pandoc.

---

## Supported mermaid diagram types

All diagram types supported by mermaid.ink (Mermaid.js v10+):

| Type | Syntax start | Notes |
|------|-------------|-------|
| Flowchart | `graph TD` / `flowchart LR` | Most reliable |
| Sequence | `sequenceDiagram` | ✓ |
| Class | `classDiagram` | ✓ |
| State | `stateDiagram-v2` | ✓ |
| ER diagram | `erDiagram` | ✓ |
| Gantt | `gantt` | ✓ |
| Pie chart | `pie` | ✓ |
| Git graph | `gitGraph` | ✓ |
| Mindmap | `mindmap` | Mermaid v9.3+ |
| Timeline | `timeline` | Mermaid v9.4+ |

---

## Diagram sizing in Google Docs

mermaid.ink returns a PNG at a default resolution. After conversion, the image appears inline in the Google Doc at its natural size. To resize:

1. Open the Google Doc
2. Click the image
3. Drag the corner handles, or use Format → Image options → Size to set exact dimensions

To control the rendered size at conversion time, you can append `&width=800` to the mermaid.ink URL (not yet parameterized in convert.js — edit `renderMermaid()` in `scripts/convert.js` to add width/height query params).

---

## Alternative: Mermaid for Google Docs add-on

For interactive diagrams that remain editable after upload:

1. Install [Mermaid for Google Docs](https://workspace.google.com/marketplace/app/mermaid_for_google_docs/947683068472) from the Google Workspace Marketplace
2. Open the converted Google Doc
3. Use Extensions → Mermaid for Google Docs → Insert/Update diagram
4. Paste the mermaid code — the add-on renders it natively within Docs

This approach is better for documents where the diagrams need to be updated later.
