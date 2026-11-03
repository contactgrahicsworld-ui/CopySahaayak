#!/usr/bin/env python3
"""Configure Supabase custom SMTP via Gmail app password + custom OTP email template.
Usage: python3 configure-supabase-smtp.py "abcd efgh ijkl mnop"
Then triggers one test OTP to the owner email.
"""
import json, os, sys, urllib.request

TOKEN = os.environ.get("SUPABASE_MGMT_TOKEN", "")  # no hardcoded tokens
REF = "oqowxmrzaxnundghsrct"
API = f"https://api.supabase.com/v1/projects/{REF}"
GMAIL_USER = "contact.grahicsworld@gmail.com"

def api(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read().decode() or "{}")

def patch_smtp(app_pass):
    template = (
        '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;'
        'border:1px solid #e5e7eb;border-radius:12px;padding:24px">'
        '<h2 style="color:#111827;margin:0 0 8px">CopySahaayak</h2>'
        '<p style="color:#374151">Password reset ke liye aapka one-time code:</p>'
        '<p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;'
        'background:#f3f4f6;padding:14px;border-radius:8px">{{ .Token }}</p>'
        '<p style="color:#6b7280;font-size:13px">Ye code 60 minute me expire ho jayega.</p>'
        '<p style="color:#9ca3af;font-size:12px">Agar aapne ye request nahi ki, is email ko ignore karein.</p>'
        "</div>"
    )
    payload = {
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 465,
        "smtp_user": GMAIL_USER,
        "smtp_pass": app_pass.replace(" ", ""),
        "smtp_admin_email": GMAIL_USER,
        "smtp_sender_name": "CopySahaayak",
        "smtp_max_frequency": 20,
        "rate_limit_email_sent": 30,
        "mailer_otp_length": 6,
        "mailer_subjects_magic_link": "CopySahaayak verification code",
        "mailer_templates_magic_link_content": template,
    }
    status, body = api("PATCH", "/config/auth", payload)
    print("PATCH config/auth:", status)
    return status == 200

def verify():
    status, cfg = api("GET", "/config/auth")
    print("smtp_host =", cfg.get("smtp_host"), "| smtp_port =", cfg.get("smtp_port"),
          "| sender =", cfg.get("smtp_sender_name"), "| otp_len =", cfg.get("mailer_otp_length"),
          "| email_sent_limit =", cfg.get("rate_limit_email_sent"))
    return cfg.get("smtp_host") == "smtp.gmail.com"

def test_otp():
    # read anon key from app env file
    anon = None
    for line in open("/home/z/my-project/.env"):
        m = line.strip()
        if m.startswith("NEXT_PUBLIC_SUPABASE_ANON_KEY="):
            anon = m.split("=", 1)[1]
    url = f"https://{REF}.supabase.co/auth/v1/otp"
    req = urllib.request.Request(url, data=json.dumps(
        {"email": GMAIL_USER, "create_user": False}).encode(), method="POST", headers={
        "apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            print("test OTP send:", r.status, "(200 = email dispatched via Gmail SMTP)")
    except urllib.error.HTTPError as e:
        print("test OTP send FAILED:", e.code, e.read().decode()[:200])

if __name__ == "__main__":
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("Usage: python3 configure-supabase-smtp.py '<16-letter app password>'")
        sys.exit(1)
    ok = patch_smtp(sys.argv[1])
    if not ok:
        sys.exit("PATCH failed")
    verify()
    test_otp()
