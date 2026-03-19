---
name: architect
description: >
  Structure and language validation for AI-consumable markdown. Use this skill
  to validate a SKILL.md, audit AI documentation, lint a command, enforce
  RFC 2119, review a system prompt, check prompt quality, or improve AI
  instructions. Applies to SKILL.md, commands, agents, hooks, system prompts,
  and other AI-consumable markdown. Not for README, docs/*, roadmaps,
  changelogs — use poet.
version: 1.0.0
---

# Architect

## Output

Return violations `{type,line,issue,fix,severity}`, errors first. Then output the full revised document.

## Violation Types

- `error`: `missing_metadata`, `invalid_requirement_keyword`
- `warning`: `unnecessary_metadata`, `duplicate_concept`, `passive_voice`, `non_imperative_mood`, `ambiguous_pronoun`, `insufficient_examples`
- `info`: `vague_quantifier`, `vague_temporal_indicator`, `conversational_softener`, `patronizing_word`

## Steps

### Step 1: Confirm Scope

Redirect human-facing files (README, changelog, roadmap, docs/*) to `poet`.

### Step 2: Exclusion Map

Exclude from Steps 3–5: fenced (` ``` `), indented (4+), inline code, `## Examples` (until `##`).

### Step 3: Frontmatter

Required: `name`, `description` — add `missing_metadata` (error) if absent. `description` MUST contain one of `when/before/after/during/PROACTIVELY/Apply/Enforce/Retrieve/Transform`; if missing: `missing_metadata` — "description must include a trigger condition".

Flag `unnecessary_metadata` (warning) for git-tracked fields: `author/created_date/modified_date/timezone/type/target_audience/scope/enforcement/trigger/phase/cacheable`.

### Step 4: Duplicates

Scan non-excluded content for repeated concepts (similarity ≥ 0.7, length ≥ 30 chars); add `duplicate_concept` per pair.

### Step 5: Language

Skip excluded ranges (Step 2).

- RFC 2119 (`invalid_requirement_keyword`): should/could/would/may/might/can — requirement statements, not rationale
- Ambiguous pronouns (`ambiguous_pronoun`): it/this/that — when referent unclear
- Vague quantifiers (`vague_quantifier`): many/few/some/several
- Vague temporal (`vague_temporal_indicator`): soon/later/eventually/promptly
- Conversational (`conversational_softener`): "Can you", "I need", probably
- Patronizing (`patronizing_word`): easy/simply/just/obviously/clearly
- Passive voice (`passive_voice`, `non_imperative_mood`): "should be", "will be"

### Step 6: Examples

- Algorithm, branching → Complex skill: 2–3 examples
- Algorithm, linear → Simple skill: 1–2 examples
- `invoke(...)` calls → Composite: 1 workflow example
- `## Usage` slash-command → Command: 1–2 examples
- No algorithm → Reference/Spec: inline examples
- CLAUDE.md/standards → Standards: optional

## Gotchas

- **Requirement vs. rationale:** `because` = rationale (no flag); no rationale clause + lowercase modal → flag.
- **FP:** `they/them` ≠ `ambiguous_pronoun`; specific `MUST NOT` ≠ `invalid_requirement_keyword` (only flag vague: "MUST NOT fail").
- **Human docs:** Use `poet` — rule sets conflict.

## Appendix

### Req/Rationale

**Requirement**: prescribes behavior — use RFC 2119 uppercase: `The system MUST validate tokens.`

**Rationale**: explains why — lowercase modals correct: `This validates tokens because services rely on them.`

**Test:** Removing it — does system behavior change? Yes → requirement (flag); no → rationale.

### Atomic Requirements

**Wrong:** `MUST validate input and log errors.`

**Correct:** One MUST per behavior: `The system MUST validate input.`

### Structure Rules

Never "as mentioned above" — repeat the term or cross-reference. Number steps with action verbs; ≤7 steps. Declare dependencies in frontmatter.

### Output Spec

Schema for docs that specify structured output:

```
Return JSON: {"valid": bool, "violations": [{type,rule,line,suggestion,severity}], "reason": str|null}
```

### Common Errors

- **No outcome** — `An XML file MUST be well-formed.` → `Parser MUST reject malformed XML; return ERR_MALFORMED_XML.`
- **No actor** — `An invalid XML file must be ignored.` → `Parser MUST reject invalid XML with error code 400.`
- **Undefined verb** — `The system MUST reject malformed XML.` → `Stop processing; return ERR_MALFORMED_XML; display error message.`

## Examples

### Example 1

**Input:** `The system should probably check tokens. It might return errors soon.`

**Violations:**
- `"should"`, `"might"` → `invalid_requirement_keyword` (error): use `SHOULD`, `MAY`
- `"probably"` → `conversational_softener` (info): remove
- `"It"` → `ambiguous_pronoun` (warning): "The system"
- `"soon"` → `vague_temporal_indicator` (info): "within 2 seconds"

**Revised:** `The system SHOULD validate tokens; MAY return errors within 2 seconds.`

### Example 2

**Input:** `This step validates tokens because downstream services rely on them.`

**Output:** No violations — `"may"` is rationale prose.
