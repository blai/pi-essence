# Description Optimization Guide

Load this file when: the skill isn't triggering as expected, or when writing a new description and wanting to do it right the first time.

## Formula

```
[imperative trigger] + [specific tasks] + [tools/APIs] + [boundary conditions]
```

| Component | ✅ Good | ❌ Bad |
|-----------|---------|--------|
| Trigger | `Use this skill when the user asks to...` | `This skill analyzes...` (passive, won't trigger) |
| Tasks | `extract text from PDF, fill forms, merge PDFs` | `work with PDF files` (too vague) |
| APIs/deps | `via Brave API. Requires BRAVE_API_KEY.` | *(omit — agent can't filter applicability)* |
| Boundaries | `Does NOT handle JS-rendered pages (use browser-tools).` | *(omit — causes false triggers)* |

## Length calibration

150–800 chars is the sweet spot for most skills. Under 150 is usually too thin. **Over 1024 is a hard limit** — pi rejects the skill.

## Testing if your description works

Ask 3–5 prompts, verify auto-trigger. Force-load: `/skill:your-skill-name`.

**Optimization loop:** failed trigger = too narrow (add phrases); false trigger = too broad (add boundary). Fix the *category*, not the specific query. Stay ≤1024 chars.

## Most common mistake

Describe *when* to use it, not *what it is*. Lead with `Use when asked to…` not `This skill does…`.
