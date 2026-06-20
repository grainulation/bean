#!/usr/bin/env node
// Differential conformance oracle — the bootstrap mechanic.
//
// The JS bean-check is the independent REFERENCE; the Rust port must MATCH it. For every
// static fixture we run both with --json --no-state and diff the behavior that the
// certificate is built from: status, the set of blocker codes, and the certificate itself.
// This is the oracle pattern applied to bean's own construction — independent vantage,
// spec-derived, fail-closed. It exits nonzero until Rust reproduces the reference.
//
//   node test/conformance.mjs            # build Rust (release) then diff every fixture
//
// Once this is green, Rust bean-check has earned the right to gate its own development
// (the self-hosting ratchet).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS = path.join(root, "bin", "bean-check.js");
const RS = path.join(root, "rs", "target", "release", "bean-check");
const FIX = path.join(root, "test", "fixtures");

// build the Rust binary (release) first
const build = spawnSync("cargo", ["build", "--release", "--quiet"], {
	cwd: path.join(root, "rs"),
	encoding: "utf8",
});
if (build.status !== 0) {
	console.error(
		"cargo build failed:\n" + (build.stderr || build.error?.message),
	);
	process.exit(3);
}

/** @param {string} bin @param {string[]} argv */
const run = (bin, argv) => {
	const r = spawnSync(bin, argv, { encoding: "utf8" });
	return JSON.parse(r.stdout);
};
/** @param {{status:string,blockers:{code:string}[],certificate:string}} r */
const shape = (r) => ({
	status: r.status,
	codes: r.blockers.map((b) => b.code).sort(),
	cert: r.certificate,
});

const fixtures = fs
	.readdirSync(FIX, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name)
	.sort();

let pass = 0;
const fails = [];
for (const f of fixtures) {
	const dir = path.join(FIX, f);
	const ref = shape(
		run(process.execPath, [JS, "--dir", dir, "--json", "--no-state"]),
	);
	const got = shape(run(RS, ["--dir", dir, "--json", "--no-state"]));
	const ok =
		ref.status === got.status &&
		JSON.stringify(ref.codes) === JSON.stringify(got.codes) &&
		ref.cert === got.cert;
	if (ok) {
		pass++;
		console.log(`  ok    ${f}  (${got.status}, cert ${got.cert})`);
	} else {
		fails.push(f);
		console.log(`  DIFF  ${f}`);
		console.log(`        ref: ${JSON.stringify(ref)}`);
		console.log(`        rs : ${JSON.stringify(got)}`);
	}
}
console.log(`\n${pass}/${fixtures.length} static fixtures match the reference`);

// ---- temporal conformance (stateful: state.json / dry-round / budget) ----
// Each engine runs in its OWN dir so they never read each other's state.json. We run the
// scenario N times and compare the final result + the persisted state, parsed.
import os from "node:os";
/** @param {string} bin @param {string[]} pre @param {Record<string,unknown>} files @param {number} times */
const stateful = (pre, files, times) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bean-conf-"));
	fs.mkdirSync(path.join(dir, ".bean"));
	for (const [n, body] of Object.entries(files))
		fs.writeFileSync(path.join(dir, ".bean", n), JSON.stringify(body, null, 2));
	let last;
	for (let k = 0; k < times; k++) {
		const r = spawnSync(pre[0], [...pre.slice(1), "--dir", dir, "--json"], {
			encoding: "utf8",
		});
		last = { result: JSON.parse(r.stdout), exit: r.status };
	}
	const st = JSON.parse(
		fs.readFileSync(path.join(dir, ".bean", "state.json"), "utf8"),
	);
	return { ...last, state: st };
};
/** @param {{result:any,exit:number,state:any}} o */
const tshape = (o) => ({
	status: o.result.status,
	round: o.result.round,
	dry: o.result.dry,
	notes: [...o.result.notes].sort(),
	cert: o.result.certificate,
	exit: o.exit,
	st_round: o.state.round,
	st_hash: o.state.claims_hash,
	st_seen: [...o.state.seen_ids].sort(),
	st_sup: [...o.state.superseded_hashes].sort(),
});

const SCENARIOS = [
	{
		name: "budget-exceeded",
		files: {
			"claims.json": [
				{
					id: "c1",
					type: "factual",
					topic: "t",
					content: "x",
					evidence: "tested",
				},
			],
			"run.json": { budget: { max_rounds: 1 } },
			"state.json": {
				round: 1,
				seen_ids: [],
				superseded_hashes: [],
				claims_hash: "seed",
			},
		},
		times: 1,
	},
	{
		name: "dry-round-converged",
		files: {
			"claims.json": [
				{
					id: "c1",
					type: "factual",
					topic: "t",
					content: "x",
					evidence: "tested",
				},
			],
		},
		times: 2,
	},
	{
		name: "dry-round-stuck",
		files: {
			"claims.json": [
				{
					id: "c1",
					type: "risk",
					topic: "t",
					content: "x",
					evidence: "documented",
				},
			],
		},
		times: 2,
	},
];

