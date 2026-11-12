#!/usr/bin/env python3
"""Live E2E: customer -> shop-owner payment flow on production.
Tests happy path AND negative paths. Prints evidence for every step."""
import json, sys, requests, re

BASE = "https://copysahaayak.vercel.app"
OWNER_A = {"email": "contact.grahicsworld@gmail.com", "password": "Cs-Shop-2026-Secure!x"}
OWNER_B = {"email": "cscrjn85@gmail.com", "password": "Cs-Shop-2026-Secure!x"}
SLUG = "mansa"

PASS, FAIL = 0, 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}  {detail}")
    else:    FAIL += 1; print(f"  FAIL  {name}  {detail}")

s = requests.Session()  # customer session

# ---------- 1. customer session ----------
r = s.post(f"{BASE}/api/shops/{SLUG}/session", json={}, timeout=30)
check("customer session created", r.status_code == 200, f"status={r.status_code}")

# ---------- 2. upload ----------
with open("/tmp/test-doc.pdf", "rb") as f:
    r = s.post(f"{BASE}/api/shops/{SLUG}/uploads",
               files={"file": ("test-doc.pdf", f, "application/pdf")}, timeout=60)
doc = r.json().get("document") or r.json().get("doc") or {}
doc_id = doc.get("id") or r.json().get("documentId")
check("file upload", r.status_code == 200 and doc_id, f"status={r.status_code} docId={str(doc_id)[:12]}...")

# ---------- 3. create order (QR generation moment) ----------
items = [{"documentId": doc_id, "colorMode": "BW", "paperSize": "A4", "duplex": False, "copies": 1}]
r = s.post(f"{BASE}/api/shops/{SLUG}/orders", json={"items": items, "customerName": "E2E Test Customer"}, timeout=30)
o = r.json().get("order") or r.json()
order_number = o.get("orderNumber")
upi = o.get("upi") or {}
payload = upi.get("payload") or ""
check("order created with payment", r.status_code == 200 and order_number, f"status={r.status_code} order={order_number}")

# ---------- 4. THE CRITICAL CHECK: UPI payload encoding ----------
print(f"\n  QR payload: {payload}")
check("payload is upi://pay deep link", payload.startswith("upi://pay?"))
check("pa has RAW @ (not %40)", "pa=" in payload and "%40" not in payload.split("pa=")[1].split("&")[0],
      f"pa={payload.split('pa=')[1].split('&')[0] if 'pa=' in payload else 'MISSING'}")
check("pn spaces are %20 (not +)", "pn=" in payload and "+" not in payload.split("pn=")[1].split("&")[0])
check("amount present", "am=" in payload)
check("txn ref matches order (alphanumeric per UPI spec)", "tr=" in payload and order_number.replace("-", "") in payload.replace("-", ""), f"tr in payload")
check("currency INR", "cu=INR" in payload)

# ---------- 5. negative: bad UTR format ----------
r = s.post(f"{BASE}/api/shops/{SLUG}/orders/{order_number}/utr", json={"utr": "123"}, timeout=30)
check("reject short UTR (400)", r.status_code == 400, f"status={r.status_code}")

# ---------- 6. submit valid UTR ----------
utr = "E2EUTR" + str(abs(hash(order_number)) % 100000000).zfill(9)[:15]
r = s.post(f"{BASE}/api/shops/{SLUG}/orders/{order_number}/utr", json={"utr": utr, "payerName": "E2E Customer"}, timeout=30)
check("UTR submitted", r.status_code == 200 and r.json().get("ok"), f"status={r.status_code} utr={utr}")

# ---------- 7. negative: double UTR submit ----------
r = s.post(f"{BASE}/api/shops/{SLUG}/orders/{order_number}/utr", json={"utr": "SECONDUTR12345"}, timeout=30)
check("reject duplicate UTR (409)", r.status_code == 409, f"status={r.status_code} body={r.text[:80]}")

# ---------- 8. owner A verifies ----------
oa = requests.Session()
r = oa.post(f"{BASE}/api/auth/login", json=OWNER_A, timeout=30)
check("owner A login", r.status_code == 200, f"status={r.status_code}")

r = oa.get(f"{BASE}/api/admin/payments?status=SUBMITTED", timeout=30)
data = r.json()
pays = data.get("payments") or data.get("items") or (data if isinstance(data, list) else [])
target = next((p for p in pays if p.get("orderNumber") == order_number or p.get("utr") == utr), None)
check("payment visible in owner A queue", target is not None,
      f"status={r.status_code} queue={len(pays)} target={'found' if target else 'NOT FOUND'}")

if target:
    pid = target["id"]
    # negative: owner B (different tenant) must NOT verify it
    ob = requests.Session()
    r = ob.post(f"{BASE}/api/auth/login", json=OWNER_B, timeout=30)
    if r.status_code == 200:
        r = ob.post(f"{BASE}/api/admin/payments/{pid}", json={"action": "VERIFY"}, timeout=30)
        check("cross-tenant verify BLOCKED", r.status_code == 404, f"status={r.status_code}")
    else:
        check("owner B login (skip cross-tenant test)", False, f"login status={r.status_code}")

    # owner A verifies for real
    r = oa.post(f"{BASE}/api/admin/payments/{pid}", json={"action": "VERIFY", "note": "E2E verified"}, timeout=30)
    check("owner A verifies payment", r.status_code == 200 and r.json().get("ok"), f"status={r.status_code}")

    # negative: verify again -> already processed
    r = oa.post(f"{BASE}/api/admin/payments/{pid}", json={"action": "VERIFY"}, timeout=30)
    check("double-verify rejected", r.status_code in (400, 404, 409), f"status={r.status_code}")

print(f"\nRESULT: {PASS} pass / {FAIL} fail")
sys.exit(1 if FAIL else 0)
