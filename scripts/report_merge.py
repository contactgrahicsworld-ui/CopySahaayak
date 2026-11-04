#!/usr/bin/env python3
"""Merge cover + body into the final assurance report PDF."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

def normalize(page):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

writer = PdfWriter()
writer.add_page(normalize(PdfReader('/home/z/my-project/scripts/report_cover.pdf').pages[0]))
for p in PdfReader('/home/z/my-project/scripts/report_body.pdf').pages:
    writer.add_page(normalize(p))
writer.add_metadata({
    '/Title': 'PrintSahayak Platform - Verification & Redeploy Assurance Report',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'Live verification and redeploy assurance for the PrintSahayak SaaS platform',
})
out = '/home/z/my-project/download/PrintSahayak-Assurance-Report.pdf'
with open(out, 'wb') as f:
    writer.write(f)
print('OK ->', out, '| pages:', 1 + len(PdfReader('/home/z/my-project/scripts/report_body.pdf').pages))
