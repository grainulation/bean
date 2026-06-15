#!/usr/bin/env node
// @ts-check
/**
 * Behavioral test for bean-check — the convergence compiler.
 *
 * Static gates run against the curated fixtures in test/fixtures/ with --no-state
 * (idempotent). Temporal gates (budget, dry-round) are generated into a fresh tmp
 * dir so state writes never touch the repo. Zero dependencies.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(root, "bin", "bean-check.js");

let passed = 0;
/** @param {string} name @param {() => void} fn */
const check = (name, fn) => {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
};

/**
 * @param {string} dir
 * @param {string[]} [extra]
 * @returns {{ exit: number, result: import("../bin/bean-check.js").Result }}
 */
const run = (dir, extra = []) => {
	const r = spawnSync(
		process.execPath,
		[BIN, "--dir", dir, "--json", ...extra],
		{
			encoding: "utf8",
		},
	);
	if (r.error) throw r.error;
	return { exit: r.status ?? -1, result: JSON.parse(r.stdout) };
};

/** @param {Record<string, unknown>} files @returns {string} */
const tmpFixture = (files) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bean-check-"));
	const bean = path.join(dir, ".bean");
	fs.mkdirSync(bean);
	for (const [name, body] of Object.entries(files))
		fs.writeFileSync(path.join(bean, name), JSON.stringify(body, null, 2));
	return dir;
};

// --- static gates (curated fixtures, --no-state) ---
/** @type {Array<{ f: string, status: string, exit: number, code?: string }>} */
const cases = [
	{ f: "converged", status: "ready", exit: 0 },
	{ f: "unresolved-conflict", status: "blocked", exit: 1, code: "E_CONFLICT" },
	{ f: "open-risk", status: "blocked", exit: 1, code: "E_OPEN_RISK" },
	{
		f: "weak-loadbearing",
		status: "blocked",
		exit: 1,
		code: "E_WEAK_LOADBEARING",
	},
	{ f: "open-unknown", status: "blocked", exit: 1, code: "E_OPEN_UNKNOWN" },
	// regression: one-directional conflicts_with from the higher-lexical-id side (was dropped)
	{ f: "asymmetric-conflict", status: "blocked", exit: 1, code: "E_CONFLICT" },
	// regression: a risk cannot discharge itself (self id) or via a dangling resolved_by
	{ f: "self-discharge", status: "blocked", exit: 1, code: "E_OPEN_RISK" },
];
for (const c of cases)
	check(`${c.f} -> ${c.status} (exit ${c.exit})`, () => {
		const { exit, result } = run(path.join(root, "test", "fixtures", c.f), [
			"--no-state",
		]);
		assert.equal(result.status, c.status);
		assert.equal(exit, c.exit);
		if (c.code)
			assert.ok(
				result.blockers.some((b) => b.code === c.code),
				`expected blocker ${c.code}`,
			);
	});

// --- determinism: same active claim set -> same certificate ---
check("certificate is deterministic for the same claim set", () => {
	const a = run(path.join(root, "test", "fixtures", "converged"), [
		"--no-state",
	]);
	const b = run(path.join(root, "test", "fixtures", "converged"), [
		"--no-state",
	]);
	assert.equal(a.result.certificate, b.result.certificate);
});

check("certificate distinguishes different ledgers", () => {
	const a = run(path.join(root, "test", "fixtures", "converged"), [
		"--no-state",
	]);
	const b = run(path.join(root, "test", "fixtures", "open-risk"), [
		"--no-state",
	]);
	assert.notEqual(a.result.certificate, b.result.certificate);
});

// --- conflict resolution: strict-dominance hint vs genuine tie (fail-closed both ways) ---
check("dominance conflict -> blocked WITH a belief-revision hint", () => {
	const { exit, result } = run(
		path.join(root, "test", "fixtures", "dominance-conflict"),
		["--no-state"],
	);
	assert.equal(result.status, "blocked");
	assert.equal(exit, 1);
	const conf = result.blockers.find((b) => b.code === "E_CONFLICT");
	assert.ok(conf && conf.resolvable === true, "expected a resolvable conflict");
	assert.equal(conf.supersede, "c1");
	assert.equal(conf.keep, "c2");
});
check("equal-tier conflict -> genuine tie (never auto-resolvable)", () => {
	const { result } = run(
		path.join(root, "test", "fixtures", "unresolved-conflict"),
		["--no-state"],
	);
	const conf = result.blockers.find((b) => b.code === "E_CONFLICT");
	assert.ok(
		conf && conf.resolvable === false,
		"equal-tier conflict must stay a genuine tie",
	);
});

// --- temporal: budget exceeded -> exit 2 ---
check("budget exceeded -> budget-exceeded (exit 2)", () => {
	const dir = tmpFixture({
		"claims.json": [
			{
				id: "c1",
				type: "factual",
				topic: "t",
				content: "x",
				evidence: "tested",
				tags: ["load-bearing"],
			},
		],
		"run.json": { budget: { max_rounds: 1 } },
		"state.json": {
			round: 1,
			seen_ids: [],
			superseded_hashes: [],
			claims_hash: "seed",
		},
	});
	const { exit, result } = run(dir);
	assert.equal(result.status, "budget-exceeded");
	assert.equal(exit, 2);
});

// --- temporal: a second run with no new claims is a dry round ---
check("dry round detected on a converged ledger", () => {
	const dir = tmpFixture({
		"claims.json": [
			{
				id: "c1",
				type: "factual",
				topic: "t",
				content: "x",
				evidence: "tested",
			},
		],
	});
	const first = run(dir);
	assert.equal(first.result.dry, false);
	const second = run(dir);
	assert.equal(second.result.dry, true);
	assert.equal(second.result.status, "ready");
	assert.ok(second.result.notes.includes("DRY_ROUND_CONVERGED"));
});

// --- temporal: dry round with an open blocker is flagged stuck ---
check("dry round with an open risk is flagged stuck", () => {
	const dir = tmpFixture({
		"claims.json": [
			{
				id: "c1",
				type: "risk",
				topic: "t",
				content: "x",
				evidence: "documented",
			},
		],
	});
	run(dir);
	const second = run(dir);
	assert.equal(second.result.status, "blocked");
	assert.ok(second.result.notes.some((n) => n.startsWith("DRY_ROUND_STUCK")));
});

console.log(`\n${passed} checks passed`);
