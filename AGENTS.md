# AGENTS.md — pi-essence

**pi-essence** is a pi skill monorepo ([pi coding agent](https://buildwithpi.ai)). `.pi/settings.json` loads all packages from `packages/` for local dev. New skill → `/skill:coach`. New extension → `/skill:smith`.

```bash
pi install npm:ideation
pi install npm:quality
pi install npm:presentation
```

## Extensions

| Package | Extension | Description |
|---------|-----------|-------------|
| ideation | `teller` | Session cost intelligence: exact token counts + cost by type, per-model breakdown, per-tool attribution. `/teller`, `/teller models`, `/teller tools`, `/teller messages`, `/teller budget <$N>`. |

## Skills

| Package | Skill | Description |
|---------|-------|-------------|
| ideation | `smith` | Extension creation: tool registration, event interception, state, UI, truncation, testing |
| ideation | `coach` | Skill creation: frontmatter rules, description optimization, validator, templates |
| quality | `architect` | AI-consumable doc quality: RFC 2119, metadata, language rules for SKILL.md, commands, system prompts |
| quality | `poet` | Human prose quality: active voice, concision, specificity for README, docs, roadmaps, changelogs |
| presentation | `gws` | Google Workspace CLI (`gws`): Drive, Gmail, Sheets, Calendar, Docs, Tasks, Chat |
| presentation | `md-gdoc` | Convert `.md` to Google Docs via pandoc + Drive API; handles mermaid diagrams, tables with auto-sized columns |

## Adding a New Skill

1. Create `packages/<package>/skills/<name>/SKILL.md`
2. Validate: `node packages/ideation/skills/coach/scripts/validate.js packages/<package>/skills/<name>/SKILL.md`
3. Add a row to the Skills table above

## Safety & Conventions

**ALWAYS:** confirm `rm`/force-push/overwrites; truncate output ≤50KB/2000 lines; handle `signal.aborted` in long `execute()`.

**NEVER:** read/log `.env`/`*.pem`/`*.key`/`*secret*`; modify `node_modules/`/`.git/` without confirmation.

**Language:** TypeScript, no build step (loaded by jiti).

## References

- [pi extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [pi skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [pi packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [Agent Skills spec](https://agentskills.io/specification)
