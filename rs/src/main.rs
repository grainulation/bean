// bean-check — bean's convergence compiler, Rust runtime (bean 2.0 north star).
//
// Reconverges with the Bran core (already Rust): a single static binary with no install
// dependency — the portability bean-check.js could not give, since Node is itself a dep.
// Ports the static checks AND the temporal checks (state.json / dry-round / budget); held to
// the JS reference by a differential conformance oracle (test/conformance.mjs): JS and Rust
// must agree on status + blockers + certificate + persisted state for every fixture/scenario.
// Still to come (later slices): the 2.0 oracle gate (verified_by) and the native hooks.
//
//   bean-check --dir <path> [--json] [--no-state]
//
// Exit: 0 = ready, 1 = blocked, 2 = budget-exceeded, 3 = usage/load error.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::process::exit;

const TIERS: [&str; 5] = ["stated", "web", "documented", "tested", "production"];
const TYPES: [&str; 6] = [
    "constraint",
    "factual",
    "estimate",
    "risk",
    "recommendation",
    "feedback",
];

fn tier_rank(t: &str) -> i32 {
    TIERS
        .iter()
        .position(|&x| x == t)
        .map(|i| i as i32)
        .unwrap_or(-1)
}
fn sha_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}
fn die(code: i32, msg: &str) -> ! {
    eprintln!("bean-check: {msg}");
    exit(code);
}

// ---- claim accessors (Value-based, mirroring the JS shape exactly) ----
fn s<'a>(c: &'a Value, k: &str) -> Option<&'a str> {
    c.get(k).and_then(|v| v.as_str())
}
fn id_of(c: &Value) -> &str {
    s(c, "id").unwrap_or("")
}
fn status_of(c: &Value) -> &str {
    s(c, "status").unwrap_or("")
}
fn is_active(c: &Value) -> bool {
    let st = status_of(c);
    st != "superseded" && st != "rejected" && st != "resolved"
}
fn has_tag(c: &Value, t: &str) -> bool {
    c.get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().any(|x| x.as_str() == Some(t)))
        .unwrap_or(false)
}
fn is_load_bearing(c: &Value) -> bool {
    has_tag(c, "load-bearing") || s(c, "type") == Some("recommendation")
}
fn is_abstention(c: &Value) -> bool {
    has_tag(c, "needs-input") || has_tag(c, "unknown")
}
fn content_hash(c: &Value) -> String {
    let ty = s(c, "type").unwrap_or("");
    let topic = s(c, "topic").unwrap_or("").to_lowercase();
    let content = s(c, "content").unwrap_or("").trim().to_lowercase();
    sha_hex(&format!("{ty}|{topic}|{content}"))
}

