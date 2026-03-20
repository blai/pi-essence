---
name: poet
description: >
  Review or improve human-facing prose: README, docs/*, changelogs, roadmaps,
  stories, plans, blog posts. Not for SKILL.md, commands, system prompts, or
  prompt templates — use `architect`.
---

## Output

List violations (quoted phrase → principle → fix). Then give the full revised document. Fix style only.
Vague → `[specific details]`.

### 1. Active Voice

Use active voice. Rewrite:
- "X was/is [verb]ed by Y" → "Y [verb]s X"
- "X will be updated" → "Update X"

### 2. Omit Needless Words

- in order to → to
- due to the fact that → because
- at this point in time → now
- in the event that → if
- it is important to note that → (delete)

### 3. Specific and Direct

**Avoid quantifiers:** many, few, some, several, soon, later, eventually, various, numerous

**Avoid hedging:** seems, appears, perhaps, might, could, I think, we believe

**Avoid passive instructions:** "X should be [verb]ed" → "[Verb] X"

### 4. One Idea Per Sentence

Split at `and`/`but`/`or` between independent clauses. Max 20 words.

## Gotchas

- **Scope** — SKILL.md, commands, system prompts, prompt templates → use `architect`.
- **No violations:** Output "No violations found." — never fabricate.
- **Large files (>500 lines):** Process in sections; note which section.
- **Light hedging:** Flag only when it obscures a direct claim.

## Example

**Input:**
> "In order to complete setup, the config file should be edited by the user.
> It is important to note that many settings might need updating, which will
> take some time."

**Violations:**
- `"In order to"` → needless words: "To"
- `"should be edited by the user"` → passive: "Edit the config file"
- `"It is important to note that"` → needless words: delete
- `"many settings"` → vague: "all relevant settings"
- `"might need"` → hedging: "need"
- `"some time"` → vague: `[estimated duration]`

**Revised:**
> "To complete setup, edit the config file. All relevant settings need
> updating — allow `[estimated duration]`."
