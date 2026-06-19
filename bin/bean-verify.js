#!/usr/bin/env node
// @ts-check
/**
 * bean-verify — the (only) execution path for bean 2.0 oracles.
 *
 * bean-check is a PURE ADJUDICATOR: it reads recorded verdicts and never runs
 * anything. bean-verify is the quarantined, opt-in counterpart that actually
 * RUNS a declared oracle command and DEPOSITS a verdict artifact bean-check can
 * later replay. Keeping execution here is what lets bean-check stay zero-dep,
 * deterministic, and side-effect-free.
 *
 *   bean-verify --dir <path> --claim <id> --verifier <name>
 *
 * Reads   <dir>/.bean/claims.json, <dir>/.bean/run.json (the `oracles` registry)
 * Runs    the registered oracle command (argv array, shell:false), claim JSON on stdin
 * Writes  <dir>/.bean/verdicts/<claim>.<verifier>.json     (committed, SCRUBBED: hashes
 *                                                            + verdict only — no raw output,
 *                                                            no paths, no free-form findings)
 *         <dir>/.bean/verdicts-raw/<claim>.<verifier>.log   (LOCAL diagnostic; gitignore it)
 *
 * Verdict: command exit 0 = pass, nonzero = fail, spawn error/timeout = error. A JSON
 * object on stdout with a {"verdict": ...} field, if present, refines the result.
 *
 * Exit codes:  0 = pass recorded   1 = fail recorded   2 = error recorded   3 = usage/load error
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

/** @param {string} s */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Reject ids with path separators / traversal — they become verdict filenames. Must match
// bean-check.js safeId.
/** @param {unknown} id @returns {boolean} */
const safeId = (id) => typeof id === "string" && /^[A-Za-z0-9._-]+$/.test(id);

// contentHash MUST match bean-check.js exactly (a verdict's claim_binding is compared
// against bean-check's contentHash of the same claim to detect staleness).
/** @param {{ type?: string, topic?: string, content?: string }} c */
const contentHash = (c) =>
	sha(
		`${c.type}|${(c.topic || "").toLowerCase()}|${(c.content || "").trim().toLowerCase()}`,
	);

/**
 * @param {number} code
 * @param {string} msg
 * @returns {never}
 */
function die(code, msg) {
	process.stderr.write(`bean-verify: ${msg}\n`);
	process.exit(code);
}

/** @param {string} p @param {any} fallback */
function loadJson(p, fallback) {
	if (!fs.existsSync(p)) return fallback;
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"));
	} catch (e) {
		return die(3, `cannot parse ${p}: ${e instanceof Error ? e.message : e}`);
	}
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const a = { dir: process.cwd(), claim: "", verifier: "", help: false };
	for (let i = 0; i < argv.length; i++) {
		const v = argv[i];
		if (v === "--dir") a.dir = need(argv[++i], "--dir");
		else if (v === "--claim") a.claim = need(argv[++i], "--claim");
		else if (v === "--verifier") a.verifier = need(argv[++i], "--verifier");
		else if (v === "--help" || v === "-h") a.help = true;
		else die(3, `unknown argument: ${v}`);
	}
	return a;
}
/** @param {string | undefined} v @param {string} flag @returns {string} */
function need(v, flag) {
	if (v === undefined || v.startsWith("--")) die(3, `${flag} requires a value`);
	return v;
}

// Hash the declared input set (explicit file paths). A path that is missing or a directory
// is skipped (recorded as absent); glob expansion is intentionally NOT supported in Core —
// list files explicitly. Sorted so the hash is order-independent.
/** @param {string} baseDir @param {string[]} inputs */
function inputsHash(baseDir, inputs) {
	if (!Array.isArray(inputs) || inputs.length === 0) return sha("");
	const parts = [];
	for (const rel of [...inputs].sort()) {
		const p = path.resolve(baseDir, rel);
		let h = "absent";
		try {
			const st = fs.statSync(p);
			if (st.isFile()) h = sha(fs.readFileSync(p, "utf8"));
		} catch {
			h = "absent";
		}
		parts.push(`${rel}:${h}`);
	}
	return sha(parts.join("\n"));
}

