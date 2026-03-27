#!/usr/bin/env node
/**
 * md-to-tab-native.js — Write a markdown file into an existing Google Doc tab,
 *                        using Drive's native markdown import as a staging step.
 *
 * Why a staging step?
 *   Drive's native markdown importer produces perfect formatting (real tables,
 *   code blocks, mermaid diagrams, column widths, heading styles, links) but it
 *   only works when CREATING a new top-level document — there is no API to import
 *   markdown directly into a tab of an existing document.  This script bridges that
 *   gap: it creates a temporary document via native import, reads its structured
 *   body via the Docs API, replays that body into the target tab, then deletes the
 *   temporary document.
 *
 * Pipeline:
 *   1. node convert.js <input.md> → temp Doc B  (mermaid, tables, widths, pageless)
 *   2. documents.get Doc B  → read body (paragraphs, tables, inline images)
 *   3. Clear the target tab's existing content
 *   4. Insert all body text into the tab via one insertText call
 *   5. Apply paragraph styles (headings) + text-run styles (bold/italic/link/mono)
 *      + bullet lists — clamped to actual post-insert segment bounds
 *   6. Replace TABLE_N placeholders (reverse order) with real insertTable + cells
 *      + column widths + borders + header shading
 *   7. drive.files.delete temp Doc B
 *
 * Usage:
 *   node md-to-tab-native.js <input.md> \
 *     --doc-id <DOCUMENT_ID> \
 *     --tab-id <TAB_ID> \
 *     [--page-width 468]
 *
 *   Tab ID is returned by addDocumentTab batchUpdate, e.g. "t.bvkkezvf5hzx".
 *
 * Requirements: same as convert.js (gws CLI authenticated with drive,docs; curl)
 */
'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (!argv[0] || argv[0] === '--help') {
  console.error(
    'Usage: node md-to-tab-native.js <input.md> --doc-id <ID> --tab-id <ID> [--page-width 468]'
  );
  process.exit(1);
}

const inputFile = path.resolve(argv[0]);
if (!fs.existsSync(inputFile)) { console.error('ERROR: file not found:', inputFile); process.exit(1); }

let docId = null, tabId = null, pageWidthPt = 468;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--doc-id'     && argv[i+1]) docId       = argv[++i];
  if (argv[i] === '--tab-id'     && argv[i+1]) tabId       = argv[++i];
  if (argv[i] === '--page-width' && argv[i+1]) pageWidthPt = parseFloat(argv[++i]);
}
if (!docId || !tabId) { console.error('ERROR: --doc-id and --tab-id are required'); process.exit(1); }

