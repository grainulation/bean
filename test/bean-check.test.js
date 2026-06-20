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
const VERIFY_BIN = path.join(root, "bin", "bean-verify.js");

// portable oracle commands (exit 0 = pass, 1 = fail) — no reliance on /bin/true
const PASS_CMD = [process.execPath, "-e", "process.exit(0)"];
const FAIL_CMD = [process.execPath, "-e", "process.exit(1)"];

/** @param {string} dir @param {string} claim @param {string} verifier @returns {number} */
const verify = (dir, claim, verifier) => {
	const r = spawnSync(
		process.execPath,
		[VERIFY_BIN, "--dir", dir, "--claim", claim, "--verifier", verifier],
		{ encoding: "utf8" },
	);
	if (r.error) throw r.error;
	return r.status ?? -1;
};

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
	// 1.2.0: a claim depending on a superseded/inactive claim is stale (TMS propagation)
	{
		f: "stale-dependent",
		status: "blocked",
		exit: 1,
		code: "E_STALE_DEPENDENT",
	},
	// 1.2.0: a `residual` tag without a stated reason is a silent punt -> does not discharge
	{ f: "residual-no-reason", status: "blocked", exit: 1, code: "E_OPEN_RISK" },
	// 1.2.0: a `residual` WITH a reason genuinely discharges -> ready
	{ f: "residual-with-reason", status: "ready", exit: 0 },
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

// --- 1.1.2 regressions (found by the Codex review) ---
check("partial run.json does not disable the other evidence bar", () => {
	const dir = tmpFixture({
		"claims.json": [
			{
				id: "c1",
				type: "recommendation",
				topic: "x",
				content: "do X",
				evidence: "web",
			},
		],
		"run.json": { evidence_bar: { load_bearing: "production" } },
	});
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "blocked");
	assert.ok(result.blockers.some((b) => b.code === "E_WEAK_LOADBEARING"));
	assert.equal(exit, 1);
});

check("malformed claims yield E_SCHEMA, not a crash", () => {
	const dir = tmpFixture({
		"claims.json": [
			null,
			{ id: "c1", type: "nope", topic: "x", evidence: "tested" },
			{
				id: "c2",
				type: "factual",
				topic: "x",
				content: "ok",
				evidence: "tested",
				conflicts_with: 7,
			},
		],
	});
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "blocked");
	assert.ok(result.blockers.some((b) => b.code === "E_SCHEMA"));
	assert.equal(exit, 1);
});

check("in-place revision counts as progress (not a dry round)", () => {
	const dir = tmpFixture({
		"claims.json": [
			{
				id: "c1",
				type: "factual",
				topic: "t",
				content: "v1",
				evidence: "tested",
			},
		],
	});
	run(dir);
	fs.writeFileSync(
		path.join(dir, ".bean", "claims.json"),
		JSON.stringify(
			[
				{
					id: "c1",
					type: "factual",
					topic: "t",
					content: "v2 revised",
					evidence: "tested",
				},
			],
			null,
			2,
		),
	);
	const second = run(dir);
	assert.equal(
		second.result.dry,
		false,
		"an in-place content change must not read as dry",
	);
	assert.equal(second.result.round, 2);
});

check("over budget with an open blocker -> budget-exceeded (exit 2)", () => {
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
	assert.ok(
		result.blockers.some((b) => b.code === "E_OPEN_RISK"),
		"the blocker is still reported",
	);
});

check("--dir with a missing value exits 3 (not a stack trace)", () => {
	const r = spawnSync(process.execPath, [BIN, "--dir", "--json"], {
		encoding: "utf8",
	});
	assert.equal(r.status, 3);
});

// --- 1.2.0 regressions: depends_on edge cases (found by Codex review) ---
check("non-array depends_on does not fail open (E_SCHEMA)", () => {
	const dir = tmpFixture({
		"claims.json": [
			{
				id: "c1",
				type: "factual",
				topic: "t",
				content: "x",
				evidence: "tested",
				status: "superseded",
			},
			{
				id: "c2",
				type: "recommendation",
				topic: "t",
				content: "do",
				evidence: "tested",
				depends_on: "c1",
			},
		],
	});
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "blocked");
	assert.ok(result.blockers.some((b) => b.code === "E_SCHEMA"));
	assert.equal(exit, 1);
});
check("self depends_on is stale (E_STALE_DEPENDENT)", () => {
	const dir = tmpFixture({
		"claims.json": [
			{
				id: "c1",
				type: "recommendation",
				topic: "t",
				content: "do",
				evidence: "tested",
				depends_on: ["c1"],
			},
		],
	});
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "blocked");
	assert.ok(result.blockers.some((b) => b.code === "E_STALE_DEPENDENT"));
	assert.equal(exit, 1);
});

