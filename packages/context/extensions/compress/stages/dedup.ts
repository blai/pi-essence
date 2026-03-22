/**
 * Consecutive duplicate line folder.
 *
 * Collapses runs of N≥3 identical consecutive lines into a single annotated
 * line: `[3×] original line`. This is lossless (the count and content are
 * both preserved) and extremely effective on log output, stack traces, and
 * repeated separator lines.
 *
 * Threshold: only folds runs of 3 or more. Runs of 1–2 are left as-is to
 * avoid introducing marker overhead for common patterns like a blank line
 * followed by content.
 *
 * Empty lines are excluded from folding — consecutive blank lines are
 * handled by the whitespace stage.
 */

const FOLD_THRESHOLD = 3;

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

		if (run >= FOLD_THRESHOLD) {
			out.push(`[${run}×] ${line}`);
		} else {
			for (let j = 0; j < run; j++) out.push(line);
		}

		i += run;
	}

	return out.join("\n");
}
