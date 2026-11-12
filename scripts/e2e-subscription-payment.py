#!/usr/bin/env python3
"""Live E2E: shop-owner -> super-admin subscription payment flow on production.
Covers: plan QR (platform UPI), UTR submit, super verify, activation, negatives."""
import json, sys, requests

BASE = "https://copysahaayak.vercel.app"
OWNER_A = {"email": "contact.grahicsworld@gmail.com", "password": "Cs-Shop-2026-Secure!x"}
SUPER = {"email": "vedpackagingindustries@gmail.com", "password": "Manish@1983"}

PASS, FAIL = 0, 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}  {detail}")
    else:    FAIL += 1; print(f"  FAIL  {name}  {detail}")

oa = requests.Session()
r = oa.post(f"{BASE}/api/auth/login", json=OWNER_A, timeout=30)
check("owner A login", r.status_code == 200, f"status={r.status_code}")

# ---------- 1. current subscription state ----------
r = oa.get(f"{BASE}/api/admin/subscription", timeout=30)
sub = r.json()
plans = {p["code"]: p for p in (sub.get("plans") or [])}
check("subscription info loads", r.status_code == 200 and plans, f"plans={[c for c in plans]}")
print(f"  current subscription: {json.dumps((sub.get('subscription') or {}) and {k: sub['subscription'][k] for k in ('status','expiresAt')} or None)}")
print(f"  platform UPI (settings): {sub.get('superAdminUpi')} / {sub.get('superAdminPayee')}")

# ---------- 2. plan QR ----------
r = oa.get(f"{BASE}/api/admin/subscription/qr?planCode=STARTER", timeout=30)
qr = r.json()
payload = qr.get("payload") or ""
print(f"\n  plan QR payload: {payload}")
check("plan QR generated", r.status_code == 200 and payload.startswith("upi://pay?"), f"status={r.status_code}")
check("plan QR pays PLATFORM upi (from settings)", "pa=" in payload and qr.get("vpa") == sub.get("superAdminUpi") and qr.get("vpa", "") in payload.replace("%40", "@"))
check("plan QR raw @ (not %40)", "pa=" in payload and "%40" not in payload.split("pa=")[1].split("&")[0])
check("plan QR %20 spaces", "pn=" in payload and "+" not in payload.split("pn=")[1].split("&")[0])
check("plan QR amount = STARTER price", f"am={(plans.get('STARTER') or {}).get('pricePaise', 0) / 100:.2f}" in payload, f"am in payload")

# negative: bad plan code
r = oa.get(f"{BASE}/api/admin/subscription/qr?planCode=XXX", timeout=30)
check("bad plan code rejected (400)", r.status_code == 400, f"status={r.status_code}")

# ---------- 3. negative: bad UTR ----------
r = oa.post(f"{BASE}/api/admin/subscription", json={"planCode": "STARTER", "utr": "short"}, timeout=30)
check("bad UTR rejected (400)", r.status_code == 400, f"status={r.status_code}")

# ---------- 4. clear any stale PENDING first ----------
r = oa.get(f"{BASE}/api/admin/subscription", timeout=30)
pend = [p for p in (r.json().get("payments") or []) if p.get("status") == "PENDING"]
if pend:
    print(f"  NOTE: {len(pend)} stale PENDING payment(s) exist — will be resolved by super admin in this test")

# ---------- 5. submit STARTER payment UTR ----------
utr = "SUBE2E" + str(abs(hash("sub")) % 100000000).zfill(9)[:13]
r = oa.post(f"{BASE}/api/admin/subscription", json={"planCode": "STARTER", "utr": utr, "payerName": "E2E Owner"}, timeout=30)
if r.status_code == 409:
    print("  existing PENDING found — using it instead of creating new")
    check("UTR submit handled (existing pending)", True, f"status=409 (expected reuse)")
else:
    check("subscription UTR submitted", r.status_code == 200 and r.json().get("ok"), f"status={r.status_code} utr={utr}")

# negative: second pending payment must 409
r = oa.post(f"{BASE}/api/admin/subscription", json={"planCode": "STARTER", "utr": "SECONDPENDING1"}, timeout=30)
check("second pending blocked (409)", r.status_code == 409, f"status={r.status_code}")

# ---------- 6. super admin queue ----------
su = requests.Session()
r = su.post(f"{BASE}/api/auth/login", json=SUPER, timeout=30)
check("super admin login", r.status_code == 200, f"status={r.status_code}")

# negative: shop owner must NOT access super queue
r = oa.get(f"{BASE}/api/super/subpayments?status=PENDING", timeout=30)
check("owner blocked from super queue (401/403)", r.status_code in (401, 403), f"status={r.status_code}")

r = su.get(f"{BASE}/api/super/subpayments?status=PENDING", timeout=30)
pays = r.json().get("payments") or []
target = next((p for p in pays if p.get("shop", {}).get("slug") == "mansa"), None)
check("payment in super admin queue", target is not None, f"status={r.status_code} queue={len(pays)}")

if target:
    pid = target["id"]
    # negative: bad action value
    r = su.post(f"{BASE}/api/super/subpayments?id={pid}", json={"action": "HACK"}, timeout=30)
    check("invalid action rejected (400)", r.status_code == 400, f"status={r.status_code}")

    # super admin VERIFIES
    r = su.post(f"{BASE}/api/super/subpayments?id={pid}", json={"action": "VERIFY", "note": "E2E verified"}, timeout=30)
    check("super admin verifies subscription payment", r.status_code == 200 and r.json().get("ok"), f"status={r.status_code}")

    # double process blocked
    r = su.post(f"{BASE}/api/super/subpayments?id={pid}", json={"action": "VERIFY"}, timeout=30)
    check("double-verify rejected (409)", r.status_code == 409, f"status={r.status_code}")

    # ---------- 7. activation check ----------
    r = oa.get(f"{BASE}/api/admin/subscription", timeout=30)
    s2 = r.json().get("subscription") or {}
    check("subscription now ACTIVE with STARTER", s2.get("status") == "ACTIVE" and (s2.get("plan") or {}).get("code") == "STARTER",
          f"status={s2.get('status')} plan={(s2.get('plan') or {}).get('code')} expires={s2.get('expiresAt')}")

print(f"\nRESULT: {PASS} pass / {FAIL} fail")
sys.exit(1 if FAIL else 0)
