/**
 * Separator line normalizer.
 *
 * Many CLI tools emit long horizontal rules:
 *   ─────────────────────────────────────────────────────  (80+ chars)
 *   ══════════════════════════════════════════════════════
 *   ======================================================
 *   ──────────────────────────────────────────────────────
 *
 * These are purely visual separators — their length conveys no information.
 * This stage detects lines composed entirely of a single repeated separator
 * character and shortens them to NORM_LENGTH characters.
 *
 * Lossless: the separator character is preserved; only the repetition count
 * changes. The LLM reads `────────` and `────────────────────────────────`
 * identically as "horizontal separator."
 *
 * Applied BEFORE the dedup stage so that normalized separators are
 * identical strings and can be folded by dedup (e.g., 8× `────────`
 * collapses cleanly rather than 8× distinct-length strings).
 *
 * Separator characters detected:
 *   Unicode box/block: ─ ━ ═ │ ║ ╌ ╍ ┄ ┅ ┈ ┉ ╴ ╶ ╸ ╺ ▬ ▭ ▔ ▁
 *   ASCII:             - = ~ * # _ + ^ . / \
 */

/** Output length for all normalized separator lines. */
const NORM_LENGTH = 8;

/** Minimum original length before we bother normalizing. */
const MIN_LENGTH = NORM_LENGTH + 2; // only shorten lines that are actually longer

/**
 * Set of code points that qualify as separator characters (single char repeated
 * across the whole line). Stored as a Set<number> for O(1) lookup.
 */
const SEP_CHARS = new Set<number>([
	// Unicode box/line drawing (common in terminal UIs and npm/pi output)
	0x2500, // ─  BOX DRAWINGS LIGHT HORIZONTAL
	0x2501, // ━  BOX DRAWINGS HEAVY HORIZONTAL
	0x2550, // ═  BOX DRAWINGS DOUBLE HORIZONTAL
	0x254c, // ╌  BOX DRAWINGS LIGHT DOUBLE DASH HORIZONTAL
	0x254d, // ╍  BOX DRAWINGS HEAVY DOUBLE DASH HORIZONTAL
	0x2504, // ┄  BOX DRAWINGS LIGHT TRIPLE DASH HORIZONTAL
	0x2505, // ┅  BOX DRAWINGS HEAVY TRIPLE DASH HORIZONTAL
	0x2508, // ┈  BOX DRAWINGS LIGHT QUADRUPLE DASH HORIZONTAL
	0x2509, // ┉  BOX DRAWINGS HEAVY QUADRUPLE DASH HORIZONTAL
	0x2574, // ╴  BOX DRAWINGS LIGHT LEFT
	0x2576, // ╶  BOX DRAWINGS LIGHT RIGHT
	0x2578, // ╸  BOX DRAWINGS HEAVY LEFT
	0x257a, // ╺  BOX DRAWINGS HEAVY RIGHT
	0x25ac, // ▬  BLACK RECTANGLE
	0x2015, // ―  HORIZONTAL BAR
	0x2014, // —  EM DASH
	0x2013, // –  EN DASH
	// ASCII
	0x2d,   // -
	0x3d,   // =
	0x7e,   // ~
	0x2a,   // *
	0x23,   // #
	0x5f,   // _
	0x2b,   // +
	0x5e,   // ^
	0x2e,   // .
	0x3d,   // =  (dup, harmless)
]);

/**
 * Normalize long separator lines to a fixed length.
 * Returns the original text if no separator lines are found.
 */
export function normalizeSeparators(text: string): string {
	if (text.indexOf("\n") === -1) {
		// Single-line fast path
		return normalizeLine(text) ?? text;
	}

	const lines = text.split("\n");
	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const normalized = normalizeLine(lines[i]);
		if (normalized !== null) {
			lines[i] = normalized;
			changed = true;
		}
	}

	return changed ? lines.join("\n") : text;
}

/**
 * If `line` is a long separator line, return the normalized version.
 * Returns null if the line is not a separator or is already short enough.
 */
function normalizeLine(line: string): string | null {
	if (line.length < MIN_LENGTH) return null;

	const cp = line.codePointAt(0);
	if (cp === undefined || !SEP_CHARS.has(cp)) return null;

	// Multi-byte character (e.g. ─ is 3 bytes, 1 code point)
	const char = String.fromCodePoint(cp);
	const charLen = char.length; // 1 or 2 for surrogates (our chars are all 1)

	// Verify every character in the line is the same code point
	for (let i = charLen; i < line.length; i += charLen) {
		if (line.codePointAt(i) !== cp) return null;
	}

	return char.repeat(NORM_LENGTH);
}
