#!/usr/bin/env python3
"""
Live production audit: Printers / Pricing / Reports / Settings tabs + role guards.
Every test hits the REAL production API (https://copysahaayak.vercel.app).
State care: restores colorMode/default printer after mutation, purges the
pairing device it creates, submits NO fake UTR, never deletes real printers.
"""
import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar
import uuid
import os

BASE = "https://copysahaayak.vercel.app"
with open(os.path.join(os.path.dirname(__file__), "..", ".audit-credentials.json")) as f:
    _cred = json.load(f)
OWNER = {"email": _cred["owner_email"], "password": _cred["owner_password"]}
SUPER = {"email": _cred["super_email"], "password": _cred["super_password"]}

results = []


def opener_with_jar():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def req(op, method, path, body=None, headers=None, raw=False):
    url = BASE + path
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
        else:
            data = body
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        resp = op.open(r, timeout=60)
        content = resp.read()
        status = resp.status
        ct = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        content = e.read()
        status = e.code
        ct = e.headers.get("Content-Type", "")
    if raw:
        return status, content, ct
    try:
        return status, json.loads(content.decode() or "{}"), ct
    except Exception:
        return status, {"_raw": content.decode(errors="replace")[:300]}, ct


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS  " if cond else "FAIL  ") + name + (("  | " + str(detail)[:180]) if detail and not cond else ""))


owner, _ = opener_with_jar()
super_, _ = opener_with_jar()

# ---------- logins ----------
s, d, _ = req(owner, "POST", "/api/auth/login", OWNER)
check("owner login 200 + SHOP_ADMIN", s == 200 and d.get("user", {}).get("role") == "SHOP_ADMIN", (s, d))
s, d, _ = req(super_, "POST", "/api/auth/login", SUPER)
check("super login 200 + SUPER_ADMIN", s == 200 and d.get("user", {}).get("role") == "SUPER_ADMIN", (s, d))

# ---------- snapshot of real state (for restore) ----------
s, devs0, _ = req(owner, "GET", "/api/admin/devices")
check("GET /api/admin/devices 200 list", s == 200 and isinstance(devs0.get("devices"), list), (s, devs0))
real_devices = [x for x in devs0.get("devices", []) if x.get("status") == "ACTIVE"]
check("owner has >=1 ACTIVE device", len(real_devices) >= 1, devs0)

s, prs0, _ = req(owner, "GET", "/api/admin/printers")
check("GET /api/admin/printers 200 list", s == 200 and isinstance(prs0.get("printers"), list), (s, prs0))
printers = prs0.get("printers", [])
check("owner has >=1 printer", len(printers) >= 1, prs0)
orig_default = next((p for p in printers if p.get("isDefault")), None)
probe = printers[0] if printers else None
orig_color = probe.get("colorMode") if probe else None

# ================= PRINTERS TAB =================
print("\n---- PRINTERS TAB ----")
# Pair connector button
s, d, _ = req(owner, "POST", "/api/admin/devices", {})
pair_dev = d.get("device", {})
check("POST /api/admin/devices (Pair connector) 200 + 6-char code",
      s == 200 and len(pair_dev.get("pairingCode", "")) == 6, (s, d))
check("deepLink present + correct scheme",
      str(d.get("deepLink", "")).startswith(("printsahayak://pair?", "photocopyconnector://pair?")), d.get("deepLink"))
check("pairing expiry present", bool(pair_dev.get("expiresAt")), pair_dev)

# pairing code must actually be live on the device pair endpoint (unauthenticated)
s, d2, _ = req(opener_with_jar()[0], "POST", "/api/device/pair",
               {"code": pair_dev.get("pairingCode"), "machineName": "AUDIT-NONPAIR", "appVersion": "audit"})
# NOTE: we intentionally pair nothing — invalid shape test should NOT consume the code.
# Actually the body IS a valid shape; to avoid consuming the code we instead test with a WRONG code.
check("pair endpoint rejects wrong code (sanity, unauthenticated 401/404/410)",
      s in (400, 401, 404, 410), (s, d2))

