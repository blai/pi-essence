---
name: coach
description: >
  Use this skill when asked to create, write, or improve a pi skill (SKILL.md);
  scaffold a new skill; review or debug an existing SKILL.md; or validate skill
  frontmatter, description, and body structure. Covers naming rules, description
  optimization, progressive disclosure, script bundling, validation loops, and
  pi-specific gotchas not in the generic Agent Skills spec.
  Does NOT cover extensions, themes, or prompt templates.
---

# Coach — Pi Skill Creation Guide

## Workflow: Creating a Skill (5 Steps)

### Step 1: Name it

Rules (enforced by pi — violations prevent loading):
- `web-search` style: lowercase, digits, hyphens only; no leading/trailing/double hyphens; max 64 chars
- **Must match the parent directory name** — `skills/web-search/SKILL.md` must have `name: web-search`

### Step 2: Write the description (most critical step)

The description is the **only** thing the agent sees before loading — if it's vague, the skill never triggers.

**Example:** `Use when asked to search the web or fetch URLs. Requires BRAVE_API_KEY. Does NOT handle JS-rendered pages.`

**Rules:**
- Max 1024 chars; missing description = skill silently not loaded
- Imperative phrasing: "Use this skill when…" not "This skill does…"
- Name specific trigger phrases; state what it does NOT cover
- No XML angle brackets `< >` (may be interpreted as prompt injection)

### Step 3: Structure the body

Keep `SKILL.md` under **500 lines**. Move heavy content to `references/`.

**Standard sections:** `## Setup` (one-time install/config; delete if not needed) · `## Workflow` (numbered steps; required) · `## Gotchas` (non-obvious facts, edge cases) · `## References` (load-on-demand links).

**Progressive disclosure** — each reference entry must say "load when [condition]". Keep *constraining* content inline (output schemas, limits, names of dispatched agents/tools, role boundaries); move *explanatory* content to references (rationale, worked examples). If you can caption a section "why" or "how", it belongs in references.

### Step 4: Bundle scripts for deterministic steps

Use `scripts/` for tasks the agent might hallucinate or do inconsistently.

**Bundle a script when:** logic repeats every run, output must be precise, or the step is fragile.

**Pattern:** `1. Run: node scripts/validate.js output/ | 2. If validation fails, fix and re-validate | 3. Only proceed when validation passes.` Scripts fail with helpful errors → agent self-corrects.

### Step 5: Validate

Run `node skills/coach/scripts/validate.js skills/my-skill/SKILL.md`. Test auto-triggering with 3+ prompts. Not triggering? See `references/description-guide.md`.

---

## Gotchas — Writing Effective Skills

- **Name every dependency explicitly.** Never dispatch by category ("the appropriate agent", "each review skill") — name every dispatched agent, skill, and tool by its exact identifier. Category language in multi-package installs causes wrong tools and non-deterministic results.

- **Name the constraint, not the procedure.** Write what the output must satisfy (limits, schemas, required fields, conditions), not how to produce it. If a step describes what the LLM would do unprompted, cut it.

- **Compact schema notation for flat output shapes.** `[{field_a, field_b, field_c}]` teaches the same field names as a multi-line example. Reserve full examples for non-obvious structures (deep nesting, conditional fields).

- **Test your detail sections before you ship.** If the LLM behaves identically without a section, cut it. More detail does not reliably mean better results.

## Gotchas — Pi-Specific Behavior

These differ from the generic Agent Skills spec:

- **Description issues cause silent failures.** Missing or overlength (≥1024 char) descriptions are silently skipped. Always validate with the script.
- **Name/directory mismatch** — `skills/my-skill/SKILL.md` must have `name: my-skill` exactly or pi warns and may skip it.
- **`/skill:name` forces load.** Use this to test a skill manually without relying on auto-detection.
- **`disable-model-invocation: true`** hides the skill from auto-detection (power-user mode — requires explicit `/skill:name`).
- **`allowed-tools` is experimental** — not enforced; don't rely on it for security.
- **`/reload` applies changes** to SKILL.md and scripts without restarting pi.
- **Skills won't load if `read` is disabled** — overriding it or using `--no-tools` mode silently breaks skill loading.

## References

- `references/description-guide.md` — description formula, testing, optimization loop
- `references/quality-checklist.md` — pre-ship checklist
- `templates/skill.md` — starter template; copy to `skills/<name>/SKILL.md` when scaffolding a new skill
