#!/usr/bin/env node
/**
 * convert.js — Markdown → Google Doc converter (native markdown import)
 *
 * Usage:
 *   node convert.js <input.md> [--title "Title"] [--folder-id ID] [--page-width 468] [--paged]
 *
 * Requirements:
 *   - gws CLI authenticated: gws auth login -s drive,docs
 *   - curl (for mermaid rendering)
 *
 * Pipeline:
 *   PRE   1. Replace ```mermaid blocks with placeholders; render PNGs via mermaid.ink;
 *              upload PNGs to Drive + make public → get stable URLs for insertInlineImage
 *         2. Upload .md as text/markdown → Drive auto-converts to Google Doc
 *              (native import gives real code blocks with per-token syntax highlighting)
 *   POST  3. Pageless mode
 *         4. Mermaid: find placeholders → delete text → insertInlineImage (full page width)
 *         5. Table borders + header shading
 *         6. Table column widths (sqrt-weighted)
 *   CLEAN 7. Delete temporary mermaid PNGs from Drive
 */
'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ─── CLI args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (!argv[0] || argv[0] === '--help') {
  console.error('Usage: node convert.js <input.md> [--title "Title"] [--folder-id ID] [--page-width 468] [--paged]');
  process.exit(1);
}

const inputFile = path.resolve(argv[0]);
if (!fs.existsSync(inputFile)) { console.error(`ERROR: File not found: ${inputFile}`); process.exit(1); }

let title       = path.basename(inputFile, path.extname(inputFile));
let folderId    = null;
let pageWidthPt = 468;
let paged       = false;

for (let i = 1; i < argv.length; i++) {
  if      (argv[i] === '--title'      && argv[i+1]) title       = argv[++i];
  else if (argv[i] === '--folder-id'  && argv[i+1]) folderId    = argv[++i];
  else if (argv[i] === '--page-width' && argv[i+1]) pageWidthPt = parseFloat(argv[++i]);
  else if (argv[i] === '--paged')                   paged       = true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0,2).join(' ')} failed:\n${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
}

