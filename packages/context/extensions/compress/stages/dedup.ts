/**
 * Consecutive duplicate line folder.
 *
 * Collapses runs of N≥3 identical consecutive lines into a single annotated
 * line: `[3×] original line`. This is lossless (the count and content are
 * both preserved) and extremely effective on log output, stack traces, and
 * repeated separator lines.
 *
 * Threshold: folds runs of 2 or more. For any line longer than 4 chars,
 * `[2×] line` (len+5 chars) is shorter than two copies (2*len+1 chars),
 * so folding pairs is always a net win for realistic line lengths.
 *
 * Empty lines are excluded from folding — consecutive blank lines are
 * handled by the whitespace stage.
 */

const FOLD_THRESHOLD = 2;

/** Minimum line length to fold at threshold=2. Lines ≤4 chars save nothing. */
const MIN_LINE_LENGTH = 5;

export function foldConsecutiveDuplicates(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Never fold blank lines — let whitespace stage handle those
		if (line.trim() === "") {
			out.push(line);
			i++;
			continue;
		}

		// Count consecutive identical lines
		let run = 1;
		while (i + run < lines.length && lines[i + run] === line) {
			run++;
		}

		if (run >= FOLD_THRESHOLD && line.length >= MIN_LINE_LENGTH) {
			out.push(`[${run}×] ${line}`);
		} else {
			for (let j = 0; j < run; j++) out.push(line);
		}

		i += run;
	}

	return out.join("\n");
}
