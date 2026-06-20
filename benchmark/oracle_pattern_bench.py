#!/usr/bin/env python3
# Targeted benchmark: improved oracle (persisted-read + implied post-conditions from the
# task VERB) vs the recorded AppWorld fail/pass cases. Reads the committed SQL change-log
# (what the grader sees). No answer key. Verdict must TRACK the grader on both sides.
import sys, json, re, glob

def ops(exp):
    h=glob.glob(f"<APPWORLD_ROOT>/experiments/outputs/{exp}/tasks/*/dbs/amazon.jsonl")
    out=[]
    if h:
        for ln in open(h[0]):
            try: s=json.loads(ln)[0]
            except: continue
            m=re.match(r'(INSERT INTO|DELETE FROM|UPDATE)\s+([a-z_]+)', s)
            if m: out.append((m.group(1), m.group(2)))
    return out

def has(o, op, tbl): return (op, tbl) in o

def check(exp, verb):
    o=ops(exp); f=[]
    if verb=="buy_wishlist":   # buy everything on wishlist => order created AND items leave wishlist
        if not has(o,"INSERT INTO","orders"): f.append("no persisted order")
        if not has(o,"DELETE FROM","wish_list_entries"): f.append("items not removed from wishlist (implied post-condition)")
    elif verb=="move_to_wishlist":  # move X from cart to wishlist => added to wishlist AND removed from cart
        if not has(o,"INSERT INTO","wish_list_entries"): f.append("items not added to wishlist")
        if not has(o,"DELETE FROM","cart_entries"): f.append("items not removed from cart")
    return ("pass" if not f else "fail"), f

CASES=[  # (exp, verb, grader_verdict)
 ("9871968_1_b1x","buy_wishlist","FAIL(6/7)"),
 ("9871968_1_fix","buy_wishlist","FAIL(1/7)"),
 ("383a053_1_b1x","buy_wishlist","FAIL(1/9)"),     # order-persistence dimension
 ("9bf2c8a_1_b1x","move_to_wishlist","PASS(6/6)"), # real CORRECT answer
]
print(f"{'experiment':18s} {'verb':18s} {'oracle':6s} {'grader':12s} tracks?")
for exp,verb,grader in CASES:
    v,fnd=check(exp,verb)
    grader_pass = grader.startswith("PASS")
    oracle_pass = v=="pass"
    tracks = "YES" if grader_pass==oracle_pass else "NO"
    print(f"{exp:18s} {verb:18s} {v:6s} {grader:12s} {tracks}   {';'.join(fnd)}")
