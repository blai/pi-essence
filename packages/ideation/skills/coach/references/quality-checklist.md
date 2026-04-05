# Skill Quality Checklist

### Spec compliance — run `node skills/coach/scripts/validate.js skills/<name>/SKILL.md` first

- [ ] `name`: lowercase/hyphens only, no leading/trailing/double hyphens, ≤64 chars, matches directory
- [ ] `description` present and ≤1024 chars
- [ ] File is named `SKILL.md` (case-sensitive)

### Description quality

- [ ] Uses imperative trigger phrasing ("Use this skill when…" or "Use when asked to…")
- [ ] Names at least 3 specific trigger phrases or task types
- [ ] States what the skill does NOT handle (boundary conditions)
- [ ] Mentions required tools, APIs, or environment variables
- [ ] Distinguishes this skill from adjacent skills; no XML angle brackets `< >`

### Body structure

- [ ] Has `## Workflow` or `## Usage` section with numbered steps
- [ ] Has `## Gotchas` section with at least 2 concrete, non-obvious facts
- [ ] Has `## Setup` section if any one-time configuration is needed
- [ ] Body is under 500 lines (or heavy content moved to `references/`)
- [ ] References are loaded on-demand ("load this file when X") not preloaded
- [ ] No unfilled placeholders (TODO, FIXME, `<YOUR...>`, "placeholder")
- [ ] Every dispatched agent, skill, or tool is named by its exact identifier — no categorical references ("each X skill", "the appropriate tool")
- [ ] At least one major detail section has been tested: does removing it change LLM behavior on a realistic task? Untested detail is a liability.

### Scripts (if bundled)

- [ ] In `scripts/`; return helpful errors (not bare exit codes); tested with real input
- [ ] `SKILL.md` uses a validation loop: run → check errors → fix → re-run

### Final test

- [ ] Skill visible in pi's system prompt; `/skill:name` force-loads correctly
- [ ] Auto-trigger works for 3+ realistic prompts