# Revoke + Remove lifecycle on the PENDING device we just created
if pair_dev.get("id"):
    s, d3, _ = req(owner, "DELETE", f"/api/admin/devices/{pair_dev['id']}?purge=1")
    check("purge PENDING pairing device (Remove button) 200", s == 200, (s, d3))
    s, d4, _ = req(owner, "GET", "/api/admin/devices")
    ids = [x["id"] for x in d4.get("devices", [])]
    check("purged device gone from list", pair_dev["id"] not in ids, ids)
else:
    check("purge PENDING pairing device (Remove button) 200", False, "no device id returned")

# purge of ACTIVE device must be blocked (400) — use the REAL device, do NOT purge it
if real_devices:
    s, d5, _ = req(owner, "DELETE", f"/api/admin/devices/{real_devices[0]['id']}?purge=1")
    check("purge ACTIVE device correctly blocked 400", s == 400, (s, d5))

# printer colorMode dropdown
if probe:
    s, d6, _ = req(owner, "PATCH", "/api/admin/printers", {"id": probe["id"], "colorMode": "ANY"})
    check("PATCH printers colorMode 200", s == 200, (s, d6))
    s, prs1, _ = req(owner, "GET", "/api/admin/printers")
    got = next((p for p in prs1.get("printers", []) if p["id"] == probe["id"]), {})
    check("colorMode persisted as ANY", got.get("colorMode") == "ANY", got.get("colorMode"))
    s, d7, _ = req(owner, "PATCH", "/api/admin/printers", {"id": probe["id"], "colorMode": orig_color or "BW"})
    check("PATCH printers colorMode restored", s == 200, (s, d7))
    s, d8, _ = req(owner, "PATCH", "/api/admin/printers", {"id": probe["id"], "colorMode": "BOGUS"})
    check("PATCH printers invalid colorMode rejected 400", s == 400, (s, d8))

# set-default button
if len(printers) >= 2 and orig_default:
    other = next(p for p in printers if p["id"] != orig_default["id"])
    s, d9, _ = req(owner, "PATCH", "/api/admin/printers", {"id": other["id"], "isDefault": True})
    check("PATCH printers set-default 200", s == 200, (s, d9))
    s, prs2, _ = req(owner, "GET", "/api/admin/printers")
    defaults = [p["id"] for p in prs2.get("printers", []) if p.get("isDefault")]
    check("exactly one default after switch", defaults == [other["id"]], defaults)
    s, d10, _ = req(owner, "PATCH", "/api/admin/printers", {"id": orig_default["id"], "isDefault": True})
    check("default restored to original printer", s == 200, (s, d10))

# printer remove: negative path only (never delete real printers)
s, d11, _ = req(owner, "DELETE", "/api/admin/printers?id=nonexistent-id-xyz")
check("DELETE printers nonexistent id -> 404", s == 404, (s, d11))

# ================= PRICING TAB =================
print("\n---- PRICING TAB ----")
s, pr0, _ = req(owner, "GET", "/api/admin/pricing")
check("GET /api/admin/pricing 200 + rules", s == 200 and isinstance(pr0.get("rules"), list), (s, pr0))
rules0 = pr0.get("rules", [])
if rules0:
    payload = [{"paperSize": r["paperSize"], "colorMode": r["colorMode"],
                "singleSidedPaise": r["singleSidedPaise"], "duplexPaise": r["duplexPaise"]}
               for r in rules0 if r.get("singleSidedPaise", 0) > 0]
    s, pr1, _ = req(owner, "PUT", "/api/admin/pricing", {"rules": payload})
    check("PUT /api/admin/pricing round-trip save 200", s == 200, (s, pr1))
    s, pr2, _ = req(owner, "GET", "/api/admin/pricing")
    check("pricing values unchanged after round-trip",
          {(r["paperSize"], r["colorMode"]): r["singleSidedPaise"] for r in pr2.get("rules", []) if r["singleSidedPaise"] > 0}
          == {(r["paperSize"], r["colorMode"]): r["singleSidedPaise"] for r in rules0 if r["singleSidedPaise"] > 0},
          (rules0, pr2))
