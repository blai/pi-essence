---
name: marp-gslide
description: >
  Publish a Marp .md file to Google Slides. Use when asked to upload, publish,
  or export a Marp presentation to Google Slides or Google Drive. Detects
  LibreOffice automatically — produces editable slides if available, image-only
  slides otherwise. Requires gws CLI authenticated with drive scope.
  Does NOT create the Marp file — use marp for that first.
---

# Marp → Google Slides Publisher

## Workflow

### 1. Detect LibreOffice

```bash
which soffice
```

- **Found** → editable export (Step 2a)
- **Not found** → image-only export (Step 2b), warn the user

### 2a. Export editable PPTX

```bash
npx @marp-team/marp-cli --pptx --pptx-editable --allow-local-files <input.md> -o <name>.pptx
```

### 2b. Export image-only PPTX

```bash
npx @marp-team/marp-cli --pptx <input.md> -o <name>.pptx
```

> Image-only: each slide is a background photo — text is **not editable** in Google Slides.

### 3. Upload to Google Drive as Google Slides

The `--upload` path must be **inside the current working directory** (gws security constraint). Copy the file there first if needed.

```bash
gws drive files create \
  --upload <name>.pptx \
  --upload-content-type "application/vnd.openxmlformats-officedocument.presentationml.presentation" \
  --json '{"name": "<title>", "mimeType": "application/vnd.google-apps.presentation"}'
```

### 4. Return the URL

```
https://docs.google.com/presentation/d/<id>/edit
```

Tell the user whether the result is **editable** or **image-only**.

## Gotchas

- `--allow-local-files` is required when the `.md` references local images (`![bg](./image.jpg)`). Safe for local use; do not use in automated/CI contexts.
- `--pptx-editable` is experimental — styling fidelity (fonts, spacing, gradients) is lower than the image-only export. Known issue: **line spacing may be too tight**, causing text to run into adjacent lines.
- `gws --upload` rejects paths outside the current directory. Copy the `.pptx` into the project dir before uploading, then clean up.
- Editable export requires LibreOffice ≥ 7. Install: `brew install --cask libreoffice` (~400 MB).
