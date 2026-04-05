---
description: Optimize pi tools (skills/agents/prompts) via LLM A/B behavioral tests [autoresearch]
skill: autoresearch-create
thinking: high
---
Use /autoresearch to simplify the pi tools in: $@ (current dir if omitted)

## Metrics
- **Primary**: `quality_gap` (0–100, lower is better) — behavioral score difference between original and simplified agent on the same task.
- **Secondary**: `total_words`

## A/B Test Flow (per proposed change)
1. **Write a scenario file** (`autoresearch-tests/scenarios/<name>.md`): a self-contained task (no tools, no codebase access), 5–8 behavioral criteria scored 0–10, failure modes that hard-zero a criterion.
2. **Parallel dispatch**: two agents on the same task — `full` uses the original system prompt, `simplified` uses the shortened version.
3. **Judge**: dispatch `autoresearch-tests/judge.md` with scenario + both responses → returns gap + verdict.
4. **Threshold**: gap < 15 → `log_experiment(keep, metric=gap)`. Gap 15–24 → BORDERLINE, try a targeted fix. Gap ≥ 25 → revert.

## Judge Agent (`autoresearch-tests/judge.md`)
Create this file if it doesn't exist: score each criterion 0–10 per response, compute `gap = score_full − score_simplified`, return JSON with per-criterion scores, `gap`, and `verdict` (SIMPLIFY/BORDERLINE/KEEP). Same behavior in fewer words = full marks. Any failure mode hit = 0 on that criterion.

## Files in Scope
Scan `$@` (or `.`) for `skills/*/SKILL.md`, `agents/*.md`, `prompts/*.md`. Create a scenario for each file you simplify.

## Constraints
- Baseline commit before any changes.
- Reviewer/personality skill names must stay explicit — never "each skill" or similar.
- Do not modify test files, library code, or autoresearch artifacts.

## Finalization (ask user to confirm before running)
When the session is done or the user is satisfied:
1. Remove and commit artifact removal first: `rm -f autoresearch.md autoresearch.sh autoresearch.jsonl autoresearch.ideas.md && rm -rf autoresearch-tests/ && git add -A && git commit -m "chore: remove autoresearch artifacts"`
2. Squash all branch commits into one and merge back: `BASE=$(git merge-base HEAD main) && git reset --soft $BASE && git commit -m "<type>(<scope>): <what changed and why>"`, then `git checkout main && git merge --ff-only -` and delete the branch.