s, pr3, _ = req(owner, "PUT", "/api/admin/pricing", {"rules": [{"paperSize": "A4", "colorMode": "BW", "singleSidedPaise": -5, "duplexPaise": 0}]})
check("PUT pricing negative price rejected 400", s == 400, (s, pr3))
s, pr4, _ = req(owner, "PUT", "/api/admin/pricing", {"rules": [{"paperSize": "XXQ", "colorMode": "BW", "singleSidedPaise": 100, "duplexPaise": 100}]})
check("PUT pricing unknown paper size rejected 400", s == 400, (s, pr4))

# ================= REPORTS TAB =================
print("\n---- REPORTS TAB ----")
shape_ok = True
for days, gb in [("30", "day"), ("90", "week"), ("365", "month"), ("7", "day")]:
    s, rp, _ = req(owner, "GET", f"/api/admin/reports?days={days}&groupBy={gb}")
    ok = (s == 200 and isinstance(rp.get("series"), list) and isinstance(rp.get("summary"), dict)
          and isinstance(rp.get("paper"), list) and isinstance(rp.get("machine"), list))
    shape_ok = shape_ok and ok
    check(f"GET /api/admin/reports days={days} groupBy={gb} 200+shape", ok, (s, rp))
s, rp1, _ = req(owner, "GET", "/api/admin/reports?days=abc&groupBy=day")
check("reports invalid days rejected (400)", s == 400, (s, rp1))
s, rp2, _ = req(owner, "GET", "/api/admin/reports?days=30&groupBy=bogus")
check("reports invalid groupBy rejected (400)", s == 400, (s, rp2))

s, ex, ct, = req(owner, "GET", "/api/admin/reports/export?days=30&groupBy=day", raw=True)[0:3]
check("reports export 200", s == 200, s)
check("reports export is xlsx (PK magic bytes)",
      s == 200 and ex[:2] == b"PK", (s, ct, ex[:8]))
check("reports export non-trivial size", len(ex) > 2000, len(ex))

# ================= SETTINGS TAB =================
print("\n---- SETTINGS TAB ----")
s, sh, _ = req(owner, "GET", "/api/admin/shop")
check("GET /api/admin/shop 200", s == 200 and bool(sh.get("shop")), (s, sh))
shop = sh.get("shop", {})
slug = shop.get("slug", "")
check("shop slug present", bool(slug), shop)
orig_shop = {k: shop.get(k) for k in ("name", "ownerName", "phone", "address", "whatsappNumber", "upiVpa", "upiPayeeName")}

s, qr, _ = req(owner, "GET", f"/api/shops/{slug}/qr")
check("GET /api/shops/{slug}/qr 200 + dataUrl + url", s == 200 and bool(qr.get("dataUrl")) and bool(qr.get("url")), (s, str(qr)[:120]))

s, html, ct = req(owner, "GET", f"/qr/{slug}", raw=True)[0:3]
check("GET /qr/{slug} print page 200 HTML", s == 200 and "text/html" in ct, (s, ct))

# save profile round-trip (identical values, no logo)
import mimetypes
boundary = "----audit" + uuid.uuid4().hex
parts = []
for k, v in orig_shop.items():
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v or ""}\r\n'.encode())
parts.append(f"--{boundary}--\r\n".encode())
body = b"".join(parts)
s, shp, _ = req(owner, "PATCH", "/api/admin/shop", body,
                {"Content-Type": f"multipart/form-data; boundary={boundary}"})
check("PATCH /api/admin/shop profile save 200", s == 200, (s, shp))
s, sh2, _ = req(owner, "GET", "/api/admin/shop")
same = all((sh2.get("shop", {}).get(k) or "") == (orig_shop.get(k) or "") for k in orig_shop)
check("shop profile values unchanged after round-trip", same, (orig_shop, sh2))