function gwsJSON(args) {
  const out = run('gws', args).trim();
  try { return JSON.parse(out); } catch {
    const line = out.split('\n').find(l => l.startsWith('{'));
    if (line) return JSON.parse(line);
    throw new Error(`Unexpected gws output: ${out.slice(0, 200)}`);
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function optColor(r, g, b) {
  return { color: { rgbColor: { red: r, green: g, blue: b } } };
}

// ─── Mermaid: render PNG → upload to Drive → return public URL ────────────────
// insertInlineImage requires a publicly accessible URL; mermaid.ink URLs are
// blocked by Google's fetcher (Cloudflare bot protection). Hosting on Drive
// sidesteps this — Google can always fetch its own Drive files.

function renderMermaidPng(code, localPath) {
  const enc1 = Buffer.from(code).toString('base64url');
  const try1 = `https://mermaid.ink/img/${enc1}?type=png&width=2000`;

  for (const url of [try1, null, try1]) {          // primary → pause → retry
    if (url === null) { sleepMs(1500); continue; }
    const r = spawnSync('curl', ['-sL', '--max-time', '35', '-o', localPath, url]);
    if (r.status === 0 && fs.existsSync(localPath) && fs.statSync(localPath).size > 200) return true;
  }

  // Fallback: JSON-envelope encoding
  const enc2 = Buffer.from(JSON.stringify({ code, mermaid: { theme: 'default' } })).toString('base64url');
  const r2   = spawnSync('curl', ['-sL', '--max-time', '35', '-o', localPath,
                                  `https://mermaid.ink/img/${enc2}?type=png&width=2000`]);
  return r2.status === 0 && fs.existsSync(localPath) && fs.statSync(localPath).size > 200;
}

function uploadPngToDrive(localPath, name) {
  const file = JSON.parse(run('gws', [
    'drive', 'files', 'create',
    '--upload', localPath,
    '--upload-content-type', 'image/png',
    '--json', JSON.stringify({ name }),
  ]).trim());

  // Make publicly readable so insertInlineImage can fetch it
  run('gws', [
    'drive', 'permissions', 'create',
    '--params', JSON.stringify({ fileId: file.id }),
    '--json',   JSON.stringify({ role: 'reader', type: 'anyone' }),
  ]);

  // Drive direct-download URL — accessible without auth for public files
  return { fileId: file.id, url: `https://drive.google.com/uc?export=download&id=${file.id}` };
}

// ─── Pre-process: replace mermaid blocks with placeholders ───────────────────

function preprocessMarkdown(src) {
  const blocks = []; // { placeholder, code }
  let n = 0;
  const md = src.replace(/^```mermaid[ \t]*\r?\n([\s\S]*?)^```/gm, (_, code) => {
    n++;
    blocks.push({ placeholder: `MERMAID_PLACEHOLDER_${n}`, code: code.trim() });
    return `MERMAID_PLACEHOLDER_${n}\n\n`;
  });
  return { md, blocks };
}

// ─── Render + upload mermaid images ──────────────────────────────────────────

function prepareMermaidImages(blocks) {
  const images = {}; // placeholder → { fileId, url }
  for (const { placeholder, code } of blocks) {
    const n       = placeholder.split('_').pop();
    const pngName = `.mermaid-upload-${n}.png`;
    console.error(`  [mermaid ${n}] Rendering...`);
    const ok = renderMermaidPng(code, pngName);
    if (!ok) { console.error(`  [mermaid ${n}] ⚠ Render failed — placeholder stays as text`); continue; }

    console.error(`  [mermaid ${n}] Uploading to Drive...`);
    try {
      images[placeholder] = uploadPngToDrive(pngName, `mermaid-temp-${n}.png`);
      console.error(`  [mermaid ${n}] ✓ fileId=${images[placeholder].fileId}`);
    } finally {
      try { fs.unlinkSync(pngName); } catch {}
    }
  }
  return images;
}

// ─── Upload markdown natively → Google Doc ────────────────────────────────────

function uploadNative(mdContent) {
  const meta = { name: title, mimeType: 'application/vnd.google-apps.document' };
  if (folderId) meta.parents = [folderId];
  const localMd = '.md-gdoc-upload.md';
  fs.writeFileSync(localMd, mdContent, 'utf8');
  let out;
  try {
    out = run('gws', ['drive', 'files', 'create', '--upload', localMd,
                      '--upload-content-type', 'text/markdown',
                      '--json', JSON.stringify(meta)]).trim();
  } finally { try { fs.unlinkSync(localMd); } catch {} }
  const file = JSON.parse(out);
  if (!file.id) throw new Error(`Upload missing id: ${out}`);
  return file.id;
}

// ─── Post-processing requests ─────────────────────────────────────────────────

function pagelessRequest() {
  return { updateDocumentStyle: { documentStyle: { documentFormat: { documentMode: 'PAGELESS' } }, fields: 'documentFormat' } };
}

function mermaidRequests(content, images) {
  if (!Object.keys(images).length) return [];
  const found = [];
  for (const el of content) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements ?? [])
      .map(e => e.textRun?.content ?? '').join('').replace(/\n/g, '').trim();
    if (images[text]) found.push({ startIndex: el.startIndex, endIndex: el.endIndex, url: images[text].url });
  }
  found.sort((a, b) => b.startIndex - a.startIndex); // reverse order for stable indices
  const requests = [];
  for (const { startIndex, endIndex, url } of found) {
    requests.push({ deleteContentRange: { range: { startIndex, endIndex: endIndex - 1 } } });
    requests.push({ insertInlineImage: { location: { index: startIndex }, uri: url,
                                         objectSize: { width: { magnitude: pageWidthPt, unit: 'PT' } } } });
  }
  return requests;
}

function tableBorderRequests(content) {
  const requests = [];
  const B = { color: optColor(0.75, 0.75, 0.75), width: { magnitude: 1, unit: 'PT' }, dashStyle: 'SOLID' };
  for (const el of content) {
    if (!el.table) continue;
    requests.push({ updateTableCellStyle: { tableStartLocation: { index: el.startIndex },
      tableCellStyle: { borderTop: B, borderBottom: B, borderLeft: B, borderRight: B },
      fields: 'borderTop,borderBottom,borderLeft,borderRight' } });
    if ((el.table.tableRows ?? []).length > 0)
      requests.push({ updateTableCellStyle: {
        tableRange: { tableCellLocation: { tableStartLocation: { index: el.startIndex }, rowIndex: 0, columnIndex: 0 },
                      rowSpan: 1, columnSpan: el.table.columns },
        tableCellStyle: { backgroundColor: optColor(0.898, 0.918, 0.965) }, fields: 'backgroundColor' } });
  }
  return requests;
}

