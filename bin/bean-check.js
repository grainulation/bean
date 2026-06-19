#!/usr/bin/env node
// @ts-check
/**
 * bean-check — bean's convergence compiler.
 *
 * Built from the Bran-IR core (not derived from wheat): it reads a typed-claim
 * ledger plus a run contract, scores convergence, and EXITS NONZERO when
 * convergence is not honestly reached. This is what turns bean's loop from
 * "please remember to converge" into "the artifact says whether you did."
 *
 * Zero runtime dependencies (Node builtins only). Portable: runs on Codex / bare
 * installs with no grainulator/wheat present. When wheat IS present it is a richer
 * optional backend, but bean-check is self-sufficient. Type-checked via `tsc`.
 *
 *   bean-check [--dir <path>] [--json] [--quiet] [--no-state]
 *
 * Reads   <dir>/.bean/claims.json     (Bran-IR claims; array or { "claims": [...] })
 *         <dir>/.bean/run.json        (run contract; optional, sensible defaults)
 *         <dir>/.bean/verdicts/*.json (2.0: recorded oracle verdicts; written by bean-verify)
 * Writes  <dir>/.bean/state.json      (loop-state for temporal checks; --no-state skips)
 *
 * 2.0 — "a gate with an oracle". In `strict` mode a load-bearing claim converges
 * only when it carries a passing, fresh, declared oracle verdict OR is a named
 * residual. bean-check stays a PURE ADJUDICATOR: it READS recorded verdicts, it
 * never executes an oracle (that is bean-verify). What 2.0 delivers is AUDITABLE
 * verification, not "leakage-safe" verification and not correctness.
 *
 * Exit codes:
 *   0 = ready (fully converged)
 *   1 = blocked
 *   2 = budget-exceeded
 *   3 = usage/load error
 *   4 = converged-with-residuals (no blockers, but load-bearing claims rest on
 *       named residuals rather than verification — review warranted, not clean)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** @typedef {"stated" | "web" | "documented" | "tested" | "production"} Tier */
/** @typedef {"constraint" | "factual" | "estimate" | "risk" | "recommendation" | "feedback"} ClaimType */
/** @typedef {"pass" | "fail" | "error"} Verdict */
/** @typedef {"compat" | "advisory" | "strict"} Mode */
/**
 * @typedef {Object} Claim
 * @property {string} id
 * @property {ClaimType} type
 * @property {string} topic
 * @property {string} [content]
 * @property {{ origin?: string }} [source]
 * @property {Tier} evidence
 * @property {string} [status]
 * @property {string[]} [conflicts_with]
 * @property {string[]} [depends_on]
 * @property {string | null} [resolved_by]
 * @property {string[]} [tags]
 * @property {{ verifier: string }} [verified_by]
 */
/**
 * @typedef {Object} OracleSpec
 * @property {string[]} [cmd]
 * @property {string} [oracle_digest]
 * @property {string[]} [inputs]
 * @property {string} [trust]
 * @property {number} [timeout_ms]
 */
/**
 * @typedef {Object} Run
 * @property {{ load_bearing: Tier, recommendation: Tier }} evidence_bar
 * @property {{ max_rounds?: number }} [budget]
 * @property {Object} [mutation_policy]
 * @property {string} [stakes]
 * @property {{ mode?: Mode }} [verification]
 * @property {Record<string, OracleSpec>} [oracles]
 * @property {Object} [sealed_expected]
 */
/**
 * @typedef {Object} Verdict_Artifact
 * @property {string} claim
 * @property {string} verifier
 * @property {Verdict} verdict
 * @property {string} [oracle_digest]
 * @property {string} [inputs_hash]
 * @property {string} claim_binding
 */
/**
 * @typedef {Object} State
 * @property {number} round
 * @property {string[]} seen_ids
 * @property {string[]} superseded_hashes
 * @property {string} claims_hash
 */
