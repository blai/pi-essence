# context

Two pi extensions for LLM context compression and Anthropic prompt caching. Zero LLM inference cost. No build step.

```bash
pi install ./packages/context   # local dev
pi install npm:context          # published
```

## Extensions

### `compress` — Context Compressor

Intercepts every tool result and the LLM context window to remove token waste through a two-pipeline architecture.

**Footer widget:** `🗜 ~1,234 tok saved (28%)`  
**Command:** `/compress-stats` — per-session breakdown (tiktoken-exact for immediate, ÷3.5 estimate for deferred)

#### Two-pipeline architecture

The split exists because some compressions are safe to persist (improve human readability) while others would be confusing in the UI and session files.

| Pipeline | Hook | Stages | Persisted to session? | Token tracking |
|----------|------|--------|-----------------------|---------------|
| **Immediate** | `tool_result` | ansi → whitespace | ✅ yes | tiktoken exact |
| **Deferred** | `context` (deep copy) | dedup → paths → toon | ❌ no (LLM only) | ÷3.5 estimate |

#### Immediate stages (tool_result — what you see in the TUI)

| Stage | What it removes | Why safe to persist |
|-------|----------------|---------------------|
| **ansi** | `\x1b[31m…\x1b[0m` escape codes | Noise in both UI and session files — stripping improves readability |
| **whitespace** | Trailing spaces, 3+ blank lines → 2 | Improves TUI output density |

Uses `node:util.stripVTControlCharacters` (Node 16.11+ built-in, zero deps).

#### Deferred stages (context hook — LLM only, originals in TUI)

| Stage | What it does | Why deferred only |
|-------|-------------|-------------------|
| **dedup** | `[4×] same line` markers | Markers confusing to read in TUI |
| **paths** | `$WS`/`$HOME` sigils + legend | Sigils confusing in TUI |
| **toon** | JSON → TOON format | Different syntax, unreadable without knowing TOON |

**TOON** (Token-Oriented Object Notation) collapses uniform JSON arrays into CSV-style tables:
```
# Before (JSON, 2680 chars)               # After (TOON, 858 chars, −68%)
[{"id":1,"name":"User 0","role":"admin"},  users[20]{id,name,role,active}:
 {"id":2,"name":"User 1","role":"user"},    1,User 0,admin,true
 ...]                                       2,User 1,user,true
                                            ...
```
Lossless round-trip. Only applied when TOON is ≥10% shorter.

#### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@toon-format/toon` | ^2.1.0 | JSON → TOON encoding |
| `js-tiktoken` | ^1.0.21 | Exact BPE token counting (cl100k_base) |

---

### `cache` — Anthropic Prompt Caching

Adds `cache_control: { type: "ephemeral" }` to every Anthropic API request, enabling [automatic caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#automatic-caching).

**How it works:** Anthropic places the cache breakpoint at the last cacheable block automatically and moves it forward as the conversation grows. On a cache hit, the cached prefix is charged at **10% of normal input token price**.

**Economics:** ~2-3 turn break-even. From turn 3+, system prompt + tool definitions + early conversation history are read from cache at 10x discount.

**Minimum prompt:** 1024–4096 tokens depending on model (Anthropic silently skips caching for shorter prompts — no error, no extra charge).

**Provider guard:** only adds `cache_control` when `payload.model` starts with `"claude-"`. OpenAI, Google, and other providers are passed through unchanged.

---

## Files

```
packages/context/
├── package.json
├── README.md
└── extensions/
    ├── compress/
    │   ├── index.ts          Extension entry: session_start / tool_result / context hooks + /compress-stats
    │   ├── pipeline.ts       runImmediatePipeline() + runDeferredPipeline()
    │   └── stages/
    │       ├── ansi.ts       node:util.stripVTControlCharacters wrapper
    │       ├── whitespace.ts Normalize blank lines and trailing spaces
    │       ├── dedup.ts      Consecutive duplicate line folding
    │       ├── paths.ts      Path → $WS/$HOME sigil compression
    │       ├── toon.ts       JSON → TOON encoding via @toon-format/toon
    │       └── tokens.ts     js-tiktoken wrapper + fast ÷3.5 estimator
    └── cache/
        └── index.ts          before_provider_request → add Anthropic cache_control
```

## Install (after adding the package)

```bash
# In the monorepo root — installs @toon-format/toon and js-tiktoken
npm install
```

## Ideas for future stages

- **Log timestamp folding**: group log lines by repeating prefix, show count + time range
- **Import block dedup**: for code file reads, deduplicate repeated import sections
- **Cross-message dedup**: if the same file is read twice, replace the second with a back-reference
- **1-hour cache TTL**: add `ttl: { type: "hours", amount: 1 }` to cache_control for long sessions
