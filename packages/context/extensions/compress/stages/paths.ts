/**
 * Path compression stage.
 *
 * Replaces long repeated filesystem paths with short sigils, then prepends a
 * one-line legend so the LLM can decode them. Only fires for a given path if
 * it appears at least MIN_OCCURRENCES times in the text — ensuring the legend
 * overhead is always outweighed by the savings.
 *
 * Sigils used:
 *   $WS   — current working directory (workspace root)
 *   $HOME — user home directory
 *
 * Why lossless: the legend is always included in the same message, so the LLM
 * can always recover the original path. The replacements are deterministic and
 * bijective (no two paths map to the same sigil).
 *
 * Min-occurrence thresholds:
 *   - Path ≥ 40 chars: 2 occurrences (legend overhead ≈8 tokens, savings ≥10 tokens each)
 *   - Path  < 40 chars: 3 occurrences (savings smaller, need more repetitions to break even)
 *
 * Performance: callers should pre-compile entries via `compilePathEntries` and
 * pass them as the `compiled` argument to avoid `new RegExp(...)` per call.
 */

export interface PathEntry {
	path: string; // Filesystem path to compress (absolute)
	sigil: string; // Short replacement token, e.g. "$WS"
}

export interface CompiledPathEntry extends PathEntry {
	re: RegExp;
	minOccurrences: number;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pre-compile path entries for repeated use. Call once per session and cache
 * the result in PipelineConfig.compiledPaths.
 */
export function compilePathEntries(entries: PathEntry[]): CompiledPathEntry[] {
	return [...entries]
		.sort((a, b) => b.path.length - a.path.length) // longest first
		.filter((e) => e.path && e.path.length >= 8)
		.map((e) => ({
			...e,
			re: new RegExp(escapeRegex(e.path), "g"),
			minOccurrences: e.path.length >= 40 ? 2 : 3,
		}));
}

/**
 * Compress paths using pre-compiled entries.
 * Pass `compiled` from `compilePathEntries` to avoid per-call RegExp construction.
 * Falls back to on-the-fly compilation when `compiled` is not provided.
 */
export function compressPaths(text: string, entries: PathEntry[], compiled?: CompiledPathEntry[]): string {
	const toProcess: CompiledPathEntry[] = compiled ?? compilePathEntries(entries);

	let out = text;
	const legend: string[] = [];

	for (const { path, sigil, re, minOccurrences } of toProcess) {
		// Count occurrences with early exit — indexOf loop is faster than match()
		// for the common case where we only need to confirm ≥ minOccurrences.
		let count = 0;
		let pos = 0;
		while ((pos = out.indexOf(path, pos)) !== -1) {
			if (++count >= minOccurrences) break;
			pos += path.length;
		}
		if (count < minOccurrences) continue;

		// Reset lastIndex before replace (global regexes are stateful)
		re.lastIndex = 0;
		out = out.replace(re, sigil);
		legend.push(`${sigil}=${path}`);
	}

	if (legend.length === 0) return out;

	// Prepend legend on its own line in square brackets so it reads as metadata
	return `[${legend.join(", ")}]\n${out}`;
}
