---
name: your-skill-name
description: >
  [REQUIRED — 40–400 chars recommended, max 1024]
  Use this skill when the user asks to [list specific tasks and trigger phrases].
  Handles [what it does]. Requires [any API keys, tools, env vars].
  Does NOT handle [boundary — what it doesn't do].
---

# Your Skill Name

## Setup

[Delete this section if no one-time setup is needed]

```bash
npm install   # run once from the skill directory
```

## Workflow

[Keep steps concrete and numbered. The agent follows these in order.]

### Step 1: Gather context

```bash
ls -la
cat package.json 2>/dev/null || echo "No package.json"
```

### Step 2: [Main action]

[Instructions for the agent. Be prescriptive for fragile steps.
For flexible steps, explain *why* rather than dictating *how*.]

### Step 3: Validate

```bash
node scripts/validate.js output/
# Fix errors and re-run. Only proceed when validation passes.
```

## Gotchas

[High-value section — list concrete, non-obvious facts the agent would get wrong]

- [Specific edge case or project quirk, e.g. "The users table uses soft deletes — always include WHERE deleted_at IS NULL"]
- [Common mistake, e.g. "user_id in the DB is uid in the auth service — they're the same value"]
- [Environment quirk, e.g. "/health returns 200 even if DB is down — use /ready for full health check"]

## References

[List reference files — load them only when needed, not upfront]

- `references/api-reference.md` — full API docs; load when hitting API errors or edge cases
