// bean-check — bean's convergence compiler, Rust runtime (bean 2.0 north star).
//
// Reconverges with the Bran core (already Rust): a single static binary with no install
// dependency — the portability bean-check.js could not give, since Node is itself a dep.
// This first bootstrap slice ports the STATIC checks (no temporal state, no oracle gate)
// and is held to the JS reference by a differential conformance oracle (test/conformance.mjs):
// JS and Rust must agree on status + blockers + the deterministic certificate for every fixture.
//
//   bean-check --dir <path> [--json] [--no-state]
//
// Exit: 0 = ready, 1 = blocked, 3 = usage/load error. (budget/temporal land in a later slice.)

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
    TIERS.iter().position(|&x| x == t).map(|i| i as i32).unwrap_or(-1)
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
    Blocker { code: code.into(), claim: claim.into(), extra: vec![] }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut dir = std::env::current_dir().unwrap().to_string_lossy().to_string();
    let mut json_out = false;
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
            "--no-state" => {} // static slice is always stateless
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

    // run.json (only evidence_bar is read by this slice; defaults match the JS DEFAULT_RUN)
    let mut bar_lb = "tested".to_string();
    let mut bar_rec = "documented".to_string();
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
            && s(c, "evidence").map(|e| TIERS.contains(&e)).unwrap_or(false);
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
                let (a, bb) = if id_of(c) < id_of(o) { (id_of(c), id_of(o)) } else { (id_of(o), id_of(c)) };
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
            blk.extra.push(("topic".into(), Value::String(topic.into())));
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
                Some((id_of(ca), id_of(cb), s(ca, "evidence").unwrap_or(""), s(cb, "evidence").unwrap_or("")))
            } else {
                Some((id_of(cb), id_of(ca), s(cb, "evidence").unwrap_or(""), s(ca, "evidence").unwrap_or("")))
            }
        };
        match dom {
            Some((win, lose, we, le)) => {
                blk.extra.push(("resolvable".into(), Value::Bool(true)));
                blk.extra.push(("supersede".into(), Value::String(lose.into())));
                blk.extra.push(("keep".into(), Value::String(win.into())));
                blk.extra.push(("reason".into(), Value::String(format!("{we} > {le}"))));
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
                    let stale = dep == id_of(c) || by_id(dep).map(|d| !is_active(d)).unwrap_or(true);
                    if stale {
                        let mut blk = b("E_STALE_DEPENDENT", id_of(c));
                        blk.extra.push(("depends_on".into(), Value::String(dep.into())));
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
            let bar = if s(c, "type") == Some("recommendation") { &bar_rec } else { &bar_lb };
            if tier_rank(s(c, "evidence").unwrap_or("")) < tier_rank(bar) {
                let mut blk = b("E_WEAK_LOADBEARING", id_of(c));
                blk.extra.push(("have".into(), Value::String(s(c, "evidence").unwrap_or("").into())));
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

    let status = if blockers.is_empty() { "ready" } else { "blocked" };

    // certificate: sha256(JSON({status, admitted})) where admitted = sorted [id,evidence,hash].
    // Serialized identically to JS JSON.stringify (compact, status-then-admitted, sorted by id).
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
    // Match JS `JSON.stringify({status, admitted})` BYTE FOR BYTE: keys in insertion order
    // (status first), compact, no spaces. serde_json's Value sorts keys alphabetically, so
    // the cert object is hand-built; the admitted array serializes identically either way.
    let cert_str = format!(
        "{{\"status\":{},\"admitted\":{}}}",
        serde_json::to_string(status).unwrap(),
        serde_json::to_string(&admitted).unwrap(),
    );
    let certificate = sha_hex(&cert_str)[..16].to_string();

    if json_out {
        let blk_json: Vec<Value> = blockers
            .iter()
            .map(|x| {
                let mut m = serde_json::Map::new();
                m.insert("code".into(), Value::String(x.code.clone()));
                m.insert("claim".into(), Value::String(x.claim.clone()));
                for (k, v) in &x.extra {
                    m.insert(k.clone(), v.clone());
                }
                Value::Object(m)
            })
            .collect();
        let out = serde_json::json!({
            "status": status,
            "blockers": blk_json,
            "certificate": certificate,
        });
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        println!("bean-check: {} (cert {})", status.to_uppercase(), certificate);
    }

    exit(if status == "ready" { 0 } else { 1 });
}
