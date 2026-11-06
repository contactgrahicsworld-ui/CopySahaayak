#!/usr/bin/env python3
"""
Live production E2E for the plan downgrade path (owner self-service + super reset).
All mutations happen on a THROWAWAY shop that is fully deleted (super offboard)
at the end — zero residue on real shops. The test UTR is submitted, verified and
the whole shop (payments, notifications, subscription) is removed afterwards.
"""
import json, os, re, sys, time, uuid
import urllib.request, urllib.error, http.cookiejar

BASE = "https://copysahaayak.vercel.app"
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "..", ".audit-credentials.json")) as f:
    _cred = json.load(f)
SUPER = {"email": _cred["super_email"], "password": _cred["super_password"]}

TAG = uuid.uuid4().hex[:8]
SLUG = f"dgtest-{TAG}"
OWNER_EMAIL = f"dgtest-{TAG}@example.com"
OWNER_PASS = "DgTest2026!"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS  " if cond else "FAIL  ") + name + (("  | " + str(detail)[:220]) if detail and not cond else ""))


def opener_with_jar():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def req(op, method, path, body=None, headers=None):
    url = BASE + path
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        resp = op.open(r, timeout=60)
        content, status = resp.read(), resp.status
    except urllib.error.HTTPError as e:
        content, status = e.read(), e.code
    try:
        return status, json.loads(content.decode() or "{}")
    except Exception:
        return status, {"_raw": content.decode(errors="replace")[:200]}


# ---------- sessions ----------
superop, _ = opener_with_jar()
s, d = req(superop, "POST", "/api/auth/login", SUPER)
check("super login", s == 200, (s, d))

ownop, _ = opener_with_jar()
anonop, _ = opener_with_jar()

# ---------- register throwaway shop ----------
s, d = req(ownop, "POST", "/api/register", {
    "ownerName": "Downgrade Test",
    "email": OWNER_EMAIL,
    "password": OWNER_PASS,
    "shopName": "Downgrade Test Shop",
    "slug": SLUG,
})
check("throwaway shop registered", s == 200 and d.get("shopSlug") == SLUG, (s, d))
SHOP_ID = ""
s, d = req(ownop, "GET", "/api/admin/shop")
SHOP_ID = d.get("shop", {}).get("id", "")
check("shop id captured", len(SHOP_ID) > 10, d)


def plan_code(op):
    s, d = req(op, "GET", "/api/admin/subscription")
    sub = d.get("subscription") or {}
    return s, ((sub.get("plan") or {}).get("code", "?")), (sub.get("status") or "?")


# ---------- FREE baseline + negatives ----------
s, code, status = plan_code(ownop)
check("new shop starts on FREE", s == 200 and code == "FREE", (s, code, status))

s, d = req(ownop, "POST", "/api/admin/subscription/downgrade")
check("downgrade on FREE -> 400", s == 400, (s, d))

s, d = req(anonop, "POST", "/api/admin/subscription/downgrade")
check("downgrade unauthenticated -> 401", s == 401, (s, d))

s, d = req(superop, "POST", "/api/admin/subscription/downgrade")
check("downgrade as super -> 403", s == 403, (s, d))

# ---------- pay STARTER, expect downgrade blocked while payment pending ----------
s, d = req(ownop, "POST", "/api/admin/subscription", {
    "planCode": "STARTER", "utr": f"TESTDG{TAG[:6].upper()}",
    "payerName": "Downgrade E2E",
})
check("STARTER UTR submitted", s == 200 and d.get("ok"), (s, d))
PAYMENT_ID = d.get("paymentId", "")

s, d = req(ownop, "POST", "/api/admin/subscription/downgrade")
check("downgrade blocked while payment pending -> 409", s == 409, (s, d))

# ---------- super verifies -> STARTER active ----------
s, d = req(superop, "POST", f"/api/super/subpayments?id={PAYMENT_ID}", {"action": "VERIFY"})
check("super verifies payment", s == 200, (s, d))
s, code, status = plan_code(ownop)
check("shop now on STARTER", code == "STARTER" and status == "ACTIVE", (code, status))

# ---------- super RESET_PLAN_FREE ----------
s, d = req(superop, "PATCH", f"/api/super/shops/{SHOP_ID}", {"action": "RESET_PLAN_FREE"})
check("super RESET_PLAN_FREE -> 200", s == 200 and d.get("ok"), (s, d))
s, code, status = plan_code(ownop)
check("after super reset shop on FREE", code == "FREE" and status == "ACTIVE", (code, status))

# ---------- pay STARTER again, owner self-service downgrade ----------
s, d = req(ownop, "POST", "/api/admin/subscription", {
    "planCode": "STARTER", "utr": f"TESTDG{TAG[:6].upper()}X",
    "payerName": "Downgrade E2E 2",
})
check("second STARTER UTR submitted", s == 200 and d.get("ok"), (s, d))
s, d = req(superop, "POST", f"/api/super/subpayments?id={d.get('paymentId', '')}", {"action": "VERIFY"})
check("second payment verified", s == 200, (s, d))
s, code, status = plan_code(ownop)
check("shop on STARTER again", code == "STARTER" and status == "ACTIVE", (code, status))

s, d = req(ownop, "POST", "/api/admin/subscription/downgrade")
check("owner downgrade -> 200", s == 200 and d.get("planCode") == "FREE", (s, d))
s, code, status = plan_code(ownop)
check("after owner downgrade shop on FREE", code == "FREE" and status == "ACTIVE", (code, status))

s, d = req(ownop, "GET", "/api/admin/subscription")
hist = [p for p in d.get("payments", []) if p.get("status") == "VERIFIED"]
check("payment history preserved after downgrade", len(hist) == 2, len(hist))

# ---------- super shops list shows FREE plan code ----------
s, d = req(superop, "GET", f"/api/super/shops?q={SLUG}")
rows = d.get("shops", [])
row = rows[0] if rows else {}
check("super list shows plan code FREE", (row.get("subscription", {}) or {}).get("plan", {}).get("code") == "FREE",
      (row.get("subscription") or {}).get("plan"))

# ---------- full offboard cleanup ----------
s, d = req(superop, "DELETE", f"/api/super/shops/{SHOP_ID}", {"confirm": SLUG})
check("throwaway shop deleted", s == 200 and d.get("ok"), (s, str(d)[:200]))

freshop, _ = opener_with_jar()
s, d = req(freshop, "POST", "/api/auth/login", {"email": OWNER_EMAIL, "password": OWNER_PASS})
check("deleted owner cannot log in", s in (401, 400), (s, d))

s, d = req(superop, "GET", f"/api/super/shops?q={SLUG}")
check("shop gone from super list", s == 200 and not d.get("shops"), (s, d))

# ---------- summary ----------
fails = [r for r in results if not r[1]]
print(f"\n======== DOWNGRADE E2E SUMMARY ========")
print(f"TOTAL: {len(results)}  PASS: {len(results) - len(fails)}  FAIL: {len(fails)}")
sys.exit(1 if fails else 0)