let tpass = 0;
for (const sc of SCENARIOS) {
	const ref = tshape(stateful([process.execPath, JS], sc.files, sc.times));
	const got = tshape(stateful([RS], sc.files, sc.times));
	const ok = JSON.stringify(ref) === JSON.stringify(got);
	if (ok) {
		tpass++;
		console.log(
			`  ok    ${sc.name}  (${got.status}, round ${got.round}, cert ${got.cert})`,
		);
	} else {
		fails.push(sc.name);
		console.log(`  DIFF  ${sc.name}`);
		console.log(`        ref: ${JSON.stringify(ref)}`);
		console.log(`        rs : ${JSON.stringify(got)}`);
	}
}
console.log(
	`${tpass}/${SCENARIOS.length} temporal scenarios match the reference`,
);

// ---- driver smoke (bean-run): the coupling works, behaviorally ----
// Not a differential (the JS driver lives on js-reference); a behavioral check that the Rust
// driver drives an agent to convergence on the injected signal, and stops STUCK on no progress.
const RUN = path.join(root, "rs", "target", "release", "bean-run");
const agentScript = (body) => {
	const p = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "bean-agent-")),
		"a.js",
	);
	fs.writeFileSync(p, body);
	return `${process.execPath} ${p}`;
};
const DISCHARGE = agentScript(
	"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=/E_OPEN_RISK r1/.test(s);" +
		"process.stdout.write(a?JSON.stringify([{id:'r1',type:'risk',topic:'t',content:'residual: unreachable from here, named',evidence:'documented',tags:['residual']}]):'[]');});",
);
const INERT = agentScript(
	"process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('[]'));",
);
/** @param {string} agent @param {string} claims */
const drive = (agent, claims) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bean-drive-"));
	fs.mkdirSync(path.join(dir, ".bean"));
	fs.writeFileSync(path.join(dir, ".bean", "claims.json"), claims);
	fs.writeFileSync(
		path.join(dir, ".bean", "run.json"),
		JSON.stringify({ goal: "x" }),
	);
	const r = spawnSync(
		RUN,
		["--dir", dir, "--agent", agent, "--max-rounds", "5", "--json"],
		{
			encoding: "utf8",
		},
	);
	return { exit: r.status, report: JSON.parse(r.stdout) };
};
let dpass = 0;
const OPEN_RISK = JSON.stringify([
	{
		id: "r1",
		type: "risk",
		topic: "t",
		content: "a concern",
		evidence: "documented",
	},
]);
for (const [name, agent, want, exit] of [
	["driver converges (discharging agent)", DISCHARGE, "ready", 0],
	["driver stops stuck (inert agent)", INERT, "stuck", 5],
]) {
	const { exit: got, report } = drive(agent, OPEN_RISK);
	if (report.outcome === want && got === exit) {
		dpass++;
		console.log(`  ok    ${name}`);
	} else {
		fails.push(name);
		console.log(
			`  DIFF  ${name}: got ${report.outcome}/${got}, want ${want}/${exit}`,
		);
	}
}
console.log(`${dpass}/2 driver smoke checks pass`);