/** @typedef {{ code: string } & Record<string, unknown>} Finding */
/**
 * @typedef {Object} VerificationSummary
 * @property {Mode} mode
 * @property {number} load_bearing
 * @property {number} verified
 * @property {number} residual
 * @property {number} unverified
 * @property {number} failed
 * @property {number} stale
 */
/**
 * @typedef {Object} Result
 * @property {"ready" | "blocked" | "budget-exceeded" | "converged-with-residuals"} status
 * @property {Finding[]} blockers
 * @property {Finding[]} warnings
 * @property {string[]} notes
 * @property {{ topics: number, active: number, total: number }} coverage
 * @property {VerificationSummary} verification
 * @property {number} round
 * @property {number | null} max_rounds
 * @property {number} new_this_round
 * @property {boolean} dry
 * @property {string} certificate
 * @property {State} [_state]
 */

const TIERS = ["stated", "web", "documented", "tested", "production"];
const TYPES = [
	"constraint",
	"factual",
	"estimate",
	"risk",
	"recommendation",
	"feedback",
];
const MODES = ["compat", "advisory", "strict"];
/** @param {string} t */
const tierRank = (t) => TIERS.indexOf(t);
/** @param {string} s */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// A safe id contains no path separators / traversal — used for verdict filenames and to
// reject ids that could escape .bean/verdicts. Must match bean-verify.js.
/** @param {unknown} id @returns {boolean} */
const safeId = (id) => typeof id === "string" && /^[A-Za-z0-9._-]+$/.test(id);

// Hash a declared input set (explicit file paths, relative to baseDir). MUST match
// bean-verify.js exactly so a recompute here equals what was recorded at verify time.
/** @param {string} baseDir @param {string[]} inputs @returns {string} */
function inputsHash(baseDir, inputs) {
	if (!Array.isArray(inputs) || inputs.length === 0) return sha("");
	const parts = [];
	for (const rel of [...inputs].sort()) {
		let h = "absent";
		try {
			const p = path.resolve(baseDir, rel);
			const st = fs.statSync(p);
			if (st.isFile()) h = sha(fs.readFileSync(p, "utf8"));
		} catch {
			h = "absent";
		}
		parts.push(`${rel}:${h}`);
	}
	return sha(parts.join("\n"));
}
// A declared oracle is usable only if it is an OWN, plain-object entry with a non-empty
// argv `cmd`. Object.hasOwn defeats the prototype-pollution bypass (e.g. verifier "toString").
/** @param {Record<string, OracleSpec>} oracles @param {string} name @returns {OracleSpec | null} */
function oracleSpec(oracles, name) {
	if (!Object.prototype.hasOwnProperty.call(oracles, name)) return null;
	const o = oracles[name];
	if (!o || typeof o !== "object" || Array.isArray(o)) return null;
	if (!Array.isArray(o.cmd) || o.cmd.length === 0) return null;
	return o;
}

// ---------------------------------------------------------------- args + load

/** @param {string[]} argv */
function parseArgs(argv) {
	const a = {
		dir: process.cwd(),
		json: false,
		quiet: false,
		state: true,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const v = argv[i];
		if (v === "--dir") {
			a.dir = argv[++i];
			if (a.dir === undefined || a.dir.startsWith("--"))
				die(3, "--dir requires a path");
		} else if (v === "--json") a.json = true;
		else if (v === "--quiet") a.quiet = true;
		else if (v === "--no-state") a.state = false;
		else if (v === "--help" || v === "-h") a.help = true;
		else die(3, `unknown argument: ${v}`);
	}
	return a;
}

/**
 * @param {number} code
 * @param {string} msg
 * @returns {never}
 */
function die(code, msg) {
	process.stderr.write(`bean-check: ${msg}\n`);
	process.exit(code);
}

/**
 * @param {string} p
 * @param {any} fallback
 */
function loadJson(p, fallback) {
	if (!fs.existsSync(p)) return fallback;
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"));
	} catch (e) {
		return die(3, `cannot parse ${p}: ${e instanceof Error ? e.message : e}`);
	}
}

/**
 * @param {string} beanDir
 * @returns {Claim[]}
 */