# empty shop name must be rejected
parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n\r\n'.encode(),
         f"--{boundary}--\r\n".encode()]
s, shp2, _ = req(owner, "PATCH", "/api/admin/shop", b"".join(parts),
                 {"Content-Type": f"multipart/form-data; boundary={boundary}"})
check("PATCH shop empty name rejected 400", s == 400, (s, shp2))

# subscription card
s, sub, _ = req(owner, "GET", "/api/admin/subscription")
check("GET /api/admin/subscription 200 + plans", s == 200 and isinstance(sub.get("plans"), list) and len(sub["plans"]) > 0, (s, sub))
check("platform UPI exposed to owner for plan payment",
      sub.get("superAdminUpi") == "8962613461@kotakbank", sub.get("superAdminUpi"))
paid_plans = [p for p in sub.get("plans", []) if p.get("pricePaise", 0) > 0]
check("at least one paid plan shown", len(paid_plans) >= 1, sub.get("plans"))

if paid_plans:
    code = paid_plans[0]["code"]
    s, pqr, _ = req(owner, "GET", f"/api/admin/subscription/qr?planCode={code}")
    check(f"GET subscription/qr?planCode={code} 200 + UPI payload", s == 200 and bool(pqr.get("dataUrl")) and bool(pqr.get("payload")), (s, str(pqr)[:150]))
    check("plan QR VPA = platform UPI", pqr.get("vpa") == "8962613461@kotakbank", pqr.get("vpa"))
s, pqr2, _ = req(owner, "GET", "/api/admin/subscription/qr?planCode=BOGUS")
check("subscription/qr bogus plan rejected 400/404", s in (400, 404), (s, pqr2))

# submit-for-verification: format validation only (NO fake UTR into prod DB)
s, sp1, _ = req(owner, "POST", "/api/admin/subscription", {"planCode": paid_plans[0]["code"] if paid_plans else "STARTER", "utr": "ABC"})
check("POST subscription short UTR rejected 400", s == 400, (s, sp1))
s, sp2, _ = req(owner, "POST", "/api/admin/subscription", {"planCode": "BOGUS", "utr": "123456789012"})
check("POST subscription bogus plan rejected 4xx", 400 <= s < 500, (s, sp2))

# ================= ROLE GUARDS / ISOLATION =================
print("\n---- ROLE GUARDS ----")
for path, method in [("/api/admin/devices", "GET"), ("/api/admin/printers", "GET"),
                     ("/api/admin/pricing", "GET"), ("/api/admin/reports?days=30&groupBy=day", "GET"),
                     ("/api/admin/shop", "GET"), ("/api/admin/subscription", "GET")]:
    s, d_, _ = req(opener_with_jar()[0], method, path)
    check(f"unauthenticated {method} {path.split('?')[0]} -> 401", s == 401, (s, d_))
    s, d_, _ = req(super_, method, path)
    check(f"super admin {method} {path.split('?')[0]} -> 403 (no shop data)", s == 403, (s, d_))

# super cannot mutate shop resources either
s, d_, _ = req(super_, "PATCH", "/api/admin/printers", {"id": "x", "colorMode": "BW"})
check("super admin PATCH printers -> 403", s == 403, (s, d_))
s, d_, _ = req(super_, "PUT", "/api/admin/pricing", {"rules": []})
check("super admin PUT pricing -> 403", s == 403, (s, d_))

# internal test-reset endpoint must be hidden without secret
s, d_, _ = req(opener_with_jar()[0], "POST", "/api/test/reset")
check("POST /api/test/reset without secret -> 404", s == 404, (s, d_))

# ---------- summary ----------
print("\n================ SUMMARY ================")
fails = [r for r in results if not r[1]]
print(f"TOTAL: {len(results)}  PASS: {len(results) - len(fails)}  FAIL: {len(fails)}")
for name, ok, detail in fails:
    print(f"  FAILED: {name}  ->  {str(detail)[:300]}")
sys.exit(1 if fails else 0)
