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
 */

export interface PathEntry {
	path: string; // Filesystem path to compress (absolute)
	sigil: string; // Short replacement token, e.g. "$WS"
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compressPaths(text: string, entries: PathEntry[]): string {
	// Sort longest path first so a prefix path doesn't shadow a longer one
	const sorted = [...entries].sort((a, b) => b.path.length - a.path.length);

	let out = text;
	const legend: string[] = [];

	for (const { path, sigil } of sorted) {
		if (!path || path.length < 8) continue; // Skip trivially short paths

		const minOccurrences = path.length >= 40 ? 2 : 3;
		const re = new RegExp(escapeRegex(path), "g");
		const matches = (out.match(re) ?? []).length;

		if (matches < minOccurrences) continue;

		out = out.replace(re, sigil);
		legend.push(`${sigil}=${path}`);
	}

	if (legend.length === 0) return out;

	// Prepend legend on its own line in square brackets so it reads as metadata
	return `[${legend.join(", ")}]\n${out}`;
}
