// bean-run — the driver that COUPLES the runtime to execution (Rust, bean 2.0).
//
// bean-check is a passive adjudicator a model invokes when it remembers to. bean-run owns the
// round-loop and drives an agent step-by-step on the injected compiler signal, so the agent
// cannot drift past the runtime. The runtime drives; the agent reasons.
//
//   bean-run --dir <path> --agent "<command>" [--max-rounds N] [--json]
//
// Per round: (1) compile via the sibling bean-check binary, (2) inject the signal + goal +
// ledger into the agent's prompt (stdin), (3) the agent does real work and emits a JSON array
// of claims on stdout, which are upserted into the ledger by id. LINEAR PROGRESS: a round that
// leaves the certificate unchanged while still blocked is STUCK — stop, don't spin.
//
// The agent contract is model-agnostic: --agent is a command; the prompt goes on stdin, claims
// JSON comes back on stdout. Wire "claude -p", "codex exec -", or any script honoring it.
//
// Exit: 0 = converged (ready), 2 = budget-exceeded, 5 = stuck, 3 = usage/load error.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{exit, Command, Stdio};

fn die(code: i32, msg: &str) -> ! {
    eprintln!("bean-run: {msg}");
    exit(code);
}

// locate the sibling bean-check binary (same dir as this executable)
fn bean_check_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().unwrap_or_else(|| Path::new("."));
    let p = dir.join("bean-check");
    if p.exists() {
        p
    } else {
        PathBuf::from("bean-check")
    }
}

fn load_value(p: &Path) -> Option<Value> {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok())
}

fn read_claims(bean_dir: &Path) -> Vec<Value> {
    let raw = load_value(&bean_dir.join("claims.json")).unwrap_or_else(|| die(3, "no claims.json"));
    match raw {
        Value::Array(a) => a,
        Value::Object(o) => match o.get("claims") {
            Some(Value::Array(a)) => a.clone(),
            _ => die(3, "claims.json must be an array or { claims }"),
        },
        _ => die(3, "claims.json must be an array or { claims }"),
    }
}

fn write_claims(bean_dir: &Path, claims: &[Value]) {
    // preserve the { claims: [...] } envelope if the file used one
    let p = bean_dir.join("claims.json");
    let out = match load_value(&p) {
        Some(Value::Object(mut o)) if o.contains_key("claims") => {
            o.insert("claims".into(), Value::Array(claims.to_vec()));
            Value::Object(o)
        }
        _ => Value::Array(claims.to_vec()),
    };
    let _ = std::fs::write(&p, serde_json::to_string_pretty(&out).unwrap() + "\n");
}

// pull the last TOP-LEVEL JSON array from the agent's stdout (string-aware; claims contain
// nested arrays, so a naive lastIndexOf('[') would grab a nested bracket).
fn parse_claims(out: &str) -> Vec<Value> {
    let (mut depth, mut start, mut in_str, mut esc) = (0i32, -1i64, false, false);
    let bytes = out.as_bytes();
    let mut spans: Vec<(usize, usize)> = vec![];
    for (i, &ch) in bytes.iter().enumerate() {
        if in_str {
            if esc {
                esc = false;
            } else if ch == b'\\' {
                esc = true;
            } else if ch == b'"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            b'"' => in_str = true,
            b'[' => {
                if depth == 0 {
                    start = i as i64;
                }
                depth += 1;
            }
            b']' => {
                depth -= 1;
                if depth == 0 && start >= 0 {
                    spans.push((start as usize, i + 1));
                }
            }
            _ => {}
        }
    }
    for (a, b) in spans.iter().rev() {
        if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&out[*a..*b]) {
            return arr.into_iter().filter(|c| c.get("id").and_then(|v| v.as_str()).is_some()).collect();
        }
    }
    vec![]
}

fn id_of(c: &Value) -> &str {
    c.get("id").and_then(|v| v.as_str()).unwrap_or("")
}
fn is_active(c: &Value) -> bool {
    let st = c.get("status").and_then(|v| v.as_str()).unwrap_or("");
    st != "superseded" && st != "rejected" && st != "resolved"
}

// upsert emitted claims into the ledger by id; returns count of new/changed
fn upsert(ledger: &mut Vec<Value>, emitted: Vec<Value>) -> usize {
    let mut changed = 0;
    for c in emitted {
        let cid = id_of(&c).to_string();
        if let Some(slot) = ledger.iter_mut().find(|x| id_of(x) == cid) {
            // shallow-merge emitted fields over the existing claim
            if let (Value::Object(dst), Value::Object(src)) = (&mut *slot, &c) {
                let before = serde_json::to_string(dst).unwrap();
                for (k, v) in src {
                    dst.insert(k.clone(), v.clone());
                }
                if serde_json::to_string(dst).unwrap() != before {
                    changed += 1;
                }
            }
        } else {
            ledger.push(c);
            changed += 1;
        }
    }
    changed
}

