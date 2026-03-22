/**
 * ANSI / VT control sequence stripper.
 *
 * Delegates to Node.js built-in `util.stripVTControlCharacters` (available
 * since Node 16.11) which handles all CSI, OSC, DCS, SS2/SS3, and bare-ESC
 * sequences correctly without any regex maintenance burden.
 *
 * This is the only stage that belongs in `tool_result` (modifying the stored
 * session entry) rather than the `context` hook, because ANSI codes are noise
 * in both the UI and session files — stripping them improves readability for
 * humans too, not only for the LLM.
 */

import { stripVTControlCharacters } from "node:util";

export function stripAnsi(text: string): string {
	return stripVTControlCharacters(text);
}