function loadClaims(beanDir) {
	const p = path.join(beanDir, "claims.json");
	if (!fs.existsSync(p)) return die(3, `no claims ledger at ${p}`);
	const raw = loadJson(p, null);
	const claims = Array.isArray(raw) ? raw : raw && raw.claims;
	if (!Array.isArray(claims))
		return die(3, `${p} must be an array or { "claims": [...] }`);
	return claims;
}

// Recorded oracle verdicts (2.0). bean-check READS these; it never runs an oracle.
// Keyed by `${claim}::${verifier}`. A missing dir is fine (no verdicts recorded).
/**
 * @param {string} beanDir
 * @returns {Map<string, Verdict_Artifact>}
 */
function loadVerdicts(beanDir) {
	/** @type {Map<string, Verdict_Artifact>} */
	const m = new Map();
	const dir = path.join(beanDir, "verdicts");
	if (!fs.existsSync(dir)) return m;
	// Sorted for deterministic reads, and a verdict is admitted ONLY when its filename is the
	// canonical `${claim}.${verifier}.json` for its own contents — so a renamed/duplicate file
	// cannot shadow or flip a key by filesystem order (last-writer-wins is impossible).
	for (const f of fs.readdirSync(dir).sort()) {
		if (!f.endsWith(".json")) continue;
		const a = loadJson(path.join(dir, f), null);
		if (!a || typeof a !== "object" || !safeId(a.claim) || !safeId(a.verifier))
			continue;
		if (f !== `${a.claim}.${a.verifier}.json`) continue;
		m.set(`${a.claim}::${a.verifier}`, a);
	}
	return m;
}

/** @type {Run} */
const DEFAULT_RUN = {
	evidence_bar: { load_bearing: "tested", recommendation: "documented" },
	budget: { max_rounds: 6 },
	mutation_policy: { reversible: "proceed", destructive: "ask" },
	stakes: "medium",
};

// Merge a user run.json over the defaults — DEEP for evidence_bar (a partial bar must not
// drop the other tier), and validate tier strings (an invalid/missing tier falls back to
// the default rather than becoming `undefined`, which would silently disable the gate).
/**
 * @param {any} raw
 * @returns {Run}
 */
function mergeRun(raw) {
	const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const eb =
		r.evidence_bar && typeof r.evidence_bar === "object" ? r.evidence_bar : {};
	/** @param {any} t @param {Tier} dflt @returns {Tier} */
	const tier = (t, dflt) => (TIERS.includes(t) ? t : dflt);
	return {
		...DEFAULT_RUN,
		...r,
		evidence_bar: {
			load_bearing: tier(
				eb.load_bearing,
				DEFAULT_RUN.evidence_bar.load_bearing,
			),
			recommendation: tier(
				eb.recommendation,
				DEFAULT_RUN.evidence_bar.recommendation,
			),
		},
		budget:
			r.budget && typeof r.budget === "object" ? r.budget : DEFAULT_RUN.budget,
	};
}

// ---------------------------------------------------------------- claim helpers

/** @param {Claim} c */
const isActive = (c) =>
	c.status !== "superseded" &&
	c.status !== "rejected" &&
	c.status !== "resolved";
/** @param {Claim} c @param {string} t */
const hasTag = (c, t) => Array.isArray(c.tags) && c.tags.includes(t);
/** @param {Claim} c */
const isLoadBearing = (c) =>
	hasTag(c, "load-bearing") || c.type === "recommendation";
/** @param {Claim} c */
const isAbstention = (c) => hasTag(c, "needs-input") || hasTag(c, "unknown");
/** @param {Claim} c */
const contentHash = (c) =>
	sha(
		`${c.type}|${(c.topic || "").toLowerCase()}|${(c.content || "").trim().toLowerCase()}`,
	);

