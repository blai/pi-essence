# pi-essence

> Three focused pi skill packages — install the ones you need.

| Package | Install | Contents |
|---------|---------|----------|
| [`ideation`](./packages/ideation) | `pi install npm:ideation` | `smith` + `coach` skills · `teller` extension |
| [`quality`](./packages/quality) | `pi install npm:quality` | `architect` + `poet` skills |
| [`presentation`](./packages/presentation) | `pi install npm:presentation` | `gws` + `md-gdoc` skills |

## Packages

### ideation

Skills for building pi plugins, plus a session cost extension:

- **`smith`** — create, scaffold, and debug pi extensions (TypeScript)
- **`coach`** — create, scaffold, and validate pi skills (SKILL.md)
- **`teller`** *(extension)* — real-time session cost tracking: exact token counts and cost broken down by type (input/output/cache), per-model, and per-tool. Commands: `/teller`, `/teller models`, `/teller tools`, `/teller messages`, `/teller budget <$N>`. Exposes a `teller_summary` LLM tool for agent self-reporting.

### quality

Skills for reviewing and improving documentation:

- **`architect`** — validate AI-consumable markdown: SKILL.md, system prompts, commands, RFC 2119 enforcement
- **`poet`** — improve human-facing prose: README, docs, changelogs, roadmaps

### presentation

Skills for Google Workspace output:

- **`gws`** — Drive, Gmail, Sheets, Calendar, Docs, Slides, Tasks, Chat, and more via the `gws` CLI
- **`md-gdoc`** — convert `.md` files to Google Docs (tables, mermaid diagrams, images)

## For contributors & AI agents

See [AGENTS.md](./AGENTS.md) — the authoritative guide for this project.