// ---- oracle-gate behavior (bean-check 2.0 + bean-verify) ----
// No JS reference for the gate on this branch, so these are assertion-based behavioral checks.
const VERIFY = path.join(root, "rs", "target", "release", "bean-verify");
const PASS_CMD = [process.execPath, "-e", "process.exit(0)"];
const FAIL_CMD = [process.execPath, "-e", "process.exit(1)"];
/** @param {Record<string,unknown>} files @param {{claim:string,verifier:string}[]} verifyFirst */
const gate = (files, verifyFirst = []) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bean-gate-"));
	fs.mkdirSync(path.join(dir, ".bean"));
	for (const [n, body] of Object.entries(files))
		fs.writeFileSync(path.join(dir, ".bean", n), JSON.stringify(body, null, 2));
	for (const v of verifyFirst)
		spawnSync(
			VERIFY,
			["--dir", dir, "--claim", v.claim, "--verifier", v.verifier],
			{ encoding: "utf8" },
		);
	const r = spawnSync(RS, ["--dir", dir, "--json", "--no-state"], {
		encoding: "utf8",
	});
	return { exit: r.status, result: JSON.parse(r.stdout) };
};
const lb = (id, extra = {}) => ({
	id,
	type: "factual",
	topic: "t",
	content: `claim ${id}`,
	evidence: "tested",
	tags: ["load-bearing"],
	...extra,
});
const GATE_CASES = [
	{
		name: "strict: load-bearing, no verifier, no residual -> E_UNVERIFIED_LOADBEARING (1)",
		files: {
			"claims.json": [lb("c1")],
			"run.json": { verification: { mode: "strict" } },
		},
		want: { status: "blocked", exit: 1, code: "E_UNVERIFIED_LOADBEARING" },
	},
	{
		name: "strict: verified_by an undeclared oracle -> E_ORACLE_UNDECLARED",
		files: {
			"claims.json": [lb("c1", { verified_by: { verifier: "ghost" } })],
			"run.json": { verification: { mode: "strict" }, oracles: {} },
		},
		want: { status: "blocked", exit: 1, code: "E_ORACLE_UNDECLARED" },
	},
	{
		name: "strict: declared oracle PASS -> ready (0)",
		files: {
			"claims.json": [lb("c1", { verified_by: { verifier: "unit" } })],
			"run.json": {
				verification: { mode: "strict" },
				oracles: { unit: { cmd: PASS_CMD } },
			},
		},
		verify: [{ claim: "c1", verifier: "unit" }],
		want: { status: "ready", exit: 0 },
	},
	{
		name: "strict: declared oracle FAIL -> E_ORACLE_FAILED (1)",
		files: {
			"claims.json": [lb("c1", { verified_by: { verifier: "unit" } })],
			"run.json": {
				verification: { mode: "strict" },
				oracles: { unit: { cmd: FAIL_CMD } },
			},
		},
		verify: [{ claim: "c1", verifier: "unit" }],
		want: { status: "blocked", exit: 1, code: "E_ORACLE_FAILED" },
	},
	{
		name: "strict: load-bearing residual -> converged-with-residuals (4)",
		files: {
			"claims.json": [
				{
					id: "c1",
					type: "recommendation",
					topic: "p",
					content: "judgment call, no oracle exists",
					evidence: "documented",
					tags: ["residual"],
				},
			],
			"run.json": { verification: { mode: "strict" } },
		},
		want: { status: "converged-with-residuals", exit: 4 },
	},
	{
		name: "advisory: no verifier -> ready (0) + W_UNVERIFIED_LOADBEARING",
		files: {
			"claims.json": [lb("c1")],
			"run.json": { verification: { mode: "advisory" } },
		},
		want: { status: "ready", exit: 0, warn: "W_UNVERIFIED_LOADBEARING" },
	},
	{
		name: "compat: gate inert -> ready (0)",
		files: {
			"claims.json": [lb("c1")],
			"run.json": { verification: { mode: "compat" } },
		},
		want: { status: "ready", exit: 0 },
	},
];
let gpass = 0;
for (const c of GATE_CASES) {
	const { exit, result } = gate(c.files, c.verify || []);
	const codes = result.blockers.map((b) => b.code);
	const warns = (result.warnings || []).map((w) => w.code);
	const ok =
		result.status === c.want.status &&
		exit === c.want.exit &&
		(!c.want.code || codes.includes(c.want.code)) &&
		(!c.want.warn || warns.includes(c.want.warn));
	if (ok) {
		gpass++;
		console.log(`  ok    ${c.name}`);
	} else {
		fails.push(c.name);
		console.log(
			`  DIFF  ${c.name}: got status=${result.status} exit=${exit} codes=${JSON.stringify(codes)} warns=${JSON.stringify(warns)}`,
		);
	}
}
// bean-verify exit codes
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bean-vexit-"));
	fs.mkdirSync(path.join(dir, ".bean"));
	fs.writeFileSync(
		path.join(dir, ".bean", "claims.json"),
		JSON.stringify([lb("c1")]),
	);
	fs.writeFileSync(
		path.join(dir, ".bean", "run.json"),
		JSON.stringify({ oracles: { p: { cmd: PASS_CMD }, f: { cmd: FAIL_CMD } } }),
	);
	const pe = spawnSync(VERIFY, [
		"--dir",
		dir,
		"--claim",
		"c1",
		"--verifier",
		"p",
	]).status;
	const fe = spawnSync(VERIFY, [
		"--dir",
		dir,
		"--claim",
		"c1",
		"--verifier",
		"f",
	]).status;
	if (pe === 0 && fe === 1) {
		gpass++;
		console.log("  ok    bean-verify exit codes (pass 0 / fail 1)");
	} else {
		fails.push("bean-verify exit codes");
		console.log(`  DIFF  bean-verify exit codes: pass=${pe} fail=${fe}`);
	}
}
console.log(
	`${gpass}/${GATE_CASES.length + 1} oracle-gate behavior checks pass`,
);

const total = pass + tpass + dpass + gpass;
const totalN = fixtures.length + SCENARIOS.length + 2 + GATE_CASES.length + 1;
console.log(`\n${total}/${totalN} conformance + driver + gate checks pass`);
process.exit(fails.length ? 1 : 0);