// Strict evidence dominance between two conflicting claims. Returns the winner/loser
// when one side's evidence tier is strictly above the other's and neither side is an
// abstention. Tier is a HINT, not a verdict: "tested" beating "documented" can still be
// wrong if the higher-tier claim is stale or mis-scoped — so bean-check only suggests
// the supersede; the agent confirms it is better-grounded and records it.
/**
 * @param {Claim} a
 * @param {Claim} b
 * @returns {{ winner: string, loser: string, reason: string } | null}
 */
function dominance(a, b) {
	if (isAbstention(a) || isAbstention(b)) return null;
	const ra = tierRank(a.evidence);
	const rb = tierRank(b.evidence);
	if (ra === rb) return null;
	const [w, l] = ra > rb ? [a, b] : [b, a];
	return { winner: w.id, loser: l.id, reason: `${w.evidence} > ${l.evidence}` };
}

// ---------------------------------------------------------------- the checks

/**
 * @param {Claim[]} claims
 * @param {Run} run
 * @param {State | null} prior
 * @param {Map<string, Verdict_Artifact>} [verdicts]
 * @param {string} [baseDir]
 * @returns {Result}
 */
function compile(claims, run, prior, verdicts = new Map(), baseDir = ".") {
	/** @type {Finding[]} */ const blockers = [];
	/** @type {Finding[]} */ const warnings = [];
	/** @type {string[]} */ const notes = [];

	/** @type {Mode} */
	const mode =
		run.verification &&
		typeof run.verification.mode === "string" &&
		MODES.includes(run.verification.mode)
			? run.verification.mode
			: "compat";

	// Partition first: only well-formed, unique-id claims participate. Malformed claims
	// (non-objects, bad type/tier, missing id) and duplicate ids are recorded as blockers
	// and excluded — so the checks below can't crash on a bad shape.
	/** @type {Claim[]} */ const valid = [];
	const seenIds = new Set();
	for (const c of claims) {
		const ok =
			!!c &&
			typeof c === "object" &&
			!Array.isArray(c) &&
			!!c.id &&
			TYPES.includes(c.type) &&
			TIERS.includes(c.evidence);
		if (!ok)
			blockers.push({
				code: "E_SCHEMA",
				claim: (c && typeof c === "object" && c.id) || "(malformed)",
			});
		else if (seenIds.has(c.id))
			blockers.push({ code: "E_DUP_ID", claim: c.id });
		else {
			seenIds.add(c.id);
			valid.push(c);
		}
	}
	const byId = new Map(valid.map((c) => [c.id, c]));
	const active = valid.filter(isActive);
	if (active.length === 0)
		notes.push("EMPTY_LEDGER: no active claims to converge");

	// A claim is genuinely resolved/discharged only by a real, active, DIFFERENT claim —
	// not by a dangling id or by pointing at itself (that would silence the gate).
	/** @param {Claim} c */
	const validResolver = (c) => {
		if (!c.resolved_by || c.resolved_by === c.id) return false;
		const r = byId.get(c.resolved_by);
		return !!r && isActive(r);
	};
	// A residual genuinely discharges a front only WITH a stated reason (the claim's
	// content) — naming a residual without saying WHY it's unreachable is a silent punt.
	/** @param {Claim} c */
	const hasReason = (c) =>
		typeof c.content === "string" && c.content.trim().length > 0;
	/** @param {Claim} c */
	const discharged = (c) =>
		validResolver(c) ||
		hasTag(c, "confirmed-non-issue") ||
		hasTag(c, "accepted") ||
		(hasTag(c, "residual") && hasReason(c));

	// 1. unresolved conflicts — SYMMETRIC pairing (a conflicts_with link from EITHER side
	// registers the pair), fail-closed. A pair is cleared only when one side is inactive
	// or carries a valid resolver. When one side strictly out-evidences the other, emit a
	// belief-revision HINT (supersede the weaker) — but still block until the agent records
	// it. bean-check never edits the ledger. No Schulze: bean has no voters, and Fable
	// revises beliefs rather than holding elections.
	/** @type {Map<string, [Claim, Claim]>} */
	const conflictPairs = new Map();
	for (const c of active)
		for (const other of Array.isArray(c.conflicts_with)
			? c.conflicts_with
			: []) {
			const o = byId.get(other);
			if (!o || !isActive(o) || o.id === c.id) continue;
			if (validResolver(c) || validResolver(o)) continue;
			const [a, b] = c.id < o.id ? [c, o] : [o, c];
			conflictPairs.set(`${a.id} ${b.id}`, [a, b]);
		}
	for (const [a, b] of conflictPairs.values()) {
		const dom = dominance(a, b);
		blockers.push(
			dom
				? {
						code: "E_CONFLICT",
						claim: a.id,
						with: b.id,
						topic: a.topic,
						resolvable: true,
						supersede: dom.loser,
						keep: dom.winner,
						reason: dom.reason,
					}
				: {
						code: "E_CONFLICT",
						claim: a.id,
						with: b.id,
						topic: a.topic,
						resolvable: false,
					},
		);
	}

	// 1b. dependency integrity (truth-maintenance): a claim that depends_on a superseded or
	// inactive claim is STALE — revising a support must reopen its dependents, not leave them
	// standing. This is the mechanical enforcement of belief-revision propagation.
	for (const c of active) {
		if (c.depends_on !== undefined && !Array.isArray(c.depends_on)) {
			// a present-but-malformed depends_on must not silently fail open
			blockers.push({ code: "E_SCHEMA", claim: c.id });
			continue;
		}
		for (const dep of c.depends_on || []) {
			const d = byId.get(dep);
			if (dep === c.id || !d || !isActive(d))
				blockers.push({
					code: "E_STALE_DEPENDENT",
					claim: c.id,
					depends_on: dep,
				});
		}
	}

	// 2. undischarged risk — recording a concern is not resolving it
	for (const c of active)
		if (c.type === "risk" && !discharged(c))
			blockers.push({ code: "E_OPEN_RISK", claim: c.id, topic: c.topic });

	// 3. load-bearing claim below the evidence bar (bean GATES; wheat only warns)
	/** @param {Claim} c */
	const bar = (c) =>
		c.type === "recommendation"
			? run.evidence_bar.recommendation
			: run.evidence_bar.load_bearing;
	for (const c of active)
		if (
			isLoadBearing(c) &&
			!isAbstention(c) &&
			tierRank(c.evidence) < tierRank(bar(c))
		)
			blockers.push({
				code: "E_WEAK_LOADBEARING",
				claim: c.id,
				have: c.evidence,
				need: bar(c),
			});

	// 3b. THE ORACLE GATE (2.0). Off in `compat` (== 1.x). In `strict` a load-bearing claim
	// converges only with a passing, fresh, DECLARED oracle verdict OR as a named residual;
	// in `advisory` the same misses are warnings, never blockers. Gate on load-bearing
	// STATUS, not tier — but skip a claim already failing the tier bar (can't verify a
	// hunch). bean-check reads the recorded verdict; it never runs the oracle.
	/** @type {VerificationSummary} */
	const vsum = {
		mode,
		load_bearing: 0,
		verified: 0,
		residual: 0,
		unverified: 0,
		failed: 0,
		stale: 0,
	};
	/** @type {string[]} */ const residualLoadBearing = [];
	const usedVerifiers = new Set();
	// what each VERIFIED claim was checked by — folded into the certificate so the cert binds
	// the recorded oracle digest + inputs + claim binding, not just the verdict word.
	/** @type {Map<string, string[]>} */ const verifiedInfo = new Map();
	if (mode !== "compat") {
		const oracles =
			run.oracles && typeof run.oracles === "object" ? run.oracles : {};
		// advisory degrades a blocker to a warning that PRESERVES the specific failure
		// (E_ORACLE_FAILED -> W_ORACLE_FAILED), never a lossy generic.
		/** @param {Finding} b */
		const flag = (b) => {
			if (mode === "strict") blockers.push(b);
			else warnings.push({ ...b, code: b.code.replace(/^E_/, "W_") });
		};
		for (const c of active) {
			if (!isLoadBearing(c) || isAbstention(c)) continue;
			if (tierRank(c.evidence) < tierRank(bar(c))) continue; // already E_WEAK_LOADBEARING
			vsum.load_bearing++;
			const vb = c.verified_by;
			const isResidual = hasTag(c, "residual") && hasReason(c);
			// resolve the verifier outcome to a single blocker (or null = passed)
			/** @type {Finding | null} */ let fail = null;
			/** @type {Verdict_Artifact | undefined} */ let passArt;
			let passVerifier = "";
			if (vb && typeof vb === "object" && vb.verifier) {
				const spec = oracleSpec(oracles, vb.verifier);
				const art = verdicts.get(`${c.id}::${vb.verifier}`);
				if (!spec)
					fail = {
						code: "E_ORACLE_UNDECLARED",
						claim: c.id,
						verifier: vb.verifier,
					};
				else if (!art)
					fail = {
						code: "E_VERIFY_ERROR",
						claim: c.id,
						verifier: vb.verifier,
						reason: "no recorded verdict",
					};
				else {
					// freshness binds claim content AND the oracle command AND the declared inputs;
					// a pinned oracle_digest must also match. Any drift -> stale (fail-closed).
					const wantDigest = sha(JSON.stringify(spec.cmd));
					const wantInputs = inputsHash(baseDir, spec.inputs || []);
					const pin =
						typeof spec.oracle_digest === "string" ? spec.oracle_digest : null;
					if (
						art.claim_binding !== contentHash(c) ||
						art.oracle_digest !== wantDigest ||
						art.inputs_hash !== wantInputs ||
						(pin !== null && pin !== wantDigest)
					)
						fail = {
							code: "E_ORACLE_STALE",
							claim: c.id,
							verifier: vb.verifier,
						};
					else if (art.verdict === "fail")
						fail = {
							code: "E_ORACLE_FAILED",
							claim: c.id,
							verifier: vb.verifier,
						};
					else if (art.verdict !== "pass")
						fail = {
							code: "E_VERIFY_ERROR",
							claim: c.id,
							verifier: vb.verifier,
						};
					else {
						passArt = art;
						passVerifier = vb.verifier;
					}
				}
			}

			if (passArt) {
				vsum.verified++;
				usedVerifiers.add(passVerifier);
				verifiedInfo.set(c.id, [
					passVerifier,
					passArt.verdict,
					passArt.oracle_digest || "",
					passArt.inputs_hash || "",
					passArt.claim_binding,
				]);
			} else if (isResidual) {
				// "verified OR named residual": a residual is the honest fallback when the
				// verifier is absent/stale/failed. It converges-with-residuals, with a warning
				// when it masked a real verifier failure (so the failure is never silent).
				vsum.residual++;
				residualLoadBearing.push(c.id);
				if (fail)
					warnings.push({
						code: "W_ORACLE_RESIDUAL_FALLBACK",
						claim: c.id,
						masked: fail.code,
					});
			} else if (fail) {
				flag(fail);
				if (fail.code === "E_ORACLE_FAILED") vsum.failed++;
				else if (fail.code === "E_ORACLE_STALE") vsum.stale++;
				else vsum.unverified++;
			} else {
				flag({ code: "E_UNVERIFIED_LOADBEARING", claim: c.id, topic: c.topic });
				vsum.unverified++;
			}
		}
		// echo chamber: every verified load-bearing claim leans on one verifier
		if (vsum.verified >= 2 && usedVerifiers.size === 1)
			warnings.push({
				code: "W_ORACLE_SINGLE",
				verifier: [...usedVerifiers][0],
			});
		// sealed-output is an attestation bean-check cannot enforce (it sees no reads)
		if (run.sealed_expected) warnings.push({ code: "W_SEALED_UNENFORCED" });
	}

	// 4. abstention on a load-bearing front is an open front, not a conclusion
	for (const c of active)
		if (isAbstention(c) && isLoadBearing(c))
			blockers.push({ code: "E_OPEN_UNKNOWN", claim: c.id, topic: c.topic });

	// 5. coverage warnings (single-source echo chamber / type monoculture)
	/** @type {Map<string, { sources: Set<string>, types: Set<string>, n: number }>} */
	const topics = new Map();
	for (const c of active) {
		const t = topics.get(c.topic) || {
			sources: new Set(),
			types: new Set(),
			n: 0,
		};
		t.sources.add((c.source && c.source.origin) || "unknown");
		t.types.add(c.type);
		t.n++;
		topics.set(c.topic, t);
	}
	for (const [topic, t] of topics) {
		if (t.n >= 3 && t.sources.size === 1)
			warnings.push({ code: "W_SINGLE_SOURCE", topic });
		if (t.n >= 2 && t.types.size < 2)
			warnings.push({ code: "W_MONOCULTURE", topic });
	}

	// 6 + 7 + 8. temporal checks (need round history — this is what wheat can't see)
	const activeIds = active.map((c) => c.id).sort();
	const seen = new Set(prior ? prior.seen_ids : []);
	const newIds = activeIds.filter((id) => !seen.has(id));
	const supersededHashes = new Set(prior ? prior.superseded_hashes : []);

	// rejected/superseded claim resurrected as active
	for (const c of active)
		if (supersededHashes.has(contentHash(c)))
			warnings.push({ code: "W_REAPPEAR", claim: c.id });

	// "dry" means nothing CHANGED — content / evidence / status, not just ids — so an
	// in-place revision (same id, new content) still counts as progress.
	const claimsHash = sha(
		JSON.stringify(
			active.map((c) => [c.id, contentHash(c), c.evidence]).sort(),
		),
	);
	const dry = !!prior && prior.claims_hash === claimsHash;
	const round = prior ? prior.round + (dry ? 0 : 1) : 1;
	const openFronts = blockers.length > 0;
	if (dry && openFronts)
		notes.push(
			"DRY_ROUND_STUCK: a full round added nothing yet open fronts remain",
		);
	if (dry && !openFronts) notes.push("DRY_ROUND_CONVERGED");

	const maxRounds = run.budget && run.budget.max_rounds;
	const overBudget = maxRounds != null && round > maxRounds;
	if (overBudget)
		notes.push(
			`OVER_BUDGET: round ${round} > max ${maxRounds} — deliver with open fronts named`,
		);

	// status precedence: budget-exceeded (stop now) > blocked > converged-with-residuals
	// (no blockers, but load-bearing claims rest on residuals, strict only) > ready.
	let /** @type {Result["status"]} */ status = "ready";
	if (overBudget) status = "budget-exceeded";
	else if (blockers.length) status = "blocked";
	else if (mode === "strict" && residualLoadBearing.length > 0)
		status = "converged-with-residuals";

	// certificate: reproducible proof. 1.x identity is preserved byte-for-byte when no 2.0
	// feature is in play (compat mode, no verified_by, no oracle registry). When 2.0 IS
	// active the certificate binds the FULL adjudication universe — mode, the load-bearing
	// classification, the residual set, the oracle registry, and each verdict — so two
	// different verification regimes can never share a certificate.
	const v20 =
		mode !== "compat" ||
		active.some((c) => c.verified_by) ||
		Object.keys(run.oracles || {}).length > 0;
	const admitted = active
		.map((c) => {
			/** @type {string[]} */
			const t = [c.id, c.evidence, contentHash(c)];
			// only a VERIFIED claim contributes verdict data (digest+inputs+binding), so the
			// cert proves what was checked. v20=false => no claim appends => 1.x byte-identity.
			if (v20) {
				const info = verifiedInfo.get(c.id);
				if (info) t.push(...info);
			}
			return t;
		})
		.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
	/** @type {Record<string, unknown>} */
	const certObj = { status, admitted };
	if (v20)
		certObj.v = {
			mode,
			loadBearing: active
				.filter(isLoadBearing)
				.map((c) => c.id)
				.sort(),
			residual: [...residualLoadBearing].sort(),
			oracles: Object.keys(run.oracles || {})
				.sort()
				.map((k) => `${k}:${(run.oracles || {})[k].oracle_digest || ""}`),
		};
	const certificate = sha(JSON.stringify(certObj)).slice(0, 16);

	/** @type {State} */
	const nextState = {
		round,
		seen_ids: [
			...new Set([...(prior ? prior.seen_ids : []), ...activeIds]),
		].sort(),
		superseded_hashes: [
			...new Set([
				...(prior ? prior.superseded_hashes : []),
				...valid
					.filter((c) => c.status === "superseded" || c.status === "rejected")
					.map(contentHash),
			]),
		],
		claims_hash: claimsHash,
	};

	return {
		status,
		blockers,
		warnings,
		notes,
		coverage: {
			topics: topics.size,
			active: active.length,
			total: claims.length,
		},
		verification: vsum,
		round,
		max_rounds: maxRounds ?? null,
		new_this_round: newIds.length,
		dry,
		certificate,
		_state: nextState,
	};
}

