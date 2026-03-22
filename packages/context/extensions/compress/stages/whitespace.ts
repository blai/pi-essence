/**
 * Whitespace normalization stage.
 *
 * Lossless from a semantic perspective — removes formatting waste:
 *   - Trailing spaces/tabs on every line
 *   - Runs of 3+ blank lines collapsed to 2
 *   - Leading and trailing blank lines stripped from the entire block
 *
 * Applied first (after ANSI) so later stages work on clean lines.
 *
 * Performance: fast pre-checks skip each regex pass when unnecessary.
 * indexOf scans are O(n) but have lower constant than regex for simple needles.
 */

export function normalizeWhitespace(text: string): string {
	let out = text;

	// Strip trailing whitespace per line — only if any trailing space/tab exists
	// Check for ' \n', '\t\n', or trailing space/tab at end of text
	if (
		out.indexOf(" \n") !== -1 ||
		out.indexOf("\t\n") !== -1 ||
		out[out.length - 1] === " " ||
		out[out.length - 1] === "\t"
	) {
		out = out.replace(/[ \t]+$/gm, "");
	}

	// Collapse runs of 3+ blank lines — only if '\n\n\n' exists
	if (out.indexOf("\n\n\n") !== -1) {
		out = out.replace(/\n{3,}/g, "\n\n");
	}

	// Strip leading blank lines — only if text starts with '\n'
	if (out.charCodeAt(0) === 10 /* '\n' */) {
		out = out.replace(/^\n+/, "");
	}

	// Strip trailing blank lines — only if last two chars are '\n\n'
	const len = out.length;
	if (len >= 2 && out.charCodeAt(len - 1) === 10 && out.charCodeAt(len - 2) === 10) {
		out = out.replace(/\n+$/, "");
	}

	return out;
}
