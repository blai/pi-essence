---
description: Optimize pi tools (skills/agents/prompts) via LLM A/B behavioral tests [autoresearch]
skill: autoresearch-create
thinking: high
---
Use /autoresearch to simplify the pi tools in: $@ (current dir if omitted)

## Metrics
- **Primary**: `quality_gap` (0–100, lower is better) — avg score delta between full and simplified agents.
- **Secondary**: `total_words`

## Simplification Techniques (try in this order — highest ROI first)
1. **Replace code/bash blocks with prose** — examples are high-token and usually quality-neutral.
2. **Collapse redundant bullets** into one statement.
3. **Remove implied/restated constraints** — if the LLM would do it unprompted, cut it.
4. **Trim preamble** already covered by frontmatter.

## A/B Test Flow (per proposed change)
1. **Write a scenario file** (`autoresearch-tests/scenarios/<name>.md`): a concrete task, 5–8 behavioral criteria scored 0–10, failure modes that hard-zero a criterion.
2. **Parallel dispatch**: two agents on the same task — `full` with original prompt, `simplified` with current.
3. **Judge**: dispatch `autoresearch-tests/judge.md` with scenario + both responses → returns gap + verdict.
4. **Threshold**: gap < 15 → `log_experiment(keep, metric=gap)`. Gap 15–24 → BORDERLINE, try a targeted fix. Gap ≥ 25 → revert.
5. **Stopping condition**: 3 consecutive KEEPs → accept current version and proceed to finalization.

## Judge Agent
`autoresearch-tests/judge.md` — scores each criterion 0–10 per response, returns JSON with scores, `gap`, and `verdict` (SIMPLIFY/BORDERLINE/KEEP). Same behavior in fewer words = full marks. Any failure mode hit = 0 on that criterion.

## Files in Scope
Scan `$@` (or `.`) for `skills/*/SKILL.md`, `agents/*.md`, `prompts/*.md`. Create a scenario for each file you simplify.

## Constraints
- Reviewer/personality skill names must stay explicit — never "each skill" or similar.
- Do not modify test files, library code, or autoresearch artifacts.

## Finalization (confirm with user first)
1. `rm -f autoresearch.{md,sh,jsonl,ideas.md} && rm -rf autoresearch-tests/ && git add -A && git commit -m "chore: remove autoresearch artifacts"`
2. Squash all branch commits into one and merge back: `BASE=$(git merge-base HEAD main) && git reset --soft $BASE && git commit -m "<type>(<scope>): <what changed and why>"`, then `git checkout main && git merge --ff-only -` and delete the branch.
