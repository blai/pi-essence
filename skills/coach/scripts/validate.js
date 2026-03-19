#!/usr/bin/env node
/**
 * validate.js — Standalone SKILL.md validator
 *
 * Validates a SKILL.md file against the Agent Skills specification and
 * pi's additional constraints, with quality warnings and hints.
 *
 * Usage:
 *   node skills/coach/scripts/validate.js <path-to-SKILL.md>
 *   node skills/coach/scripts/validate.js skills/my-skill/SKILL.md
 *
 * Exit codes:
 *   0 — valid (no errors; warnings/hints may still exist)
 *   1 — invalid (one or more errors found)
 *   2 — usage error
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(content) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;

	const yaml = match[1];
	const result = {};
	const lines = yaml.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1 || line.startsWith("#")) {
			i++;
			continue;
		}

		const key = line.slice(0, colonIdx).trim();
		const rest = line.slice(colonIdx + 1).trim();

		if (rest === ">" || rest === "|" || rest === "") {
			const style = rest;
			const valueLines = [];
			i++;
			while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t") || lines[i].trim() === "")) {
				valueLines.push(lines[i].trim());
				i++;
			}
			while (valueLines.length && valueLines[0] === "") valueLines.shift();
			while (valueLines.length && valueLines[valueLines.length - 1] === "") valueLines.pop();
			result[key] = style === "|" ? valueLines.join("\n") : valueLines.join(" ");
		} else {
			result[key] = rest.replace(/^['"]|['"]$/g, "");
			i++;
		}
	}

	return result;
}

// ─── Validator ────────────────────────────────────────────────────────────────

function validate(filePath) {
	const issues = [];
	const error = (msg) => issues.push({ severity: "error", message: msg });
	const warn = (msg) => issues.push({ severity: "warning", message: msg });
	const hint = (msg) => issues.push({ severity: "hint", message: msg });

	// Read file
	let content;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch (e) {
		return { valid: false, issues: [{ severity: "error", message: `Cannot read file: ${e.message}` }] };
	}

	// File name check
	if (path.basename(filePath) !== "SKILL.md") {
		warn(`File is named "${path.basename(filePath)}" — must be exactly "SKILL.md" (case-sensitive)`);
	}

	// Frontmatter
	if (!content.match(/^---\r?\n/)) {
		error("Missing YAML frontmatter — file must start with ---");
		return { valid: false, issues };
	}
	if (!content.match(/^---\r?\n[\s\S]*?\r?\n---/)) {
		error("Frontmatter block is not closed — add a closing ---");
		return { valid: false, issues };
	}

	const fm = parseFrontmatter(content);
	if (!fm) {
		error("Could not parse YAML frontmatter");
		return { valid: false, issues };
	}

	// name
	if (!fm.name) {
		error("Missing required field: name");
	} else {
		const n = fm.name;
		const errs = [];
		if (n.length > 64) errs.push(`exceeds 64-char limit (${n.length} chars)`);
		if (!/^[a-z0-9]/.test(n)) errs.push("must start with a lowercase letter or digit");
		if (n.length > 1 && !/[a-z0-9]$/.test(n)) errs.push("must end with a lowercase letter or digit");
		if (/[^a-z0-9-]/.test(n)) errs.push("only lowercase letters, digits, and hyphens allowed");
		if (/--/.test(n)) errs.push("consecutive hyphens (--) not allowed");

		if (errs.length) {
			error(`name "${n}" is invalid: ${errs.join("; ")}`);
		} else {
			const dirName = path.basename(path.dirname(path.resolve(filePath)));
			if (dirName !== n) {
				error(`name "${n}" must match directory name "${dirName}" — pi refuses mismatched skills`);
			}
		}
	}

	// description
	if (!fm.description) {
		error("Missing required field: description — pi will NOT load the skill without it");
	} else {
		const d = fm.description;
		if (d.length > 1024) error(`description is ${d.length} chars — exceeds 1024-char limit`);
		if (d.length < 40) warn(`description is very short (${d.length} chars) — be specific about trigger conditions`);
		else if (d.length < 80) hint("description could be more detailed — add specific trigger phrases");

		if (!/(use (this|when)|when (the user|asked|someone)|triggers? when)/i.test(d)) {
			hint('Add "Use this skill when..." — agents need explicit trigger conditions to auto-activate');
		}
		if (/<[a-z/]/.test(d)) {
			warn("description contains XML-like angle brackets — may be treated as prompt injection");
		}
	}

	// Optional fields
	if (fm["disable-model-invocation"] === "true") {
		hint("disable-model-invocation: true — skill only runs via /skill:" + (fm.name || "name") + ", never auto-triggered");
	}
	if (fm["allowed-tools"]) {
		hint(`allowed-tools is experimental in pi — enforcement not guaranteed`);
	}

	// Body quality
	const fmEnd = content.indexOf("\n---", 3);
	const body = fmEnd !== -1 ? content.slice(fmEnd + 4).trim() : "";

	if (body.length < 50) {
		warn("Skill body is very short — add setup, workflow, and gotchas sections");
	} else {
		const lineCount = body.split("\n").length;
		if (lineCount > 500) {
			warn(`Body is ${lineCount} lines — spec recommends ≤500. Move reference material to references/ for progressive disclosure`);
		}
		if (!/#{1,3}\s*(usage|how to|workflow|steps|procedure|process|instructions?)/i.test(body)) {
			hint('Add a "## Workflow" or "## Usage" section with numbered steps');
		}
		if (lineCount > 200 && !/#{1,3}\s*(gotcha|pitfall|caveat|warning|common mistake|trap)/i.test(body)) {
			hint('Add a "## Gotchas" section for non-obvious behaviors and common agent mistakes');
		}
		if (/TODO:|FIXME:|<YOUR |your-description/i.test(body)) {
			warn("Body contains unfilled placeholder text — fill these in before shipping");
		}
	}

	const valid = !issues.some((i) => i.severity === "error");
	return { valid, issues };
}

// ─── Output formatting ────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function colorize(text, ...codes) {
	return process.stdout.isTTY ? `${codes.join("")}${text}${RESET}` : text;
}

function printResult(filePath, result) {
	const { valid, issues } = result;
	const errors = issues.filter((i) => i.severity === "error");
	const warnings = issues.filter((i) => i.severity === "warning");
	const hints = issues.filter((i) => i.severity === "hint");

	const status = valid ? colorize("✅ VALID", BOLD, GREEN) : colorize("❌ INVALID", BOLD, RED);
	console.log(`\n${status}  ${colorize(filePath, BOLD)}`);

	const parts = [];
	if (errors.length) parts.push(colorize(`${errors.length} error${errors.length > 1 ? "s" : ""}`, RED));
	if (warnings.length) parts.push(colorize(`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`, YELLOW));
	if (hints.length) parts.push(colorize(`${hints.length} hint${hints.length > 1 ? "s" : ""}`, CYAN));
	if (parts.length) console.log(`       ${parts.join("  ")}`);

	if (issues.length) console.log();

	for (const issue of errors) {
		console.log(colorize("  ✗ ", BOLD, RED) + issue.message);
	}
	for (const issue of warnings) {
		console.log(colorize("  ⚠ ", BOLD, YELLOW) + issue.message);
	}
	for (const issue of hints) {
		console.log(colorize("  → ", DIM, CYAN) + colorize(issue.message, DIM));
	}

	if (!issues.length) {
		console.log(colorize("  All checks passed", GREEN));
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error(`Usage: node ${path.basename(process.argv[1])} <SKILL.md> [SKILL.md ...]`);
	console.error("       node validate.js skills/my-skill/SKILL.md");
	process.exit(2);
}

let anyInvalid = false;
for (const arg of args) {
	const filePath = path.resolve(arg);
	const result = validate(filePath);
	printResult(arg, result);
	if (!result.valid) anyInvalid = true;
}

console.log();
process.exit(anyInvalid ? 1 : 0);
