// Shop profile + UPI settings + logo upload (multipart PATCH).
import path from 'path'
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin, HttpError } from '@/lib/auth'
import { shopProfileSchema } from '@/lib/validation'
import { getClientIp } from '@/lib/security'
import { detectMagic } from '@/lib/storage'
import { storageUpload } from '@/lib/filestore'
import { audit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shop = await db.shop.findUnique({ where: { id: ctx.user.shopId } })
    if (!shop) return jsonError(404, 'Shop not found')
    return jsonOk({
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        ownerName: shop.ownerName,
        phone: shop.phone,
        whatsappNumber: shop.whatsappNumber,
        address: shop.address,
        upiVpa: shop.upiVpa,
        upiPayeeName: shop.upiPayeeName,
        hasLogo: !!shop.logoPath,
        isActive: shop.isActive,
      },
    })
  })
}

const jsonPatchSchema = shopProfileSchema.extend({
  ownerName: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  whatsappNumber: z.string().trim().max(20).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  upiPayeeName: z.string().trim().max(60).optional().nullable(),
})

export async function PATCH(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const contentType = req.headers.get('content-type') || ''
    let profileData: Record<string, string> = {}
    let logoPath: string | undefined

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      for (const key of ['name', 'ownerName', 'phone', 'whatsappNumber', 'address', 'upiVpa', 'upiPayeeName']) {
        const v = form.get(key)
        if (typeof v === 'string') profileData[key] = v
      }
      const logo = form.get('logo')
      if (logo instanceof File && logo.size > 0) {
        if (logo.size > 2 * 1024 * 1024) throw new HttpError(413, 'Logo must be under 2 MB')
        const buf = Buffer.from(await logo.arrayBuffer())
        const magic = detectMagic(buf)
        if (!magic.ok || !magic.mime.startsWith('image/')) throw new HttpError(415, 'Logo must be PNG or JPEG')
        const name = `${ctx.user.shopId}${path.extname(logo.name || '') || '.png'}`
        await storageUpload(`branding/${name}`, buf, magic.mime)
        logoPath = `branding/${name}`
      }
    } else {
      profileData = await req.json()
    }

    const parsed = jsonPatchSchema.safeParse(profileData)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return jsonError(400, `${first.path.join('.')}: ${first.message}`)
    }
    const d = parsed.data

    const shop = await db.shop.update({
      where: { id: ctx.user.shopId },
      data: {
        ...(d.name ? { name: d.name } : {}),
        ...(d.ownerName !== undefined ? { ownerName: d.ownerName || null } : {}),
        ...(d.phone !== undefined ? { phone: d.phone || null } : {}),
        ...(d.whatsappNumber !== undefined ? { whatsappNumber: d.whatsappNumber || null } : {}),
        ...(d.address !== undefined ? { address: d.address || null } : {}),
        ...(d.upiVpa !== undefined ? { upiVpa: d.upiVpa || null } : {}),
        ...(d.upiPayeeName !== undefined ? { upiPayeeName: d.upiPayeeName || null } : {}),
        ...(logoPath ? { logoPath } : {}),
      },
    })
    await audit({
      shopId: shop.id,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SHOP_PROFILE_UPDATED',
      entity: 'Shop',
      entityId: shop.id,
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, hasLogo: !!shop.logoPath })
  })
}