fn render_prompt(goal: &str, sig: &Value, claims: &[Value]) -> String {
    let active: Vec<&Value> = claims.iter().filter(|c| is_active(c)).collect();
    let ledger = if active.is_empty() {
        "  (empty)".to_string()
    } else {
        active
            .iter()
            .map(|c| {
                format!(
                    "  - {} [{}/{}] {}: {}",
                    id_of(c),
                    c.get("type").and_then(|v| v.as_str()).unwrap_or(""),
                    c.get("evidence").and_then(|v| v.as_str()).unwrap_or(""),
                    c.get("topic").and_then(|v| v.as_str()).unwrap_or(""),
                    c.get("content").and_then(|v| v.as_str()).unwrap_or("").chars().take(120).collect::<String>(),
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let blockers = sig.get("blockers").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let blk = if blockers.is_empty() {
        "  (none)".to_string()
    } else {
        blockers
            .iter()
            .map(|b| {
                format!(
                    "  - {} {}",
                    b.get("code").and_then(|v| v.as_str()).unwrap_or(""),
                    b.get("claim").and_then(|v| v.as_str()).unwrap_or("")
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "You are one round of a bean convergence loop. The runtime compiled the ledger; act on \
THIS signal — drive the most decisive open front, do not restate the plan.\n\nGOAL: {goal}\n\n\
COMPILER SIGNAL: status={}, certificate={}\nOPEN BLOCKERS (drive one to a terminal state):\n{}\n\n\
LEDGER (active claims):\n{}\n\nDo the real work to drive the top blocker, then emit ONLY a JSON \
array of claim objects recording what you established (new claims or upserts by id). Emit [] if \
nothing changed. The JSON array must be the LAST thing you print, on its own.",
        sig.get("status").and_then(|v| v.as_str()).unwrap_or(""),
        sig.get("certificate").and_then(|v| v.as_str()).unwrap_or(""),
        blk,
        ledger,
    )
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut dir = std::env::current_dir().unwrap().to_string_lossy().to_string();
    let mut agent = String::new();
    let mut max_rounds = 8i64;
    let mut json_out = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--dir" => {
                i += 1;
                dir = args.get(i).cloned().unwrap_or_else(|| die(3, "--dir requires a path"));
            }
            "--agent" => {
                i += 1;
                agent = args.get(i).cloned().unwrap_or_else(|| die(3, "--agent requires a command"));
            }
            "--max-rounds" => {
                i += 1;
                max_rounds = args.get(i).and_then(|x| x.parse().ok()).unwrap_or_else(|| die(3, "--max-rounds needs an int"));
            }
            "--json" => json_out = true,
            "-h" | "--help" => {
                println!("bean-run --dir <path> --agent \"<command>\" [--max-rounds N] [--json]");
                exit(0);
            }
            other => die(3, &format!("unknown argument: {other}")),
        }
        i += 1;
    }
    if agent.is_empty() {
        die(3, "--agent <command> is required");
    }
    let agent_argv: Vec<&str> = agent.split_whitespace().collect();
    let bean_dir = Path::new(&dir).join(".bean");
    let check = bean_check_path();
    let goal = load_value(&bean_dir.join("run.json"))
        .and_then(|r| r.get("goal").and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_else(|| "(no goal set in run.json)".into());

    let compile = || -> Value {
        let o = Command::new(&check)
            .args(["--dir", &dir, "--json", "--no-state"])
            .output()
            .unwrap_or_else(|e| die(3, &format!("bean-check failed: {e}")));
        serde_json::from_slice(&o.stdout).unwrap_or_else(|_| die(3, "bean-check did not return JSON"))
    };

    let mut trace: Vec<Value> = vec![];
    let mut outcome = "stuck";
    let mut prev_cert: Option<String> = None;
    for round in 1..=max_rounds {
        let mut claims = read_claims(&bean_dir);
        let sig = compile();
        let status = sig.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let cert = sig.get("certificate").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let has_blockers = sig.get("blockers").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false);
        if status == "ready" {
            outcome = "ready";
            break;
        }
        if status == "budget-exceeded" {
            outcome = "budget-exceeded";
            break;
        }
        if prev_cert.as_deref() == Some(cert.as_str()) && has_blockers {
            outcome = "stuck";
            break;
        }
        prev_cert = Some(cert.clone());
        let prompt = render_prompt(&goal, &sig, &claims);
        let out = Command::new(agent_argv[0])
            .args(&agent_argv[1..])
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                child.stdin.take().unwrap().write_all(prompt.as_bytes())?;
                child.wait_with_output()
            })
            .unwrap_or_else(|e| die(3, &format!("agent command failed: {e}")));
        let emitted = parse_claims(&String::from_utf8_lossy(&out.stdout));
        let recorded = upsert(&mut claims, emitted);
        write_claims(&bean_dir, &claims);
        trace.push(serde_json::json!({ "round": round, "status": status, "certificate": cert, "recorded": recorded }));
        if !json_out {
            eprintln!("bean-run: round {round} {status} (cert {cert}) — recorded {recorded} claim(s)");
        }
    }

    let final_sig = compile();
    let report = serde_json::json!({
        "outcome": outcome,
        "rounds": trace.len(),
        "final_status": final_sig.get("status"),
        "certificate": final_sig.get("certificate"),
        "trace": trace,
    });
    if json_out {
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    } else {
        println!(
            "bean-run: {} after {} round(s) — {} (cert {})",
            outcome,
            trace.len(),
            final_sig.get("status").and_then(|v| v.as_str()).unwrap_or(""),
            final_sig.get("certificate").and_then(|v| v.as_str()).unwrap_or("")
        );
    }
    exit(match outcome {
        "ready" => 0,
        "budget-exceeded" => 2,
        "stuck" => 5,
        _ => 1,
    });
}