// ---------------------------------------------------------------- render + main

/** @param {Result} r */
function render(r) {
	const L = [];
	const mark = {
		ready: "READY",
		blocked: "BLOCKED",
		"budget-exceeded": "BUDGET",
		"converged-with-residuals": "RESIDUALS",
	}[r.status];
	L.push(
		`bean-check: ${mark}  (round ${r.round}${r.max_rounds ? "/" + r.max_rounds : ""}, +${r.new_this_round} new, cert ${r.certificate})`,
	);
	for (const b of r.blockers) {
		let hint = "";
		if (b.resolvable === true)
			hint = ` — supersede ${b.supersede} (keep ${b.keep}: ${b.reason}); verify better-grounded, then record it`;
		else if (b.resolvable === false)
			hint = " — genuine tie: resolve via the loop";
		else if (b.verifier) hint = ` — verifier ${b.verifier}`;
		L.push(
			`  BLOCK ${b.code} ${b.claim || ""}${b.with ? " <> " + b.with : ""}${b.need ? ` (${b.have}<${b.need})` : ""}${hint}`,
		);
	}
	for (const w of r.warnings)
		L.push(`  warn  ${w.code} ${w.topic || w.claim || w.verifier || ""}`);
	for (const n of r.notes) L.push(`  note  ${n}`);
	if (r.verification.mode !== "compat") {
		const v = r.verification;
		L.push(
			`  verify (${v.mode}): ${v.verified} verified, ${v.residual} residual, ${v.unverified} unverified, ${v.failed} failed, ${v.stale} stale / ${v.load_bearing} load-bearing`,
		);
	}
	L.push(
		`  coverage: ${r.coverage.active}/${r.coverage.total} active across ${r.coverage.topics} topics`,
	);
	return L.join("\n");
}

function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a.help) {
		process.stdout.write(
			"bean-check [--dir <path>] [--json] [--quiet] [--no-state]\n" +
				"Convergence compiler: 0=ready, 1=blocked, 2=budget-exceeded, 4=converged-with-residuals.\n",
		);
		return 0;
	}
	const beanDir = path.join(a.dir, ".bean");
	const claims = loadClaims(beanDir);
	const run = mergeRun(loadJson(path.join(beanDir, "run.json"), {}));
	const verdicts = loadVerdicts(beanDir);
	const statePath = path.join(beanDir, "state.json");
	const prior = a.state ? loadJson(statePath, null) : null;

	const r = compile(claims, run, prior, verdicts, a.dir);
	if (a.state)
		fs.writeFileSync(statePath, JSON.stringify(r._state, null, "\t") + "\n");
	delete r._state;

	if (a.json) process.stdout.write(JSON.stringify(r, null, "\t") + "\n");
	else if (a.quiet) process.stdout.write(`${r.status} ${r.certificate}\n`);
	else process.stdout.write(render(r) + "\n");

	return r.status === "ready"
		? 0
		: r.status === "converged-with-residuals"
			? 4
			: r.status === "budget-exceeded"
				? 2
				: 1;
}

process.exit(main());
