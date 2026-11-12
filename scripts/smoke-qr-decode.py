#!/usr/bin/env python3
"""Post-deploy smoke: full customer order flow + decode the actual QR image
pixels and assert the QR encodes the correct upi:// payload."""
import base64, sys, requests, numpy as np, cv2

BASE = "https://copysahaayak.vercel.app"
SLUG = "mansa"

PASS, FAIL = 0, 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}  {detail}")
    else:    FAIL += 1; print(f"  FAIL  {name}  {detail}")

s = requests.Session()
r = s.post(f"{BASE}/api/shops/{SLUG}/session", json={}, timeout=30)
check("session", r.status_code == 200)

with open("/tmp/test-doc.pdf", "rb") as f:
    r = s.post(f"{BASE}/api/shops/{SLUG}/uploads",
               files={"file": ("qr-decode-test.pdf", f, "application/pdf")}, timeout=60)
doc_id = r.json().get("documentId") or (r.json().get("document") or {}).get("id")
check("upload", r.status_code == 200 and doc_id, f"doc={str(doc_id)[:12]}")

items = [{"documentId": doc_id, "colorMode": "COLOR", "paperSize": "A4", "duplex": False, "copies": 2}]
r = s.post(f"{BASE}/api/shops/{SLUG}/orders", json={"items": items, "customerName": "QR Decode Test"}, timeout=30)
o = r.json()
order_number, upi, qr = o.get("orderNumber"), o.get("upi") or {}, o.get("qrDataUrl")
check("order created", r.status_code == 200 and order_number, f"order={order_number} total={o.get('totalPaise')}")

# ---- decode QR pixels ----
img_bytes = base64.b64decode(qr.split(",", 1)[1])
arr = np.frombuffer(img_bytes, dtype=np.uint8)
img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
detector = cv2.QRCodeDetector()
decoded, _, _ = detector.detectAndDecode(img)
print(f"  QR decodes to: {decoded}")
check("QR image decodes", bool(decoded))
check("QR payload == server payload", decoded == upi.get("payload"), f"match={decoded == upi.get('payload')}")
check("QR pays shop VPA with raw @", decoded.startswith("upi://pay?pa=8962613461@kotakbank") or "pa=" in decoded and "%40" not in decoded)
check("QR has amount", "am=" in decoded)
check("QR is INR", "cu=INR" in decoded)

print(f"\nRESULT: {PASS} pass / {FAIL} fail")
sys.exit(1 if FAIL else 0)
