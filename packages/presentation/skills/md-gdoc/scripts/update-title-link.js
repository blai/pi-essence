#!/usr/bin/env node
/**
 * update-title-link.js — Embed a GDoc URL into the H1 title of a markdown report.
 *
 * After publishing a .md file to Google Docs, call this script to back-link the
 * report's H1 heading to the created GDoc.  The same script is idempotent: calling
 * it a second time with a new URL updates the existing link.
 *
 * Supported H1 patterns (auto-detected):
 *
 *   Pattern A — bare bracketed tag (RCA style):
 *     Before: # [RCA] [TC-5328](...): Title
 *     After:  # [[RCA]](url) [TC-5328](...): Title
 *
 *   Pattern B — phrase before em-dash separator (arch-gap style):
 *     Before: # Architecture Gap Report — Bank Link
 *     After:  # [Architecture Gap Report](url) — Bank Link
 *
 *   Pattern C — phrase before colon separator:
 *     Before: # My Report: Subtitle
 *     After:  # [My Report](url): Subtitle
 *
 *   Pattern D — bare title (no separator):
 *     Before: # My Report
 *     After:  # [My Report](url)
 *
 *   Already linked (any pattern) — URL is updated in-place:
 *     Before: # [[RCA]](old_url) ...   →   # [[RCA]](new_url) ...
 *     Before: # [Phrase](old_url) ...  →   # [Phrase](new_url) ...
 *
 * Usage:
 *   node update-title-link.js <input.md> <gdoc_url>
 *
 * Prints the new H1 line to stdout and writes the file in-place.
 * Exits with code 1 on error (file not found, no H1 found).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const [,, inputFile, gdocUrl] = process.argv;

if (!inputFile || !gdocUrl) {
  console.error('Usage: node update-title-link.js <input.md> <gdoc_url>');
  process.exit(1);
}

const absPath = path.resolve(inputFile);
if (!fs.existsSync(absPath)) {
  console.error('ERROR: file not found:', absPath);
  process.exit(1);
}

if (!gdocUrl.startsWith('https://docs.google.com/document/')) {
  console.error('ERROR: gdoc_url must be a Google Docs URL (https://docs.google.com/document/...)');
  process.exit(1);
}

const text  = fs.readFileSync(absPath, 'utf8');
const lines = text.split('\n');

// Find the first H1 line
const h1Idx = lines.findIndex(l => l.startsWith('# '));
if (h1Idx === -1) {
  console.error('ERROR: no H1 heading found in', absPath);
  process.exit(1);
}

const h1 = lines[h1Idx];
const rest = h1.slice(2); // everything after '# '

let newH1;

// ─── Already linked — update URL in existing link ────────────────────────────

// Pattern: [[Tag]](old_url)  →  [[Tag]](new_url)
const dblBracketRe = /^\[(\[[^\]]+\])\]\([^)]+\)(.*)/;
const dblMatch = rest.match(dblBracketRe);
if (dblMatch) {
  newH1 = `# [${dblMatch[1]}](${gdocUrl})${dblMatch[2]}`;
}

// Pattern: [Phrase](old_url)  →  [Phrase](new_url)
if (!newH1) {
  const singleLinkRe = /^(\[[^\]]+\])\([^)]+\)(.*)/;
  const slMatch = rest.match(singleLinkRe);
  if (slMatch) {
    newH1 = `# ${slMatch[1]}(${gdocUrl})${slMatch[2]}`;
  }
}

// ─── Not yet linked — insert link ────────────────────────────────────────────

if (!newH1) {
  // Pattern A: [Tag] rest...  →  [[Tag]](url) rest...
  const bareTagRe = /^(\[[^\]]+\])(.*)/;
  const btMatch = rest.match(bareTagRe);
  if (btMatch) {
    newH1 = `# [${btMatch[1]}](${gdocUrl})${btMatch[2]}`;
  }
}

if (!newH1) {
  // Pattern B: Phrase — rest  →  [Phrase](url) — rest
  const emDashIdx = rest.indexOf(' — ');
  if (emDashIdx !== -1) {
    const phrase = rest.slice(0, emDashIdx);
    const after  = rest.slice(emDashIdx); // includes ' — '
    newH1 = `# [${phrase}](${gdocUrl})${after}`;
  }
}

if (!newH1) {
  // Pattern C: Phrase: rest  →  [Phrase](url): rest
  // Only match if colon is after a multi-word phrase (not after a link)
  const colonRe = /^([A-Za-z][^:[\n]+):(.*)/;
  const cMatch = rest.match(colonRe);
  if (cMatch) {
    newH1 = `# [${cMatch[1]}](${gdocUrl}):${cMatch[2]}`;
  }
}

if (!newH1) {
  // Pattern D: bare title  →  [Title](url)
  newH1 = `# [${rest}](${gdocUrl})`;
}

// ─── Write back ───────────────────────────────────────────────────────────────

if (newH1 === h1) {
  console.log('Title unchanged (URL already up to date):', h1);
  process.exit(0);
}

lines[h1Idx] = newH1;
fs.writeFileSync(absPath, lines.join('\n'), 'utf8');

console.log('Updated H1:');
console.log(' before:', h1);
console.log(' after: ', newH1);
