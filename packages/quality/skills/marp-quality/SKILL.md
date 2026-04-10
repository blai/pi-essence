---
name: marp-quality
description: >
  Analyze and improve existing Marp presentation slides using SlideGauge. Use
  when asked to check, score, validate, audit, or improve a .md deck with
  marp frontmatter. Requires uvx (installed with uv). Does NOT create new
  slides — use presenter for that.
---

# Slide Critic — Marp Quality Analyzer

Iterative score → fix → re-score loop using [SlideGauge](https://github.com/nibzard/slidegauge).

## Workflow

### 1. Baseline score

```bash
uvx --from git+https://github.com/nibzard/slidegauge slidegauge <file.md> --text
```

Show the user: overall score, pass rate, issue count, and category breakdown (`a11y`, `code`, `color`, `content`, `layout`).

### 2. Drill into failures

For any slide scoring < 80:

```bash
uvx --from git+https://github.com/nibzard/slidegauge slidegauge <file.md> --json \
  | jq '.slides[] | select(.score < 80)'
```

Load `references/rules.md` to map rule IDs → deductions → fixes.

### 3. Fix — prioritize by score

| Score | Action |
|-------|--------|
| < 70 | Fix immediately |
| 70–79 | Recommend fix |
| ≥ 80 | Leave unless user requests |

Load `references/fixes.md` for patterns (split vs. consolidate, code trimming, alt text, title shortening).

Fix rules:
- Get user approval before splitting slides or removing content
- Preserve technical accuracy — trim phrasing, not meaning
- Fix one slide at a time; re-run to confirm no regressions

### 4. Validate

```bash
uvx --from git+https://github.com/nibzard/slidegauge slidegauge <file.md> --text
```

Show before/after scores. Repeat Steps 2–4 until all slides ≥ 70 or user is satisfied.

## Thresholds

- **70** — minimum pass (MUST fix below this)
- **80** — good quality (recommend fixing)
- **90+** — excellent
- **100** — perfect

## Gotchas

- `uvx` fetches SlideGauge on first run — expect a few seconds of install time; no manual setup needed.
- SlideGauge scores the rendered content, not the raw markdown. Marp directives (`<!-- _class: lead -->`) and CSS blocks are excluded from content scoring.
- `content/too_short` (-5) on a title-only slide is usually intentional — confirm with user before adding filler text.
- Always re-run after fixes; a split can introduce a new `title/required` error on the second slide.

## References

- `references/rules.md` — full rule catalog with severities, deductions, thresholds; load to diagnose unfamiliar rule IDs
- `references/fixes.md` — fix patterns for every rule: split vs. consolidate, code trimming, decision tree; load before editing
- `references/examples.md` — worked before/after examples; load when the fix strategy is unclear