function tableWidthRequests(content) {
  const MIN_PT = 40, requests = [];
  for (const el of content) {
    if (!el.table) continue;
    const numCols = el.table.columns, maxLens = Array(numCols).fill(1);
    for (const row of (el.table.tableRows ?? []))
      (row.tableCells ?? []).forEach((cell, ci) => {
        const t = (cell.content ?? []).flatMap(p => p.paragraph?.elements ?? [])
          .map(e => e.textRun?.content ?? '').join('').replace(/\s+/g, ' ').trim();
        if (t.length > maxLens[ci]) maxLens[ci] = t.length;
      });
    const weights = maxLens.map(l => Math.sqrt(l)), total = weights.reduce((a,b) => a+b, 0);
    let widths = weights.map(w => Math.max(MIN_PT, Math.round((w/total) * pageWidthPt)));
    const sum = widths.reduce((a,b) => a+b, 0);
    if (sum > pageWidthPt) { const s = pageWidthPt/sum; widths = widths.map(w => Math.max(MIN_PT, Math.round(w*s))); }
    widths.forEach((magnitude, ci) => requests.push({ updateTableColumnProperties: {
      tableStartLocation: { index: el.startIndex }, columnIndices: [ci],
      tableColumnProperties: { widthType: 'FIXED_WIDTH', width: { magnitude, unit: 'PT' } },
      fields: 'width,widthType' } }));
  }
  return requests;
}

// ─── Cleanup: delete temp Drive files ────────────────────────────────────────

function cleanupDriveFiles(images) {
  for (const { fileId } of Object.values(images)) {
    try { run('gws', ['drive', 'files', 'delete', '--params', JSON.stringify({ fileId })]); }
    catch (e) { console.error(`  ⚠ Could not delete temp Drive file ${fileId}: ${e.message}`); }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.error(`\nmd-to-gdoc: "${path.basename(inputFile)}" → "${title}" (pageless: ${!paged})`);

  console.error('[1/3] Pre-processing...');
  const { md, blocks } = preprocessMarkdown(fs.readFileSync(inputFile, 'utf8'));
  const images = blocks.length ? prepareMermaidImages(blocks) : {};

  console.error('[2/3] Uploading (native markdown import)...');
  const docId = uploadNative(md);
  console.error(`  ✓ Doc ID: ${docId}`);

  console.error('[3/3] Post-processing...');

  const batchUpdate = (reqs) => run('gws', [
    'docs', 'documents', 'batchUpdate',
    '--params', JSON.stringify({ documentId: docId }),
    '--json',   JSON.stringify({ requests: reqs }),
  ]);

  // Pass 1: pageless + mermaid image insertion (these shift document indices)
  const doc1    = gwsJSON(['docs', 'documents', 'get', '--params', JSON.stringify({ documentId: docId })]);
  const pass1   = [
    ...(!paged ? [pagelessRequest()] : []),
    ...mermaidRequests(doc1.body?.content ?? [], images),
  ];
  if (pass1.length) { console.error(`  pass 1: ${pass1.length} request(s)...`); batchUpdate(pass1); }

  // Pass 2: table styling — refetch so indices reflect mermaid insertions
  const doc2    = gwsJSON(['docs', 'documents', 'get', '--params', JSON.stringify({ documentId: docId })]);
  const pass2   = [
    ...tableBorderRequests(doc2.body?.content ?? []),
    ...tableWidthRequests(doc2.body?.content ?? []),
  ];
  if (pass2.length) { console.error(`  pass 2: ${pass2.length} request(s)...`); batchUpdate(pass2); }

  if (Object.keys(images).length) {
    console.error('  cleaning up temp Drive files...');
    cleanupDriveFiles(images);
  }

  const url = `https://docs.google.com/document/d/${docId}/edit`;
  console.log(url);
  console.error(`\n✓ Done! ${url}\n`);
}

main();
