/**
 * Anthropic Prompt Caching — pi extension
 *
 * Adds `cache_control: { type: "ephemeral" }` at the top level of every
 * Anthropic API request, enabling *automatic caching*. The Anthropic API then
 * places the cache breakpoint at the last cacheable block and moves it forward
 * automatically as the conversation grows.
 *
 * Effect: on cache HIT, the cached prefix is charged at 10% of the normal
 * input token price. Cache WRITES cost 25% more than normal. Typical multi-
 * turn sessions break even after 2–3 turns and save ~85% on stable content
 * (system prompt + tool definitions + early conversation history) from turn 3+.
 *
 * Minimum cacheable prompt: 1024–4096 tokens depending on model (Anthropic
 * silently skips caching for shorter prompts — no error, no extra charge).
 *
 * Provider detection: only applies when `payload.model` starts with "claude-".
 * All other providers (OpenAI, Google, etc.) are passed through unchanged.
 *
 * References:
 *   https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *   Automatic caching section — "add a single cache_control field at the
 *   top level of your request body"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		const payload = event.payload as Record<string, unknown>;

		// Only Anthropic (Claude) supports this cache_control field
		const model = payload["model"];
		if (typeof model !== "string" || !model.startsWith("claude-")) return undefined;

		// Skip if already has a top-level cache_control (explicit or from previous handler)
		if (payload["cache_control"] != null) return undefined;

		if (ctx.hasUI) {
			// Uncomment to debug cache hits in the footer:
			// ctx.ui.setStatus("ctx-cache", "🔑 cache_control: ephemeral");
		}

		return { ...payload, cache_control: { type: "ephemeral" } };
	});
}