// convert.js lives alongside this script
const CONVERT_JS = path.resolve(__dirname, 'convert.js');
if (!fs.existsSync(CONVERT_JS)) {
  console.error('ERROR: convert.js not found at', CONVERT_JS);
  process.exit(1);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function run(cmd, args, { silent = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args[0]} failed:\n${(r.stderr || r.stdout || '').trim().slice(0, 800)}`);
  }
  if (!silent && r.stderr) process.stderr.write(r.stderr);
  return r.stdout;
}

function gwsJSON(args) {
  const raw = run('gws', args, { silent: true }).replace(/^Using keyring[^\n]*\n/m, '').trim();
  try { return JSON.parse(raw); }
  catch {
    const line = raw.split('\n').find(l => l.startsWith('{'));
    if (line) return JSON.parse(line);
    throw new Error('Unexpected gws output: ' + raw.slice(0, 300));
  }
}

function batchUpdate(requests) {
  const BATCH = 400;
  for (let i = 0; i < requests.length; i += BATCH) {
    const batch = requests.slice(i, i + BATCH);
    gwsJSON([
      'docs', 'documents', 'batchUpdate',
      '--params', JSON.stringify({ documentId: docId }),
      '--json',   JSON.stringify({ requests: batch }),
    ]);
    process.stdout.write(`  → ${Math.min(i + BATCH, requests.length)}/${requests.length} reqs\r`);
  }
  if (requests.length > 0) process.stdout.write('\n');
}

function getTabContent() {
  const doc = gwsJSON([
    'docs', 'documents', 'get',
    '--params', JSON.stringify({ documentId: docId, includeTabsContent: true }),
  ]);
  const tab = doc.tabs.find(t => t.tabProperties.tabId === tabId);
  if (!tab) throw new Error('Tab not found: ' + tabId);
  return tab.documentTab.body.content;
}

function optColor(r, g, b) {
  return { color: { rgbColor: { red: r, green: g, blue: b } } };
}

// ─── Step 1: create temp doc via native import ────────────────────────────────

console.log(`\n[1/7] Creating temp doc from "${path.basename(inputFile)}" via native import...`);
let convertOut;
try {
  convertOut = run('node', [CONVERT_JS, inputFile, '--title', `__TEMP_TAB_${Date.now()}`]);
} catch (e) {
  console.error('ERROR: convert.js failed:', e.message);
  process.exit(1);
}
const urlMatch = convertOut.match(/\/document\/d\/([A-Za-z0-9_-]+)/);
if (!urlMatch) {
  console.error('ERROR: could not parse doc ID from convert.js output:\n', convertOut);
  process.exit(1);
}
const tempDocId = urlMatch[1];
console.log(`  ✓ Temp doc: ${tempDocId}`);

// ─── Step 2: read temp doc body ───────────────────────────────────────────────

console.log('\n[2/7] Reading temp doc structure...');
let docBRaw;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    docBRaw = gwsJSON([
      'docs', 'documents', 'get',
      '--params', JSON.stringify({ documentId: tempDocId }),
    ]);
    if ((docBRaw.body?.content?.length ?? 0) > 1) break;
  } catch (e) {
    if (attempt === 2) throw e;
  }
  spawnSync('sleep', ['3']); // Drive sometimes needs a moment to fully index
}
const bodyContent  = docBRaw.body?.content   ?? [];
const inlineObjs   = docBRaw.inlineObjects   ?? {};
console.log(`  ✓ ${bodyContent.length} body elements`);

// ─── Step 3: build replay plan ────────────────────────────────────────────────

console.log('\n[3/7] Building replay plan...');

const replayItems = []; // { type:'para'|'table', ... }
let tableIdx = 0;

for (const el of bodyContent) {
  if (el.sectionBreak) continue;

  if (el.paragraph) {
    const elements = el.paragraph.elements ?? [];
    const runs     = [];
    let paraText   = '';

    for (const elem of elements) {
      if (elem.textRun) {
        // Drive's native import converts Markdown trailing-two-spaces (hard line-break)
        // into U+000B (soft-return / vertical-tab) within a paragraph.  The Docs API
        // insertText silently drops U+000B, making the inserted text shorter than
        // expected and shifting all subsequent style indices.
        // Fix: replace U+000B → \n so insertText accepts it.  Default NORMAL_TEXT has
        // 0pt space above/below, so consecutive paragraphs look identical to soft-return
        // lines, preserving the "one metadata field per line" appearance.
        const content = elem.textRun.content.replace(/\u000b/g, '\n');
        runs.push({ text: content, style: elem.textRun.textStyle ?? {} });
        paraText += content;
      } else if (elem.inlineObjectElement) {
        // Inline images (e.g. mermaid diagrams): use a space placeholder.
        // The image is already rendered in the temp doc; tab replay skips re-insertion
        // because Drive has no API to copy embedded images between docs.
        const objId = elem.inlineObjectElement.inlineObjectId;
        const obj   = inlineObjs[objId];
        const uri   = obj?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
        runs.push({ text: '\x00', style: {}, imageUri: uri, imageWidth: pageWidthPt });
        paraText += '\x00';
      }
    }

    replayItems.push({
      type: 'para',
      paraText,
      runs,
      style:  el.paragraph.paragraphStyle ?? {},
      bullet: el.paragraph.bullet ?? null,
    });
    continue;
  }

  if (el.table) {
    replayItems.push({ type: 'table', tableEl: el.table, tableIndex: tableIdx++ });
  }
}

// ─── Step 4: build full text + style metadata ─────────────────────────────────

let fullText = '';
let idx      = 1; // Docs body indices start at 1

const paraRecords  = []; // { start, end, style, bullet, runs }
const tableRecords = []; // { placeholder, tableIndex, tableEl }
const imageRecords = []; // { index, uri, width }

for (const item of replayItems) {
  if (item.type === 'para') {
    const start    = idx;
    // Replace null-byte image placeholders with a space (same char count → indices stable)
    const safeText = item.paraText.replace(/\x00/g, ' ');

    let runOffset = 0;
    const adjustedRuns = item.runs.map(r => {
      const rs = start + runOffset;
      const t  = r.imageUri ? ' ' : r.text;
      runOffset += t.length;
      return { ...r, text: t, start: rs, end: rs + t.length };
    });

    fullText += safeText;
    idx      += safeText.length;
    paraRecords.push({ start, end: idx, style: item.style, bullet: item.bullet, runs: adjustedRuns });

    for (const r of adjustedRuns) {
      if (r.imageUri) imageRecords.push({ index: r.start, uri: r.imageUri, width: r.imageWidth });
    }
    continue;
  }

  if (item.type === 'table') {
    const placeholder = `<<<TABLE_${item.tableIndex}>>>\n`;
    fullText += placeholder;
    tableRecords.push({
      placeholder: `<<<TABLE_${item.tableIndex}>>>`,
      tableIndex:  item.tableIndex,
      tableEl:     item.tableEl,
    });
    idx += placeholder.length;
  }
}

console.log(
  `  Text: ${fullText.length} chars | Paras: ${paraRecords.length}` +
  ` | Tables: ${tableRecords.length} | Images: ${imageRecords.length}`
);

// ─── Step 5: clear tab + insert full text ─────────────────────────────────────

console.log('\n[4/7] Clearing tab and inserting text...');
const existingContent = getTabContent();
const maxEndBefore    = Math.max(...existingContent.map(el => el.endIndex || 0));

// Only delete if actual content exists (maxEndBefore > 2).
// A freshly-created empty tab has maxEndBefore = 1 (just the sectionBreak);
// deleteContentRange(1, 0) is an invalid empty range.
if (maxEndBefore > 2) {
  batchUpdate([{
    deleteContentRange: { range: { startIndex: 1, endIndex: maxEndBefore - 1, tabId } },
  }]);
}
// After clearing, a single mandatory \n paragraph remains at index 1.
// If a previous run applied bullet formatting, that \n retains it — and
// insertText at index 1 inherits the paragraph style, making every new
// paragraph a bullet item.  Wipe any lingering list formatting first.
batchUpdate([{
  deleteParagraphBullets: { range: { startIndex: 1, endIndex: 2, tabId } },
}]);
batchUpdate([{ insertText: { location: { index: 1, tabId }, text: fullText } }]);
console.log(`  ✓ ${fullText.length} chars inserted`);

// Read actual segment end after insertion — needed to clamp style ranges.
// (insertText may accept slightly fewer chars than fullText.length in edge cases;
// any style range beyond the actual segment end will be rejected by the API.)
const postInsertContent = getTabContent();
const actualSegEnd = Math.max(...postInsertContent.map(el => el.endIndex || 0));

// ─── Step 6: apply styles ─────────────────────────────────────────────────────

console.log('\n[5/7] Applying styles...');

// Helper: clamp a range's endIndex to the actual segment boundary
function clampRange(range) {
  const clamped = { ...range };
  if (clamped.endIndex > actualSegEnd) clamped.endIndex = actualSegEnd;
  return clamped;
}

const styleReqs = [];

// ── Paragraph styles (headings) ──
for (const rec of paraRecords) {
  const named = rec.style.namedStyleType;
  if (named && named !== 'NORMAL_TEXT') {
    styleReqs.push({
      updateParagraphStyle: {
        range: clampRange({ startIndex: rec.start, endIndex: rec.end, tabId }),
        paragraphStyle: { namedStyleType: named },
        fields: 'namedStyleType',
      },
    });
  }
}

// ── Text-run styles (bold, italic, underline, link, monospace) ──
for (const rec of paraRecords) {
  for (const run of rec.runs) {
    if (!run.style || run.start >= run.end || run.text === '\n') continue;
    const s      = run.style;
    const fields = [];
    const ts     = {};
    if (s.bold)                    { ts.bold = true;            fields.push('bold'); }
    if (s.italic)                  { ts.italic = true;          fields.push('italic'); }
    if (s.underline && !s.link)    { ts.underline = true;       fields.push('underline'); }
    if (s.strikethrough)           { ts.strikethrough = true;   fields.push('strikethrough'); }
    if (s.link)                    { ts.link = s.link;          fields.push('link'); }
    const ff = s.weightedFontFamily?.fontFamily;
    if (ff === 'Courier New' || ff === 'Consolas' || ff === 'Roboto Mono') {
      ts.weightedFontFamily = s.weightedFontFamily;
      fields.push('weightedFontFamily');
    }
    if (fields.length === 0) continue;
    const range = clampRange({ startIndex: run.start, endIndex: run.end, tabId });
    if (range.startIndex >= range.endIndex) continue; // fully out of range
    styleReqs.push({
      updateTextStyle: { range, textStyle: ts, fields: fields.join(',') },
    });
  }
}

// ── Bullet lists — intentionally NOT replayed ──────────────────────────────
// createParagraphBullets is NOT applied during tab replay.
//
// Why: the tab's total char count after insertText can drift slightly from the
// calculated `idx` (the "19 chars missing" phenomenon described in element-map.md).
// When bullet group ranges are sent in a single batchUpdate call, any group whose
// computed range exceeds the actual segment end is silently treated by the Docs API
// as a full-document range — causing the entire tab to become an unordered list.
//
// The list-item text ("- item", "1. item") is preserved verbatim in the inserted
// content, so lists remain readable.  Native Google Docs bullet formatting is
// available on standalone docs created by convert.js (Drive native import has no
// such limitation); it is intentionally not replicated in tab replays.

if (styleReqs.length > 0) {
  batchUpdate(styleReqs);
  console.log(`  ✓ ${styleReqs.length} style requests applied`);
} else {
  console.log('  ✓ no styles to apply');
}

// ─── Step 7: replace table placeholders with real tables ──────────────────────

console.log(`\n[6/7] Inserting ${tableRecords.length} tables (reverse order)...`);

// Process in REVERSE order so inserting at a high index never shifts earlier placeholders.
for (let ti = tableRecords.length - 1; ti >= 0; ti--) {
  const rec      = tableRecords[ti];
  const tableEl  = rec.tableEl;
  const numRows  = tableEl.rows;
  const numCols  = tableEl.columns;

  // a. Find the placeholder paragraph in the current tab
  const tabContent1 = getTabContent();
  let phStart = null, phEnd = null;
  for (const el of tabContent1) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements ?? []).map(e => e.textRun?.content ?? '').join('');
    if (text.includes(rec.placeholder)) { phStart = el.startIndex; phEnd = el.endIndex; break; }
  }
  if (phStart === null) { console.warn(`  ⚠ Table ${ti}: placeholder not found, skipping`); continue; }

  // b. Delete placeholder, insert real table
  batchUpdate([{ deleteContentRange: { range: { startIndex: phStart, endIndex: phEnd, tabId } } }]);
  batchUpdate([{ insertTable: { rows: numRows, columns: numCols, location: { index: phStart, tabId } } }]);

  // c. Locate the newly inserted table (re-fetch)
  const tabContent2  = getTabContent();
  let insertedTable = tabContent2.find(
    el => el.table && el.startIndex >= phStart - 1 && el.startIndex <= phStart + 4
  ) ?? tabContent2.find(el => el.table && el.startIndex >= phStart - 2);
  if (!insertedTable) { console.warn(`  ⚠ Table ${ti}: cannot locate inserted table`); continue; }

  // d. Fill cells — reverse order (last cell first) to keep earlier indices stable
  const cellInserts = [];
  const srcRows = tableEl.tableRows ?? [];
  const dstRows = insertedTable.table.tableRows ?? [];
  for (let r = 0; r < Math.min(srcRows.length, dstRows.length); r++) {
    const srcCells = srcRows[r].tableCells ?? [];
    const dstCells = dstRows[r].tableCells ?? [];
    for (let c = 0; c < Math.min(srcCells.length, dstCells.length); c++) {
      const cellText = (srcCells[c].content ?? [])
        .map(p => (p.paragraph?.elements ?? []).map(e => e.textRun?.content ?? '').join(''))
        .join('').replace(/\n$/, ''); // strip trailing newline (cell already has one)
      if (!cellText) continue;
      const dstContent = dstCells[c].content ?? [];
      if (!dstContent.length) continue;
      const si = dstContent[0].startIndex;
      if (si == null) continue;
      // Insert AT si (before the mandatory \n).
      // Do NOT use si+1 — that equals endIndex for an empty-cell paragraph and is outside bounds.
      cellInserts.push({ insertText: { location: { index: si, tabId }, text: cellText } });
    }
  }
  cellInserts.reverse();
  if (cellInserts.length > 0) {
    try { batchUpdate(cellInserts); }
    catch (e) { console.warn(`  ⚠ Table ${ti} cell fill:`, e.message.split('\n')[0]); }
  }

  // e. Re-fetch to get final cell indices for header bold + borders + widths
  const tabContent3 = getTabContent();
  const finalTable  = tabContent3.find(
    el => el.table && el.startIndex >= phStart - 1 && el.startIndex <= phStart + 4
  ) ?? tabContent3.find(el => el.table && el.startIndex >= phStart - 2);
  if (!finalTable) { console.warn(`  ⚠ Table ${ti}: cannot re-locate after fill`); continue; }

  // f. Bold header row
  // para.startIndex is the index of the paragraph's first content character.
  // Bold range: [si, ei-1] (exclude the trailing \n at ei-1).
  // Guard: ei - si > 1 ensures there is at least one non-\n character.
  const boldReqs = [];
  for (const cell of (finalTable.table.tableRows?.[0]?.tableCells ?? [])) {
    for (const para of (cell.content ?? [])) {
      const si = para.startIndex, ei = para.endIndex;
      if (si != null && ei != null && ei - si > 1) {
        boldReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1, tabId },
            textStyle: { bold: true },
            fields: 'bold',
          },
        });
      }
    }
  }
  if (boldReqs.length > 0) batchUpdate(boldReqs);

  // g. Borders + header shading
  const B = { color: optColor(0.75, 0.75, 0.75), width: { magnitude: 1, unit: 'PT' }, dashStyle: 'SOLID' };
  batchUpdate([
    {
      updateTableCellStyle: {
        tableStartLocation: { index: finalTable.startIndex, tabId },
        tableCellStyle: { borderTop: B, borderBottom: B, borderLeft: B, borderRight: B },
        fields: 'borderTop,borderBottom,borderLeft,borderRight',
      },
    },
    {
      updateTableCellStyle: {
        tableRange: {
          tableCellLocation: {
            tableStartLocation: { index: finalTable.startIndex, tabId },
            rowIndex: 0, columnIndex: 0,
          },
          rowSpan: 1, columnSpan: numCols,
        },
        tableCellStyle: { backgroundColor: optColor(0.898, 0.918, 0.965) },
        fields: 'backgroundColor',
      },
    },
  ]);

  // h. Column widths (sqrt-weighted — same algorithm as convert.js)
  const MIN_PT  = 40;
  const maxLens = Array(numCols).fill(1);
  for (const row of (tableEl.tableRows ?? [])) {
    (row.tableCells ?? []).forEach((cell, ci) => {
      const t = (cell.content ?? [])
        .flatMap(p => p.paragraph?.elements ?? [])
        .map(e => e.textRun?.content ?? '').join('').replace(/\s+/g, ' ').trim();
      if (t.length > maxLens[ci]) maxLens[ci] = t.length;
    });
  }
  const weights = maxLens.map(l => Math.sqrt(l));
  const total   = weights.reduce((a, b) => a + b, 0);
  let widths    = weights.map(w => Math.max(MIN_PT, Math.round((w / total) * pageWidthPt)));
  const sum     = widths.reduce((a, b) => a + b, 0);
  if (sum > pageWidthPt) {
    const s = pageWidthPt / sum;
    widths = widths.map(w => Math.max(MIN_PT, Math.round(w * s)));
  }
  batchUpdate(widths.map((magnitude, ci) => ({
    updateTableColumnProperties: {
      tableStartLocation: { index: finalTable.startIndex, tabId },
      columnIndices: [ci],
      tableColumnProperties: { widthType: 'FIXED_WIDTH', width: { magnitude, unit: 'PT' } },
      fields: 'width,widthType',
    },
  })));

  console.log(`  ✓ Table ${ti} (${numRows}×${numCols}) done`);
}

// ─── inline images note ───────────────────────────────────────────────────────

if (imageRecords.length > 0) {
  console.log(
    `\n  ℹ ${imageRecords.length} inline image(s) skipped — Drive has no API to copy embedded` +
    ' images between documents. Images appear as blank spaces in the tab; they render' +
    ' correctly in standalone docs created via convert.js.'
  );
}

// ─── Step 8: delete temp doc ──────────────────────────────────────────────────

console.log('\n[7/7] Deleting temp doc...');
try {
  run('gws', ['drive', 'files', 'delete', '--params', JSON.stringify({ fileId: tempDocId })], { silent: true });
  console.log('  ✓ Temp doc deleted');
} catch (e) {
  console.warn(`  ⚠ Could not delete temp doc: ${e.message}`);
  console.warn(`    Delete manually: https://drive.google.com/file/d/${tempDocId}`);
}

const url = `https://docs.google.com/document/d/${docId}/edit`;
console.log(`\n✓ Done!  ${url}\n`);
