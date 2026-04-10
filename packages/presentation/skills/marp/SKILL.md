---
name: marp
description: >
  Create and improve Marp presentation slides. Use when asked to make slides,
  build a presentation, or improve an existing .md slideshow.
  Does NOT cover Google Slides, PowerPoint, or Keynote — use md-gdoc for
  Google Docs export.
---

# Marp Slide Creator

## Workflow

### 1. Pick a theme

| Theme | Template | Best for |
|-------|----------|----------|
| `default` | `assets/template-basic.md` | General / unsure |
| `minimal` | `assets/template-minimal.md` | Academic, content-heavy |
| `colorful` | `assets/template-colorful.md` | Creative, youth events |
| `dark` | `assets/template-dark.md` | Tech talks, evening events |
| `gradient` | `assets/template-gradient.md` | Visual-forward, creative |
| `tech` | `assets/template-tech.md` | Dev tutorials, code demos |
| `business` | `assets/template-business.md` | Corporate, proposals |

Infer: technical → `tech`/`dark`; business → `business`; creative → `colorful`/`gradient`; else → `default`.

### 2. Copy the template

Read the chosen template file. Preserve the embedded CSS intact — edit only content below `</style>`.

### 3. Structure the slides

```markdown
<!-- _class: lead -->

# Presentation Title
Presenter · Date

---

## Slide Title

- Point one
- Point two
- Point three

---
```

**Rules:** title → `<!-- _class: lead -->` + h1; content → h2 + 3–5 bullets; **1 slide = 1 message**.

### 4. Add images

```markdown
![bg right:40%](image.png)    # right half, text left
![bg](image.png)              # full background
![w:600px](image.png)         # inline fixed width
![bg brightness:0.5](bg.png)  # darkened background
```

### 5. Save and export

Save as `<name>.md`. Export:
```bash
npx @marp-team/marp-cli slides.md       # → HTML
npx @marp-team/marp-cli --pdf slides.md # → PDF
```

Run `marp-quality` to score and fix issues.

## Gotchas

- `---` front matter vs. separator: first `---...---` = front matter; every bare `---` after = new slide.
- `<!-- directive: value -->` without `_` → **all following slides**; with `_` (e.g. `<!-- _class: lead -->`) → current slide only.
- `![bg]` = behind text; `![]` = inline, pushes content down.

## References

- `references/marp-syntax.md` — directives, pagination, math, emoji; for advanced front matter
- `references/image-patterns.md` — filters, splits, vertical layouts; when placing images
- `references/theme-css-guide.md` — `@theme` metadata, custom CSS; when creating a new theme
- `references/best-practices.md` — slide count, text density, whitespace; when polishing