#[derive(Clone)]
struct Blocker {
    code: String,
    claim: String,
    extra: Vec<(String, Value)>,
}
fn b(code: &str, claim: &str) -> Blocker {
    Blocker {
        code: code.into(),
        claim: claim.into(),
        extra: vec![],
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut dir = std::env::current_dir()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let mut json_out = false;
    let mut state_enabled = true;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--dir" => {
                i += 1;
                if i >= args.len() || args[i].starts_with("--") {
                    die(3, "--dir requires a path");
                }
                dir = args[i].clone();
            }
            "--json" => json_out = true,
            "--no-state" => state_enabled = false,
            "--quiet" => {}
            "-h" | "--help" => {
                println!("bean-check --dir <path> [--json] [--no-state]");
                exit(0);
            }
            other => die(3, &format!("unknown argument: {other}")),
        }
        i += 1;
    }

    let bean_dir = std::path::Path::new(&dir).join(".bean");
    let claims_path = bean_dir.join("claims.json");
    let raw = std::fs::read_to_string(&claims_path)
        .unwrap_or_else(|_| die(3, &format!("no claims ledger at {}", claims_path.display())));
    let parsed: Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| die(3, &format!("cannot parse claims.json: {e}")));
    let claims: Vec<Value> = match &parsed {
        Value::Array(a) => a.clone(),
        Value::Object(o) => match o.get("claims") {
            Some(Value::Array(a)) => a.clone(),
            _ => die(3, "claims.json must be an array or { \"claims\": [...] }"),
        },
        _ => die(3, "claims.json must be an array or { \"claims\": [...] }"),
    };

    // run.json (evidence_bar + budget read by this slice; defaults match the JS DEFAULT_RUN)
    let mut bar_lb = "tested".to_string();
    let mut bar_rec = "documented".to_string();
    let mut max_rounds: Option<i64> = Some(6); // DEFAULT_RUN.budget.max_rounds
    if let Ok(rt) = std::fs::read_to_string(bean_dir.join("run.json")) {
        if let Ok(rj) = serde_json::from_str::<Value>(&rt) {
            if let Some(eb) = rj.get("evidence_bar") {
                if let Some(v) = eb.get("load_bearing").and_then(|v| v.as_str()) {
                    if TIERS.contains(&v) {
                        bar_lb = v.into();
                    }
                }
                if let Some(v) = eb.get("recommendation").and_then(|v| v.as_str()) {
                    if TIERS.contains(&v) {
                        bar_rec = v.into();
                    }
                }
            }
            // mergeRun: a run.json budget object replaces the default; max_rounds may be absent
            if let Some(budget) = rj.get("budget") {
                max_rounds = budget.get("max_rounds").and_then(|v| v.as_i64());
            }
        }
    }

    let mut blockers: Vec<Blocker> = vec![];

    // partition: well-formed, unique-id claims only (mirrors JS exactly)
    let mut valid: Vec<Value> = vec![];
    let mut seen_ids: Vec<String> = vec![];
    for c in &claims {
        let ok = c.is_object()
            && !id_of(c).is_empty()
            && s(c, "type").map(|t| TYPES.contains(&t)).unwrap_or(false)
            && s(c, "evidence")
                .map(|e| TIERS.contains(&e))
                .unwrap_or(false);
        if !ok {
            let cid = if c.is_object() && !id_of(c).is_empty() {
                id_of(c).to_string()
            } else {
                "(malformed)".to_string()
            };
            blockers.push(b("E_SCHEMA", &cid));
        } else if seen_ids.iter().any(|x| x == id_of(c)) {
            blockers.push(b("E_DUP_ID", id_of(c)));
        } else {
            seen_ids.push(id_of(c).to_string());
            valid.push(c.clone());
        }
    }
    let by_id = |id: &str| -> Option<&Value> { valid.iter().find(|c| id_of(c) == id) };
    let active: Vec<&Value> = valid.iter().filter(|c| is_active(c)).collect();

    let valid_resolver = |c: &Value| -> bool {
        match s(c, "resolved_by") {
            Some(rb) if rb != id_of(c) => by_id(rb).map(is_active).unwrap_or(false),
            _ => false,
        }
    };
    let has_reason = |c: &Value| -> bool { !s(c, "content").unwrap_or("").trim().is_empty() };
    let discharged = |c: &Value| -> bool {
        valid_resolver(c)
            || has_tag(c, "confirmed-non-issue")
            || has_tag(c, "accepted")
            || (has_tag(c, "residual") && has_reason(c))
    };

    // 1. conflicts — symmetric pairing, fail-closed, dominance hint
    let mut pairs: Vec<(String, String)> = vec![];
    for c in &active {
        if let Some(cw) = c.get("conflicts_with").and_then(|v| v.as_array()) {
            for other in cw {
                let other = match other.as_str() {
                    Some(o) => o,
                    None => continue,
                };
                let o = match by_id(other) {
                    Some(o) if is_active(o) && id_of(o) != id_of(c) => o,
                    _ => continue,
                };
                if valid_resolver(c) || valid_resolver(o) {
                    continue;
                }
                let (a, bb) = if id_of(c) < id_of(o) {
                    (id_of(c), id_of(o))
                } else {
                    (id_of(o), id_of(c))
                };
                let key = (a.to_string(), bb.to_string());
                if !pairs.contains(&key) {
                    pairs.push(key);
                }
            }
        }
    }
    for (aid, bid) in &pairs {
        let ca = by_id(aid).unwrap();
        let cb = by_id(bid).unwrap();
        let mut blk = b("E_CONFLICT", aid);
        blk.extra.push(("with".into(), Value::String(bid.clone())));
        if let Some(topic) = s(ca, "topic") {
            blk.extra
                .push(("topic".into(), Value::String(topic.into())));
        }
        // dominance: strictly higher tier wins, neither an abstention
        let dom = if is_abstention(ca) || is_abstention(cb) {
            None
        } else {
            let ra = tier_rank(s(ca, "evidence").unwrap_or(""));
            let rb = tier_rank(s(cb, "evidence").unwrap_or(""));
            if ra == rb {
                None
            } else if ra > rb {
                Some((
                    id_of(ca),
                    id_of(cb),
                    s(ca, "evidence").unwrap_or(""),
                    s(cb, "evidence").unwrap_or(""),
                ))
            } else {
                Some((
                    id_of(cb),
                    id_of(ca),
                    s(cb, "evidence").unwrap_or(""),
                    s(ca, "evidence").unwrap_or(""),
                ))
            }
        };
        match dom {
            Some((win, lose, we, le)) => {
                blk.extra.push(("resolvable".into(), Value::Bool(true)));
                blk.extra
                    .push(("supersede".into(), Value::String(lose.into())));
                blk.extra.push(("keep".into(), Value::String(win.into())));
                blk.extra
                    .push(("reason".into(), Value::String(format!("{we} > {le}"))));
            }
            None => blk.extra.push(("resolvable".into(), Value::Bool(false))),
        }
        blockers.push(blk);
    }

    // 1b. dependency integrity (truth-maintenance)
    for c in &active {
        match c.get("depends_on") {
            Some(Value::Array(deps)) => {
                for dep in deps {
                    let dep = dep.as_str().unwrap_or("");
                    let stale =
                        dep == id_of(c) || by_id(dep).map(|d| !is_active(d)).unwrap_or(true);
                    if stale {
                        let mut blk = b("E_STALE_DEPENDENT", id_of(c));
                        blk.extra
                            .push(("depends_on".into(), Value::String(dep.into())));
                        blockers.push(blk);
                    }
                }
            }
            Some(_) => blockers.push(b("E_SCHEMA", id_of(c))), // present-but-malformed must not fail open
            None => {}
        }
    }

    // 2. undischarged risk
    for c in &active {
        if s(c, "type") == Some("risk") && !discharged(c) {
            let mut blk = b("E_OPEN_RISK", id_of(c));
            if let Some(t) = s(c, "topic") {
                blk.extra.push(("topic".into(), Value::String(t.into())));
            }
            blockers.push(blk);
        }
    }

    // 3. load-bearing below the evidence bar
    for c in &active {
        if is_load_bearing(c) && !is_abstention(c) {
            let bar = if s(c, "type") == Some("recommendation") {
                &bar_rec
            } else {
                &bar_lb
            };
            if tier_rank(s(c, "evidence").unwrap_or("")) < tier_rank(bar) {
                let mut blk = b("E_WEAK_LOADBEARING", id_of(c));
                blk.extra.push((
                    "have".into(),
                    Value::String(s(c, "evidence").unwrap_or("").into()),
                ));
                blk.extra.push(("need".into(), Value::String(bar.clone())));
                blockers.push(blk);
            }
        }
    }

    // 4. load-bearing abstention is an open front
    for c in &active {
        if is_abstention(c) && is_load_bearing(c) {
            let mut blk = b("E_OPEN_UNKNOWN", id_of(c));
            if let Some(t) = s(c, "topic") {
                blk.extra.push(("topic".into(), Value::String(t.into())));
            }
            blockers.push(blk);
        }
    }

    // ---- temporal checks (need round history; skipped under --no-state) ----
    let mut notes: Vec<String> = vec![];
    let mut warnings: Vec<Blocker> = vec![];
    if active.is_empty() {
        notes.push("EMPTY_LEDGER: no active claims to converge".into());
    }

    // prior state
    let mut prior: Option<Value> = None;
    if state_enabled {
        if let Ok(t) = std::fs::read_to_string(bean_dir.join("state.json")) {
            prior = serde_json::from_str::<Value>(&t).ok();
        }
    }
    let prior_seen: Vec<String> = prior
        .as_ref()
        .and_then(|p| p.get("seen_ids"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let prior_superseded: Vec<String> = prior
        .as_ref()
        .and_then(|p| p.get("superseded_hashes"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let prior_round = prior
        .as_ref()
        .and_then(|p| p.get("round"))
        .and_then(|v| v.as_i64());
    let prior_hash = prior
        .as_ref()
        .and_then(|p| p.get("claims_hash"))
        .and_then(|v| v.as_str())
        .map(String::from);

    // W_REAPPEAR — a superseded/rejected claim resurrected as active
    for c in &active {
        if prior_superseded.contains(&content_hash(c)) {
            warnings.push(b("W_REAPPEAR", id_of(c)));
        }
    }

    let mut active_ids: Vec<String> = active.iter().map(|c| id_of(c).to_string()).collect();
    active_ids.sort();
    let new_this_round = active_ids
        .iter()
        .filter(|id| !prior_seen.contains(id))
        .count();

    // claims_hash: per-claim "id\0contentHash\0evidence" lines, sorted, concatenated. The
    // reference uses NUL delimiters (they render as spaces in a terminal — match the bytes).
    let mut hash_lines: Vec<String> = active
        .iter()
        .map(|c| {
            format!(
                "{}\u{0}{}\u{0}{}",
                id_of(c),
                content_hash(c),
                s(c, "evidence").unwrap_or("")
            )
        })
        .collect();
    hash_lines.sort();
    let claims_hash = sha_hex(&hash_lines.join(""));

    let dry = prior.is_some() && prior_hash.as_deref() == Some(claims_hash.as_str());
    let round = match prior_round {
        Some(r) => r + if dry { 0 } else { 1 },
        None => 1,
    };
    let open_fronts = !blockers.is_empty();
    if dry && open_fronts {
        notes.push("DRY_ROUND_STUCK: a full round added nothing yet open fronts remain".into());
    }
    if dry && !open_fronts {
        notes.push("DRY_ROUND_CONVERGED".into());
    }
    let over_budget = max_rounds.map(|m| round > m).unwrap_or(false);
    if over_budget {
        notes.push(format!(
            "OVER_BUDGET: round {round} > max {} — deliver with open fronts named",
            max_rounds.unwrap()
        ));
    }

    let status = if over_budget {
        "budget-exceeded"
    } else if !blockers.is_empty() {
        "blocked"
    } else {
        "ready"
    };

    // certificate: sha256(JSON({status, admitted})), admitted = sorted [id,evidence,hash].
    // Hand-built to match JS JSON.stringify byte-for-byte (status-first key order, compact).
    let mut admitted: Vec<[String; 3]> = active
        .iter()
        .map(|c| {
            [
                id_of(c).to_string(),
                s(c, "evidence").unwrap_or("").to_string(),
                content_hash(c),
            ]
        })
        .collect();
    admitted.sort_by(|x, y| x[0].cmp(&y[0]));
    let cert_str = format!(
        "{{\"status\":{},\"admitted\":{}}}",
        serde_json::to_string(status).unwrap(),
        serde_json::to_string(&admitted).unwrap(),
    );
    let certificate = sha_hex(&cert_str)[..16].to_string();

    // write next state (unless --no-state)
    if state_enabled {
        let mut seen: Vec<String> = prior_seen.clone();
        for id in &active_ids {
            if !seen.contains(id) {
                seen.push(id.clone());
            }
        }
        seen.sort();
        let mut superseded: Vec<String> = prior_superseded.clone();
        for c in &valid {
            let st = status_of(c);
            if st == "superseded" || st == "rejected" {
                let h = content_hash(c);
                if !superseded.contains(&h) {
                    superseded.push(h);
                }
            }
        }
        let next = serde_json::json!({
            "round": round,
            "seen_ids": seen,
            "superseded_hashes": superseded,
            "claims_hash": claims_hash,
        });
        let _ = std::fs::write(
            bean_dir.join("state.json"),
            serde_json::to_string_pretty(&next).unwrap() + "\n",
        );
    }

    if json_out {
        let to_json = |x: &Blocker| -> Value {
            let mut m = serde_json::Map::new();
            m.insert("code".into(), Value::String(x.code.clone()));
            m.insert("claim".into(), Value::String(x.claim.clone()));
            for (k, v) in &x.extra {
                m.insert(k.clone(), v.clone());
            }
            Value::Object(m)
        };
        let out = serde_json::json!({
            "status": status,
            "blockers": blockers.iter().map(to_json).collect::<Vec<_>>(),
            "warnings": warnings.iter().map(to_json).collect::<Vec<_>>(),
            "notes": notes,
            "round": round,
            "max_rounds": max_rounds,
            "new_this_round": new_this_round,
            "dry": dry,
            "certificate": certificate,
        });
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        println!(
            "bean-check: {} (cert {})",
            status.to_uppercase(),
            certificate
        );
    }

    exit(match status {
        "ready" => 0,
        "budget-exceeded" => 2,
        _ => 1,
    });
}
