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
console.log(`\n${pass}/${fixtures.length} fixtures match the reference`);
process.exit(fails.length ? 1 : 0);
