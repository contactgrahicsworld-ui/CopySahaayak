// Shop management: list with subscription info; create shop + owner account.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { createShopSchema } from '@/lib/validation'
import { bcryptHash, getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()
    const shops = await db.shop.findMany({
      where: q ? { OR: [{ name: { contains: q } }, { slug: { contains: q } }, { phone: { contains: q } }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        subscription: { include: { plan: true } },
        users: { where: { role: 'SHOP_ADMIN' }, select: { email: true, name: true } },
        _count: { select: { orders: true, devices: true, printers: true } },
      },
    })
    return jsonOk({ shops })
  })
}

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const body = createShopSchema.parse(await req.json())

    const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `shop-${Date.now()}`
    const exists = await db.shop.findUnique({ where: { slug } })
    if (exists) return jsonError(409, `Shop URL slug "${slug}" is taken`)
    const emailTaken = await db.user.findUnique({ where: { email: body.adminEmail.toLowerCase() } })
    if (emailTaken) return jsonError(409, 'Admin email already in use')

    const plan = await db.plan.findUnique({ where: { code: body.planCode } })
    if (!plan) return jsonError(404, 'Plan not found')

    const result = await db.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          name: body.name,
          slug,
          ownerName: body.ownerName || null,
          phone: body.phone || null,
          isActive: true,
        },
      })
      const admin = await tx.user.create({
        data: {
          email: body.adminEmail.toLowerCase(),
          passwordHash: await bcryptHash(body.adminPassword),
          name: body.ownerName || body.name,
          role: 'SHOP_ADMIN',
          shopId: shop.id,
        },
      })
      await tx.shopMember.create({ data: { shopId: shop.id, userId: admin.id, role: 'OWNER' } })
      await tx.subscription.create({
        data: {
          shopId: shop.id,
          planId: plan.id,
          status: plan.pricePaise === 0 ? 'ACTIVE' : 'PENDING_VERIFICATION',
          startsAt: plan.pricePaise === 0 ? new Date() : null,
          expiresAt: plan.pricePaise === 0 ? new Date(Date.now() + plan.durationDays * 86400000) : null,
        },
      })
      // Default pricing (standard Indian rates)
      const defaults = [
        { paperSize: 'A4', colorMode: 'BW', singleSidedPaise: 200, duplexPaise: 150 },
        { paperSize: 'A4', colorMode: 'COLOR', singleSidedPaise: 1000, duplexPaise: 800 },
        { paperSize: 'A3', colorMode: 'BW', singleSidedPaise: 400, duplexPaise: 300 },
        { paperSize: 'A3', colorMode: 'COLOR', singleSidedPaise: 2000, duplexPaise: 1600 },
        { paperSize: 'A5', colorMode: 'BW', singleSidedPaise: 100, duplexPaise: 80 },
        { paperSize: 'A5', colorMode: 'COLOR', singleSidedPaise: 500, duplexPaise: 400 },
        { paperSize: 'LEGAL', colorMode: 'BW', singleSidedPaise: 300, duplexPaise: 250 },
        { paperSize: 'LEGAL', colorMode: 'COLOR', singleSidedPaise: 1500, duplexPaise: 1200 },
      ]
      for (const p of defaults) {
        await tx.pricingRule.create({ data: { shopId: shop.id, ...p } })
      }
      return { shop, admin }
    })

    await audit({
      shopId: result.shop.id,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SHOP_CREATED',
      entity: 'Shop',
      entityId: result.shop.id,
      meta: { slug, adminEmail: body.adminEmail, planCode: body.planCode },
      ip: getClientIp(req),
    })
    return jsonOk({ shop: { id: result.shop.id, slug: result.shop.slug, name: result.shop.name }, adminEmail: result.admin.email })
  })
}
