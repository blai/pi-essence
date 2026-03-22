/**
 * Dynamic repeated-token compressor.
 *
 * Scans the text for long repeated structured tokens (paths, module refs,
 * URLs) that appear multiple times but aren't in the configured pathEntries.
 * Assigns numbered sigils ($T1, $T2, …) in descending savings order.
 *
 * Lossless: a legend line `[$T1=..., $T2=...]` is always prepended so the
 * LLM can recover originals.
 *
 * Two-pass detection:
 *   Pass 1 — Exact token matches: non-whitespace tokens ≥MIN_LEN chars that
 *     appear 2+ times verbatim.
 *   Pass 2 — Prefix matching: strip trailing `(:\d+)+` (line:col) or `/\d+`
 *     (numeric path segments) from tokens, then count how many times the
 *     stripped prefix occurs as a substring in the original text. Catches
 *     stack trace patterns like `node:internal/modules/cjs/loader:` which
 *     appear with different line numbers each time.
 *
 * Break-even: for a prefix of length L and sigil of length S, compression
 * pays off when count × (L − S) > L + S + 4 (legend overhead).
 */

const MIN_TOKEN_LEN = 15;
const SIGIL_PREFIX = "$T";
const MAX_TOKENS = 8;

/** Matches long structured tokens (contain a path separator char). */
const TOKEN_RE = /[^\s,;'"(){}\[\]<>|&!?`]{15,}/g;
const STRUCTURED_RE = /[/:@.]/;

/** Strip trailing :digit or /digit sequences (line:col, numeric segments). */
function stripTrailingNumbers(tok: string): string {
	return tok.replace(/(:\d+)+$/, "").replace(/\/\d+$/, "");
}

/**
 * Extract the directory prefix of a path token — everything up to and
 * including the last `/`. Returns null if the prefix is shorter than
 * MIN_TOKEN_LEN or hasn't changed (no `/` found after the minimum length).
 *
 * Example: `$WS/packages/context/compress/stages/stage_000.ts`
 *        → `$WS/packages/context/compress/stages/`
 */
function stripToDirectory(tok: string): string | null {
	const lastSlash = tok.lastIndexOf("/");
	if (lastSlash < MIN_TOKEN_LEN) return null;
	const dir = tok.slice(0, lastSlash + 1); // include trailing /
	if (dir === tok) return null; // already ends with /
	return dir;
}

export function compressDynamicTokens(text: string): string {
	if (text.length < MIN_TOKEN_LEN * 2 || !STRUCTURED_RE.test(text)) return text;

	// Collect candidate (token/prefix → net savings) map
	const sigilLen = SIGIL_PREFIX.length + 1; // e.g. "$T1" = 3

	// candidateMap: compressed string → { occurrences, netSavings }
	const candidates = new Map<string, { count: number; savings: number }>();

	function evaluate(tok: string): void {
		if (tok.length < MIN_TOKEN_LEN || !STRUCTURED_RE.test(tok)) return;

		// Count occurrences of tok as a substring in text (indexOf loop)
		let count = 0;
		let pos = 0;
		while ((pos = text.indexOf(tok, pos)) !== -1) {
			count++;
			pos += tok.length;
		}

		if (count < 2) return;

		const legendCost = tok.length + sigilLen + 4; // "$Tn=token, " overhead
		const savingsPerOcc = tok.length - sigilLen;
		if (savingsPerOcc <= 0) return;

		const netSavings = count * savingsPerOcc - legendCost;
		if (netSavings <= 0) return;

		const existing = candidates.get(tok);
		if (!existing || netSavings > existing.savings) {
			candidates.set(tok, { count, savings: netSavings });
		}
	}

	// Pass 1: exact token matching
	TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TOKEN_RE.exec(text)) !== null) {
		const tok = m[0];
		if (STRUCTURED_RE.test(tok)) evaluate(tok);
	}

	// Pass 2: prefix matching — try multiple prefix variants of each token.
	// This catches patterns like `node:internal/loader:885:27` (strip :digits)
	// and `$WS/packages/compress/stages/stage_000.ts` (strip filename → dir).
	TOKEN_RE.lastIndex = 0;
	const triedPrefixes = new Set<string>();
	while ((m = TOKEN_RE.exec(text)) !== null) {
		const tok = m[0];
		if (!STRUCTURED_RE.test(tok)) continue;

		// Try stripping trailing :digit sequences (stack trace line:col)
		const numStripped = stripTrailingNumbers(tok);
		if (numStripped !== tok && numStripped.length >= MIN_TOKEN_LEN && !triedPrefixes.has(numStripped)) {
			triedPrefixes.add(numStripped);
			evaluate(numStripped);
		}

		// Try stripping to directory prefix (repeated file paths in a directory)
		const dirPrefix = stripToDirectory(tok);
		if (dirPrefix && !triedPrefixes.has(dirPrefix)) {
			triedPrefixes.add(dirPrefix);
			evaluate(dirPrefix);
		}
	}

	if (candidates.size === 0) return text;

	// Sort by savings desc for dedup (higher savings = higher priority = goes first).
	// After dedup, re-sort by length desc for replacement (longest first avoids
	// partial replacement when one candidate is a prefix of another's replacement).
	const bySavings = [...candidates.entries()]
		.sort((a, b) => b[1].savings - a[1].savings)
		.slice(0, MAX_TOKENS)
		.map(([tok]) => tok);

	// Deduplicate: candidates are sorted by savings descending.
	// Enforce strict non-overlap: if two candidates are in a substring
	// relationship, keep only the one with higher savings (processed first).
	//
	// Why strict: sequential string replacement would corrupt the legend line
	// when a shorter candidate is a prefix of an already-replaced longer one.
	// e.g. replacing "node:internal/modules/cjs/" AFTER "node:internal/modules/
	//   cjs/loader" was replaced would mangle the $T1 legend entry.
	const final: string[] = [];
	for (const tok of bySavings) {
		// Skip if an already-selected item CONTAINS tok (tok is a sub-prefix,
		// all its occurrences in the data are subsumed by the longer selection)
		if (final.some((sel) => sel.includes(tok))) continue;
		// Skip if tok CONTAINS an already-selected item (the shorter selected item
		// had better savings; this longer one would create legend corruption)
		if (final.some((sel) => tok.includes(sel))) continue;
		final.push(tok);
	}

	// Re-sort final by length descending for replacement (longest first prevents
	// partial shadowing: replacing "a/b/c" before "a/b" avoids mis-matching "a/b")
	const finalByLength = [...final].sort((a, b) => b.length - a.length);

	let out = text;
	const legend: string[] = [];
	let sigilIndex = 1;

	for (const tok of finalByLength) {
		const sigil = `${SIGIL_PREFIX}${sigilIndex}`;
		out = out.split(tok).join(sigil);
		legend.push(`${sigil}=${tok}`);
		sigilIndex++;
	}

	if (legend.length === 0) return text;

	return `[${legend.join(", ")}]\n${out}`;
}
