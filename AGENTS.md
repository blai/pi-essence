# AGENTS.md — pi-essence

> **For AI agents:** This file is your primary reference for working on pi-essence. Read it fully before making changes. Each section is actionable — skip nothing.

---

## Project Overview

**pi-essence** is a single installable pi package bundling curated **skills** for the [pi coding agent](https://buildwithpi.ai).

```bash
pi install npm:pi-essence   # install everything
```

---

## Repository Structure

```
pi-essence/
├── AGENTS.md              ← you are here
├── package.json           ← single pi package manifest
├── README.md
│
└── skills/                ← SKILL.md capability packages
    ├── coach/             ← guided pi skill creation
    │   ├── SKILL.md
    │   ├── scripts/
    │   ├── references/
    │   └── templates/
    ├── poet/              ← human-readable prose quality
    │   └── SKILL.md
    └── architect/         ← AI-consumable doc quality
        ├── SKILL.md
        └── references/
```

---

## Plugin Catalog

### Skills

| Directory | Description | Status |
|-----------|-------------|--------|
| `skills/coach/` | Guided pi skill creation: frontmatter rules, description optimization, validator, templates | ✅ Built |
| `skills/poet/` | Human prose quality: active voice, concision, specificity for README, docs, roadmaps, changelogs | ✅ Built |
| `skills/architect/` | AI-consumable doc quality: RFC 2119, metadata, language rules for SKILL.md, commands, system prompts | ✅ Built |
| `skills/gws/` | Google Workspace CLI (`gws`): Drive, Gmail, Sheets, Calendar, Docs, Tasks, Chat, and more | ✅ Built |
| `skills/md-to-gdoc/` | Convert `.md` files to Google Docs via pandoc + Drive API; handles mermaid diagrams, tables with auto-sized columns | ✅ Built |
| `skills/web-search/` | Search the web and extract page content | 🔜 Planned |
| `skills/code-review/` | Structured code review workflow | 🔜 Planned |
| `skills/git-workflow/` | Conventional commits, PR descriptions, changelogs | 🔜 Planned |

### Extensions

| Directory | Description | Status |
|-----------|-------------|--------|
| `extensions/guardrails/` | Block destructive bash commands; protect `.env`/secret files | 🔜 Planned |
| `extensions/memory/` | Persist named facts across sessions | 🔜 Planned |

---

## Agent Tooling (auto-loaded for this project)

`.pi/settings.json` points pi at the repo root for local development — identical to what `pi install npm:pi-essence` gives end users.

### Use `coach` when creating any new skill

```
Ask: "Create a new skill for [task]"
/skill:coach       ← force-load the full creation guide
```

**Always use coach when adding a new skill to this repo.**

---

## Adding a New Plugin

### New Skill

1. Create `skills/<name>/SKILL.md`
2. Add any scripts to `skills/<name>/scripts/` and references to `skills/<name>/references/`
3. Validate: `node skills/coach/scripts/validate.js skills/<name>/SKILL.md`
4. Add a row to the Skills table in the [Plugin Catalog](#plugin-catalog) above

### New Extension

1. Create `extensions/<name>/index.ts`
2. Create `extensions/<name>/README.md`
3. Add a row to the Extensions table in the [Plugin Catalog](#plugin-catalog) above
4. Test: `pi -e ./extensions/<name>/index.ts`

---

## Writing an Extension

Extensions live in `extensions/` and export a default function:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai"; // required for enum params

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => { /* intercept */ });
  pi.registerTool({ name: "my_tool", ... });
  pi.registerCommand("my-cmd", { handler: async (args, ctx) => {} });
}
```

**Key rules:**
- Use `StringEnum` from `@mariozechner/pi-ai` for enum params — never `Type.Union`/`Type.Literal` (breaks Google models)
- Store state in tool result `details` and reconstruct from `session_start`
- Truncate tool output: max 50KB / 2000 lines using `truncateHead`/`truncateTail`
- Signal tool errors by throwing — never return `isError: true`
- Test: `pi -e ./extensions/<name>/index.ts`

Read `skills/coach/references/extension-patterns.md` for complete patterns.

## Writing a Skill

Skills live in `skills/<name>/` with a `SKILL.md`:

```yaml
---
name: my-skill       # must match directory name, lowercase + hyphens only
description: >       # max 1024 chars — use "Use this skill when..." phrasing
  Use this skill when the user asks to ...
---
```

**Key rules:**
- `name` must match the parent directory name exactly (pi enforces this)
- Missing `description` = skill silently not loaded
- Keep `SKILL.md` under 500 lines; move heavy content to `references/`
- Validate: `node skills/coach/scripts/validate.js skills/<name>/SKILL.md`

Read `skills/coach/SKILL.md` for the full 5-step creation process.

---

## Safety & Coding Conventions

**ALWAYS:**
- Confirm before destructive actions (`rm`, force-push, overwriting important files)
- Truncate tool output to ≤50KB / 2000 lines
- Handle `signal.aborted` in long-running `execute()` functions

**NEVER:**
- Read or log `.env`, `*.pem`, `*.key`, `*secret*` files
- Use `Type.Union`/`Type.Literal` for enum params (use `StringEnum`)
- Modify `node_modules/` or `.git/` without explicit user confirmation

**Language:** TypeScript (no build step — loaded by jiti)
**Exports:** `export default function (pi: ExtensionAPI) { ... }`
**Errors:** `throw new Error(...)` — never `return { isError: true }`

---

## References

- [pi extensions docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [pi skills docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [pi packages docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [Agent Skills standard](https://agentskills.io/specification)