// --- 2.0: the oracle gate (modes, verdicts, freshness, converged-with-residuals) ---

/** @param {string} id @param {Record<string, unknown>} [extra] @returns {Record<string, unknown>} */
const lbClaim = (id, extra = {}) => ({
	id,
	type: "factual",
	topic: "t",
	content: `claim ${id}`,
	evidence: "tested",
	tags: ["load-bearing"],
	...extra,
});

check("compat (default) ignores the oracle gate -> ready", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1")], // load-bearing, no verifier
	});
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "ready");
	assert.equal(exit, 0);
	assert.equal(result.verification.mode, "compat");
});

check(
	"strict: load-bearing claim with no verifier/residual -> E_UNVERIFIED_LOADBEARING",
	() => {
		const dir = tmpFixture({
			"claims.json": [lbClaim("c1")],
			"run.json": { verification: { mode: "strict" } },
		});
		const { exit, result } = run(dir, ["--no-state"]);
		assert.equal(result.status, "blocked");
		assert.equal(exit, 1);
		assert.ok(
			result.blockers.some((b) => b.code === "E_UNVERIFIED_LOADBEARING"),
		);
	},
);

check("strict: verified_by an undeclared oracle -> E_ORACLE_UNDECLARED", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1", { verified_by: { verifier: "ghost" } })],
		"run.json": { verification: { mode: "strict" }, oracles: {} },
	});
	const { result } = run(dir, ["--no-state"]);
	assert.ok(result.blockers.some((b) => b.code === "E_ORACLE_UNDECLARED"));
});

check(
	"strict: declared verifier but no recorded verdict -> E_VERIFY_ERROR",
	() => {
		const dir = tmpFixture({
			"claims.json": [lbClaim("c1", { verified_by: { verifier: "unit" } })],
			"run.json": {
				verification: { mode: "strict" },
				oracles: { unit: { cmd: PASS_CMD } },
			},
		});
		const { result } = run(dir, ["--no-state"]);
		assert.ok(result.blockers.some((b) => b.code === "E_VERIFY_ERROR"));
	},
);

check("strict: a recorded PASS verdict converges -> ready (exit 0)", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1", { verified_by: { verifier: "unit" } })],
		"run.json": {
			verification: { mode: "strict" },
			oracles: { unit: { cmd: PASS_CMD } },
		},
	});
	assert.equal(verify(dir, "c1", "unit"), 0); // bean-verify records a pass
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "ready");
	assert.equal(exit, 0);
	assert.equal(result.verification.verified, 1);
});

check(
	"strict: a load-bearing residual -> converged-with-residuals (exit 4)",
	() => {
		const dir = tmpFixture({
			"claims.json": [
				{
					id: "c1",
					type: "recommendation",
					topic: "plan",
					content: "adopt X — judgment call, no automated oracle exists",
					evidence: "documented",
					tags: ["residual"],
				},
			],
			"run.json": { verification: { mode: "strict" } },
		});
		const { exit, result } = run(dir, ["--no-state"]);
		assert.equal(result.status, "converged-with-residuals");
		assert.equal(exit, 4);
		assert.equal(result.verification.residual, 1);
	},
);

check("strict: a recorded FAIL verdict -> E_ORACLE_FAILED (exit 1)", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1", { verified_by: { verifier: "unit" } })],
		"run.json": {
			verification: { mode: "strict" },
			oracles: { unit: { cmd: FAIL_CMD } },
		},
	});
	assert.equal(verify(dir, "c1", "unit"), 1); // bean-verify records a fail
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "blocked");
	assert.equal(exit, 1);
	assert.ok(result.blockers.some((b) => b.code === "E_ORACLE_FAILED"));
});

check(
	"strict: editing a claim after a pass makes the verdict stale -> E_ORACLE_STALE",
	() => {
		const dir = tmpFixture({
			"claims.json": [lbClaim("c1", { verified_by: { verifier: "unit" } })],
			"run.json": {
				verification: { mode: "strict" },
				oracles: { unit: { cmd: PASS_CMD } },
			},
		});
		verify(dir, "c1", "unit"); // pass recorded against current content
		// revise the claim content after verification -> claim_binding no longer matches
		fs.writeFileSync(
			path.join(dir, ".bean", "claims.json"),
			JSON.stringify([
				lbClaim("c1", {
					content: "claim c1 REVISED after the verdict",
					verified_by: { verifier: "unit" },
				}),
			]),
		);
		const { result } = run(dir, ["--no-state"]);
		assert.ok(result.blockers.some((b) => b.code === "E_ORACLE_STALE"));
	},
);