function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a.help) {
		process.stdout.write(
			"bean-verify --dir <path> --claim <id> --verifier <name>\n" +
				"Runs a declared oracle and records a scrubbed verdict. 0=pass,1=fail,2=error.\n",
		);
		return 0;
	}
	if (!a.claim || !a.verifier)
		die(3, "both --claim and --verifier are required");
	if (!safeId(a.claim) || !safeId(a.verifier))
		die(
			3,
			"--claim and --verifier must match [A-Za-z0-9._-]+ (no path separators)",
		);

	const beanDir = path.join(a.dir, ".bean");
	const raw = loadJson(path.join(beanDir, "claims.json"), null);
	const claims = Array.isArray(raw) ? raw : raw && raw.claims;
	if (!Array.isArray(claims))
		die(3, "claims.json must be an array or { claims }");
	const claim = claims.find((c) => c && c.id === a.claim);
	if (!claim) die(3, `no claim with id ${a.claim}`);

	const run = loadJson(path.join(beanDir, "run.json"), {});
	const oracles = run && typeof run.oracles === "object" ? run.oracles : {};
	const oracle = Object.prototype.hasOwnProperty.call(oracles, a.verifier)
		? oracles[a.verifier]
		: null;
	if (!oracle || typeof oracle !== "object" || Array.isArray(oracle))
		die(3, `verifier ${a.verifier} is not declared in run.json oracles`);
	if (!Array.isArray(oracle.cmd) || oracle.cmd.length === 0)
		die(3, `verifier ${a.verifier} has no cmd argv`);

	// run the oracle: argv array, shell:false (no injection surface), claim JSON on stdin
	const res = spawnSync(oracle.cmd[0], oracle.cmd.slice(1), {
		input: JSON.stringify(claim),
		encoding: "utf8",
		shell: false,
		timeout: typeof oracle.timeout_ms === "number" ? oracle.timeout_ms : 120000,
		cwd: a.dir,
	});

	/** @type {"pass" | "fail" | "error"} */
	let verdict;
	if (res.error) verdict = "error";
	else if (res.status === 0) verdict = "pass";
	else verdict = "fail";
	// a JSON {verdict} on stdout refines the exit-code reading
	try {
		const j = JSON.parse(res.stdout || "");
		if (
			j &&
			(j.verdict === "pass" || j.verdict === "fail" || j.verdict === "error")
		)
			verdict = j.verdict;
	} catch {
		/* stdout was not JSON; exit code stands */
	}

	const artifact = {
		schema: "bean.verdict/2",
		claim: a.claim,
		verifier: a.verifier,
		verdict,
		oracle_digest: sha(JSON.stringify(oracle.cmd)),
		inputs_hash: inputsHash(a.dir, oracle.inputs || []),
		claim_binding: contentHash(claim),
	};

	const vdir = path.join(beanDir, "verdicts");
	fs.mkdirSync(vdir, { recursive: true });
	fs.writeFileSync(
		path.join(vdir, `${a.claim}.${a.verifier}.json`),
		JSON.stringify(artifact, null, "\t") + "\n",
	);
	// local-only diagnostic (raw output may carry paths/identifiers — never committed)
	const rdir = path.join(beanDir, "verdicts-raw");
	fs.mkdirSync(rdir, { recursive: true });
	fs.writeFileSync(
		path.join(rdir, `${a.claim}.${a.verifier}.log`),
		`exit=${res.status}\nerror=${res.error ? res.error.message : ""}\n--- stdout ---\n${res.stdout || ""}\n--- stderr ---\n${res.stderr || ""}\n`,
	);

	process.stdout.write(
		`bean-verify: ${verdict}  ${a.claim}.${a.verifier}\n` +
			`  attach to the claim:  "verified_by": { "verifier": ${JSON.stringify(a.verifier)} }\n`,
	);
	return verdict === "pass" ? 0 : verdict === "fail" ? 1 : 2;
}

process.exit(main());
