#!/usr/bin/env python3
"""Final delivery report PDF for the Photocopy Shop Automation SaaS (CopySahaayak)."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                HRFlowable, KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DejaVu-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVu-Oblique', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf'))

OUT = '/home/z/my-project/download/CopySahaayak-Delivery-Report.pdf'

body = ParagraphStyle('body', fontName='DejaVu', fontSize=9.2, leading=13.2, textColor=colors.HexColor('#1a1a1a'))
small = ParagraphStyle('small', parent=body, fontSize=8.2, leading=11.6, textColor=colors.HexColor('#444444'))
h1 = ParagraphStyle('h1', fontName='DejaVu-Bold', fontSize=19, leading=23, textColor=colors.HexColor('#111111'))
h2 = ParagraphStyle('h2', fontName='DejaVu-Bold', fontSize=12.5, leading=16, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor('#111111'))
h3 = ParagraphStyle('h3', fontName='DejaVu-Bold', fontSize=10, leading=13, spaceBefore=6, spaceAfter=2, textColor=colors.HexColor('#222222'))
cell = ParagraphStyle('cell', parent=small, leading=10.8)
cellb = ParagraphStyle('cellb', parent=cell, fontName='DejaVu-Bold')

GREEN = '#166534'; AMBER = '#92400e'; RED = '#991b1b'

def status_row(feature, status, color, evidence):
    return [Paragraph(feature, cell), Paragraph(f'<font color="{color}"><b>{status}</b></font>', cell), Paragraph(evidence, small)]

story = []
story.append(Paragraph('CopySahaayak — Photocopy Shop Automation SaaS', h1))
story.append(Paragraph('Final Delivery Report · 2 November 2026 · Produced autonomously in one build session', small))
story.append(Spacer(1, 6))
story.append(HRFlowable(width='100%', color=colors.HexColor('#222222'), thickness=1))
story.append(Spacer(1, 8))

story.append(Paragraph('1. Executive summary', h2))
story.append(Paragraph(
    'A complete, multi-tenant Photocopy Shop Automation SaaS was built and verified this session: a Next.js 16 '
    'production application (customer ordering, shop admin, super admin), a UPI payment flow with dynamic QR and '
    'manual UTR verification (no gateway, no commission), a real Windows printer connector compiled to an NSIS '
    'installer EXE, a 67-test automated suite (15 unit + 52 E2E/security) that passes in full, production deployment '
    'infrastructure (Docker Compose with PostgreSQL, Caddy auto-HTTPS, backups), and technical documentation. '
    'The live application runs at the preview URL and every surface was exercised in a real browser. Honest '
    'classification of every feature is in section 4, including what could not be verified in this environment.', body))
story.append(Spacer(1, 4))

story.append(Paragraph('2. What was delivered', h2))
rows = [
    ('A. Live SaaS web application', 'Next.js 16 + React 19 + TypeScript + Prisma. Three role surfaces: customer '
     'ordering (/s/{shop}), Shop Admin (/admin, 7 modules), Super Admin (/super, 6 modules). Guest customers — no '
     'registration. No credentials are predefined: the first Super Admin is created once via /setup and shops '
     'register via /register.'),
    ('B. Windows installer', 'PhotocopyShopConnector-Setup.exe — real NSIS-installer (PE32), 49.8 MB, copies a '
     'self-contained .NET 8 WinForms tray app (156 MB, no runtime downloads), registers photocopyconnector:// protocol, '
     'Add/Remove Programs entry + uninstaller. SHA-256 95575ab2…848d1cc0 (full value in delivery package). '
     'Unsigned — SmartScreen warning expected (disclosed).'),
    ('C. Source code', 'Full source: web app (src/), Prisma schema + seed (prisma/), connector C# sources '
     '(connector/), NSIS script (connector/installer/), build script + GitHub Actions rebuild workflow, tests/.'),
    ('D. Technical documentation', 'docs/ARCHITECTURE.md (system, sequence, deployment diagrams), docs/DATABASE.md '
     '(ERD, table reference), docs/SECURITY.md (threat model, controls, honest limitations), '
     'docs/PRINTER-INTEGRATION.md, docs/DEPLOYMENT.md (deployment, backup/recovery drill, true running costs), '
     'connector/README.md (install + troubleshooting).'),
    ('E. Test evidence', 'tests/unit.test.mjs (15 tests) and tests/e2e-api.mjs (52 checks incl. cross-tenant attack '
     'suite) — all passing. Browser-verified golden paths. Type check and ESLint clean.'),
]
t = Table([[Paragraph(a, cellb), Paragraph(b, cell)] for a, b in rows], colWidths=[42*mm, 128*mm])
t.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
                       ('LINEBELOW', (0,0), (-1,-2), 0.4, colors.HexColor('#dddddd'))]))
story.append(t)
story.append(Spacer(1, 6))

story.append(Paragraph('3. How it works (payment + printing)', h2))
story.append(Paragraph(
    'Customer scans the shop QR (unique per shop, /s/slug), uploads PDF/images (server counts pages via pdf-lib, '
    'magic-byte validated, stored privately with 10-minute HMAC-signed preview URLs), chooses B/W or colour, '
    'A4/A3/A5/Legal, copies, duplex and page ranges. The server alone computes the price from the shop\u2019s rate '
    'card (integer paise, e.g. 2 sides × 2 copies × ₹2.00 = ₹8.00). A dynamic UPI QR encodes the SHOP\u2019s own VPA '
    'with the exact amount and the order number as reference — money moves directly to the shop\u2019s bank; the '
    'platform never touches it. The customer submits the UTR; the shop verifies it (amount actually credited) before '
    'verification fans out print jobs. The Windows connector claims jobs (10-minute lease), downloads via 30-minute '
    'signed URLs, rasterises PDFs locally, prints to the B/W or colour printer with correct paper size, duplex and '
    'copies, and reports COMPLETED only after the Windows print spooler confirms the job finished — the server '
    'rejects COMPLETED without a prior SPOOLING event (enforced and tested). Subscription payments to the platform '
    'UPI are verified manually by the Super Admin before a plan activates.', body))
story.append(Spacer(1, 4))

story.append(Paragraph('4. Feature classification (honest)', h2))
data = [[Paragraph('<b>Feature</b>', cellb), Paragraph('<b>Verdict</b>', cellb), Paragraph('<b>Evidence</b>', cellb)]]
data += [
    status_row('Customer: shop QR page, upload, preview, page count, options, bill', 'VERIFIED WORKING', GREEN, 'Browser-run golden path; E2E §3 (page count 3, ₹12.00 total)'),
    status_row('Dynamic UPI QR with exact amount + order ref', 'VERIFIED WORKING', GREEN, 'QR rendered in browser (screenshot); payload contains am= and tr= (E2E §3)'),
    status_row('UTR submission + duplicate rejection', 'VERIFIED WORKING', GREEN, 'E2E §3 (200 then 409)'),
    status_row('Shop admin: orders, payment verify/reject, print-queue actions', 'VERIFIED WORKING', GREEN, 'Browser dashboard screenshot with live data; E2E §5'),
    status_row('Pricing management (per size/colour/side, server-authoritative)', 'VERIFIED WORKING', GREEN, 'Unit tests + admin UI; client cannot alter price (E2E §3)'),
    status_row('Printer pairing (6-char code), heartbeat registration, revocation', 'VERIFIED WORKING', GREEN, 'E2E §5–6 (pair → token → revoke → 401)'),
    status_row('Print job leasing, dedupe, retry, spooler-honesty rule', 'VERIFIED WORKING', GREEN, 'E2E §5: COMPLETED without SPOOLING → 409; lease + requeue logic unit-covered'),
    status_row('Super admin: shops, onboard, suspend, subscriptions, plans, audit, analytics', 'VERIFIED WORKING', GREEN, 'Browser screenshot (2 shops, ₹499 revenue); E2E §7'),
    status_row('Cross-tenant isolation (orders, payments, documents, devices)', 'VERIFIED WORKING', GREEN, 'E2E §4 attack suite: shop B blocked from shop A (404/403)'),
    status_row('Rate limiting, signed URLs, magic-byte upload validation', 'VERIFIED WORKING', GREEN, 'E2E §3 + §8 (429 brute force; forged sig → 403; HTML-as-PDF → 415)'),
    status_row('Windows EXE: compile + installer packaging', 'VERIFIED WORKING', GREEN, 'PE32 verified via file(1); reproducible sha256; 0 compile errors'),
    status_row('Windows EXE: GUI flow, physical printing, spooler behaviour on real Windows', 'IMPLEMENTED — NOT VERIFIABLE IN THIS SANDBOX', AMBER, 'WinForms/printing cannot execute on Linux; full CI rebuild + manual test checklist provided'),
    status_row('Installer code signing', 'INCOMPLETE (disclosed)', AMBER, 'No CA available in sandbox; SmartScreen workaround documented; signing is a one-line CI addition once a cert exists'),
    status_row('Live public deployment (your domain, HTTPS)', 'HANDOFF READY', AMBER, 'docker compose up -d with Caddy auto-HTTPS; docs/DEPLOYMENT.md; preview URL serves the full app meanwhile'),
    status_row('Email/SMS/WhatsApp notifications', 'INCOMPLETE (by design)', AMBER, 'Out of zero-cost scope: in-app notifications + live tracking page shipped instead; SMS providers are paid'),
    status_row('PostgreSQL RLS enforcement in production', 'IMPLEMENTED BUT NOT VERIFIED', AMBER, 'prisma/sql/rls-postgres.sql shipped; sandbox runs SQLite; policy activation documented for first prod deploy'),
]
t = Table(data, colWidths=[62*mm, 42*mm, 66*mm], repeatRows=1)
t.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                       ('TOPPADDING', (0,0), (-1,-1), 4),
                       ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f2f2f2')),
                       ('LINEBELOW', (0,0), (-1,-2), 0.4, colors.HexColor('#e2e2e2')),
                       ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor('#e2e2e2'))]))
story.append(t)
story.append(Paragraph('No feature is reported VERIFIED WORKING without a real check behind it; nothing failed.', small))
story.append(Spacer(1, 6))

story.append(Paragraph('5. Security verification evidence', h2))
ev = [
    'Cross-tenant attacks (E2E §4): shop-B session denied shop-A order cancel (404), payment verification (404), '
    'order lists filtered by session shopId; super admin blocked from shop APIs and vice versa (403).',
    'Upload security: HTML disguised as PDF rejected (415) via magic-byte sniffing; page counts recomputed server-side; '
    'files served only through HMAC-signed 10-minute URLs — forged signature → 403 (E2E §3).',
    'Device security: single-use 15-minute pairing codes; revoked device tokens fail immediately (401, E2E §6); bogus '
    'token → 401 (E2E §5).',
    'Honesty controls: COMPLETED print events without SPOOLING rejected 409 (E2E §5); duplicate UTR submission → 409; '
    'payments never auto-verify.',
    'Abuse controls: login brute force rate-limited to 429 (E2E §8); bcrypt(12) password hashes; HttpOnly SameSite '
    'session cookies with server-side revocation; Origin-checked mutations; append-only audit log of every security-relevant action.',
]
for e in ev:
    story.append(Paragraph('• ' + e, small))
story.append(Spacer(1, 4))

story.append(Paragraph('6. Zero-mandatory-cost disclosure', h2))
story.append(Paragraph(
    'No paid AI/API/gateway/SMS/email services are used anywhere. Licences: Next.js/React/Prisma (MIT), qrcode, '
    'pdf-lib, image-size, bcryptjs (MIT/Apache-2.0/BSD), .NET 8 SDK/runtime (MIT), PDFtoImage + SkiaSharp + pdfium '
    '(MIT / BSD-style Chromium licence — commercial use OK), NSIS (zlib licence). True running costs are infrastructure '
    'only: VPS ≈ ₹400–700/month + domain ≈ ₹800/year; HTTPS free via Let\u2019s Encrypt. Optional (not required): '
    'a code-signing certificate (≈ $70–400/yr) to remove SmartScreen warnings. Full breakdown in docs/DEPLOYMENT.md §5.', body))
story.append(Spacer(1, 4))

story.append(Paragraph('7. Remaining work before commercial acceptance', h2))
rem = [
    'Deploy to a public VPS with a domain (docs/DEPLOYMENT.md — approx. 30 minutes with docker compose) and run '
    '`prisma migrate deploy` + the RLS SQL for PostgreSQL hardening.',
    'Install PhotocopyShopConnector-Setup.exe on one real Windows PC with real printers; walk the manual acceptance '
    'checklist in connector/README.md (pair → map B/W + colour printers → verified order → physical print; spooler '
    'verification is expected to show as SPOOLING → COMPLETED in the audit log).',
    'Optional: add code signing (Azure Trusted Signing or an OV cert) to eliminate SmartScreen friction.',
    'Optional later: Telegram/e-mail webhook notifications via free tiers if the owner wants push alerts.',
]
for r in rem:
    story.append(Paragraph(f'{rem.index(r)+1}. ' + r, body))
story.append(Spacer(1, 6))

story.append(Paragraph('8. Package contents (delivery/ folder)', h2))
pkg = [
    ('CopySahaayak-Delivery-Report.pdf', 'This report'),
    ('connector/PhotocopyShopConnector-Setup.exe', 'Windows installer (49.8 MB) — ready to distribute to shops'),
    ('connector/PhotocopyShopConnector-portable.exe', 'Portable single-file connector (no install needed)'),
    ('connector/CHECKSUMS.sha256', 'SHA-256 manifest for both EXEs'),
    ('source-code.zip', 'Complete source: web app, connector C#, installer, tests, docs, deployment configs'),
]
t = Table([[Paragraph(a, cellb), Paragraph(b, cell)] for a, b in pkg], colWidths=[86*mm, 84*mm])
t.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('BOTTOMPADDING', (0,0), (-1,-1), 4),
                       ('LINEBELOW', (0,0), (-1,-2), 0.4, colors.HexColor('#dddddd'))]))
story.append(t)
story.append(Spacer(1, 8))
story.append(Paragraph(
    'Prepared autonomously on 2 Nov 2026. All claims in section 4 are backed by the named evidence in the repository '
    '(tests/, docs/, screenshots taken during the browser verification run).', small))

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=16*mm, rightMargin=16*mm, topMargin=14*mm, bottomMargin=14*mm,
                        title='CopySahaayak — Final Delivery Report')
doc.build(story)
print('written', OUT)