check("advisory: a missing verifier warns but does not block", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1")],
		"run.json": { verification: { mode: "advisory" } },
	});
	const { exit, result } = run(dir, ["--no-state"]);
	assert.equal(result.status, "ready");
	assert.equal(exit, 0);
	assert.ok(result.warnings.some((w) => w.code === "W_UNVERIFIED_LOADBEARING"));
});

// H6: advisory must PRESERVE the specific failure, not flatten it to a generic warning
check(
	"advisory: a FAILED verdict warns as W_ORACLE_FAILED (detail preserved)",
	() => {
		const dir = tmpFixture({
			"claims.json": [lbClaim("c1", { verified_by: { verifier: "unit" } })],
			"run.json": {
				verification: { mode: "advisory" },
				oracles: { unit: { cmd: FAIL_CMD } },
			},
		});
		verify(dir, "c1", "unit");
		const { exit, result } = run(dir, ["--no-state"]);
		assert.equal(result.status, "ready");
		assert.equal(exit, 0);
		assert.ok(result.warnings.some((w) => w.code === "W_ORACLE_FAILED"));
	},
);

// H1: changing the oracle command after a PASS makes the verdict stale
check("strict: changing the oracle cmd after a pass -> E_ORACLE_STALE", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1", { verified_by: { verifier: "unit" } })],
		"run.json": {
			verification: { mode: "strict" },
			oracles: { unit: { cmd: PASS_CMD } },
		},
	});
	verify(dir, "c1", "unit");
	fs.writeFileSync(
		path.join(dir, ".bean", "run.json"),
		JSON.stringify({
			verification: { mode: "strict" },
			oracles: { unit: { cmd: [process.execPath, "-e", "0"] } },
		}),
	);
	const { result } = run(dir, ["--no-state"]);
	assert.ok(result.blockers.some((b) => b.code === "E_ORACLE_STALE"));
});

// H2: a verifier name resolving via Object.prototype (e.g. "toString") is NOT a bypass
check(
	"strict: prototype-name verifier (toString) is undeclared, not a bypass",
	() => {
		const dir = tmpFixture({
			"claims.json": [lbClaim("c1", { verified_by: { verifier: "toString" } })],
			"run.json": { verification: { mode: "strict" }, oracles: {} },
		});
		const { result } = run(dir, ["--no-state"]);
		assert.ok(result.blockers.some((b) => b.code === "E_ORACLE_UNDECLARED"));
	},
);

// H3: a verdict file whose name is not the canonical <claim>.<verifier>.json is ignored
check("strict: a non-canonical verdict filename is not admitted", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1", { verified_by: { verifier: "unit" } })],
		"run.json": {
			verification: { mode: "strict" },
			oracles: { unit: { cmd: PASS_CMD } },
		},
	});
	const vdir = path.join(dir, ".bean", "verdicts");
	fs.mkdirSync(vdir, { recursive: true });
	fs.writeFileSync(
		path.join(vdir, "sneaky.json"),
		JSON.stringify({
			claim: "c1",
			verifier: "unit",
			verdict: "pass",
			oracle_digest: "x",
			inputs_hash: "x",
			claim_binding: "x",
		}),
	);
	const { result } = run(dir, ["--no-state"]);
	assert.ok(result.blockers.some((b) => b.code === "E_VERIFY_ERROR"));
});

// H5: a load-bearing claim that is BOTH verified_by (unsatisfied) AND a named residual falls
// back to residual (converged-with-residuals) with a warning that a failure was masked
check(
	"strict: residual fallback when the verifier is unsatisfied -> exit 4 + warning",
	() => {
		const dir = tmpFixture({
			"claims.json": [
				lbClaim("c1", {
					verified_by: { verifier: "ghost" },
					tags: ["load-bearing", "residual"],
					content:
						"c1 — residual: oracle ghost is not available here, and this is why",
				}),
			],
			"run.json": { verification: { mode: "strict" }, oracles: {} },
		});
		const { exit, result } = run(dir, ["--no-state"]);
		assert.equal(result.status, "converged-with-residuals");
		assert.equal(exit, 4);
		assert.ok(
			result.warnings.some((w) => w.code === "W_ORACLE_RESIDUAL_FALLBACK"),
		);
	},
);

// H4: bean-verify rejects ids that could escape the verdicts dir
check("bean-verify rejects a traversal id (exit 3)", () => {
	const dir = tmpFixture({
		"claims.json": [lbClaim("c1")],
		"run.json": { oracles: { unit: { cmd: PASS_CMD } } },
	});
	assert.equal(verify(dir, "../evil", "unit"), 3);
});

// H8: a plain 1.x ledger's certificate is unchanged by the (inert) 2.0 machinery
check(
	"certificate: an inert 2.0 path (compat, empty oracles) matches plain 1.x",
	() => {
		const claims = [lbClaim("c1"), { ...lbClaim("c2"), type: "constraint" }];
		const plain = run(tmpFixture({ "claims.json": claims }), ["--no-state"]);
		const inert = run(
			tmpFixture({
				"claims.json": claims,
				"run.json": { verification: { mode: "compat" }, oracles: {} },
			}),
			["--no-state"],
		);
		assert.equal(plain.result.certificate, inert.result.certificate);
	},
);

check(
	"certificate: a 2.0-verified ledger differs from its compat reading (binds the regime)",
	() => {
		const claims = [lbClaim("c1", { verified_by: { verifier: "unit" } })];
		const strictDir = tmpFixture({
			"claims.json": claims,
			"run.json": {
				verification: { mode: "strict" },
				oracles: { unit: { cmd: PASS_CMD } },
			},
		});
		verify(strictDir, "c1", "unit");
		const strict = run(strictDir, ["--no-state"]);
		const compatDir = tmpFixture({ "claims.json": claims });
		const compat = run(compatDir, ["--no-state"]);
		assert.notEqual(strict.result.certificate, compat.result.certificate);
		// determinism: a second strict read of the same ledger+verdict reproduces the cert
		const strict2 = run(strictDir, ["--no-state"]);
		assert.equal(strict.result.certificate, strict2.result.certificate);
	},
);

// --- oracle PATTERN: implied-post-condition over PERSISTED state (the over-trust fix) ---
// A naive snapshot oracle that checks only "the items the agent put in the wishlist are
// there" passes a wrong answer that left them in the cart. The pattern oracle re-reads the
// persisted state and checks the VERB's implied transition (moved => gone from cart AND in
// wishlist), catching the miss. Proven end-to-end through the real bean-verify/bean-check.
/** @returns {string} */
const moverOracle = () =>
	[
		"const fs=require('node:fs'),p=require('node:path');",
		// fresh read of PERSISTED state (rule 1), next to the ledger — never an in-session value
		"const s=JSON.parse(fs.readFileSync(p.join(process.cwd(),'.bean','state-log.json'),'utf8'));",
		// implied post-condition of 'move all from cart to wishlist' (rule 2): cart empty AND
		// every originally-carted item now in the wishlist
		"const moved=s.originally_in_cart.every(id=>s.wishlist.includes(id));",
		"const cartEmpty=s.cart.length===0;",
		"const ok=moved&&cartEmpty;",
		"process.stdout.write(JSON.stringify({verdict:ok?'pass':'fail'}));",
		"process.exit(ok?0:1);",
	].join("\n");

/** @param {{cart:number[],wishlist:number[]}} persisted @returns {string} */
const moverFixture = (persisted) => {
	const dir = tmpFixture({
		"claims.json": [
			lbClaim("c1", {
				type: "recommendation",
				topic: "move",
				content: "moved all items from the cart to the wishlist",
				verified_by: { verifier: "mover" },
			}),
		],
		"run.json": {
			verification: { mode: "strict" },
			oracles: { mover: { cmd: [process.execPath, "-e", moverOracle()] } },
		},
	});
	fs.writeFileSync(
		path.join(dir, ".bean", "state-log.json"),
		JSON.stringify({ originally_in_cart: [1, 2], ...persisted }),
	);
	return dir;
};

check(
	"pattern oracle catches a wrong answer a snapshot oracle would pass",
	() => {
		// WRONG persisted state: item 2 never left the cart (snapshot of 'wishlist has them' would pass)
		const dir = moverFixture({ cart: [2], wishlist: [1, 2] });
		assert.equal(verify(dir, "c1", "mover"), 1); // bean-verify records a fail
		const { exit, result } = run(dir, ["--no-state"]);
		assert.equal(result.status, "blocked");
		assert.equal(exit, 1);
		assert.ok(result.blockers.some((b) => b.code === "E_ORACLE_FAILED"));
	},
);

check(
	"pattern oracle passes the correct transition (cart emptied, items in wishlist)",
	() => {
		const dir = moverFixture({ cart: [], wishlist: [1, 2] });
		assert.equal(verify(dir, "c1", "mover"), 0);
		const { exit, result } = run(dir, ["--no-state"]);
		assert.equal(result.status, "ready");
		assert.equal(exit, 0);
	},
);

console.log(`\n${passed} checks passed`);
