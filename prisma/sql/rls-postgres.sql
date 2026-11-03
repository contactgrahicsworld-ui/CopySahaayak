-- ============================================================================
-- Defense-in-depth Row Level Security (PostgreSQL production deployment).
-- Application-layer tenant scoping (requireAnyShopAdmin / session shopId) is
-- the primary isolation mechanism. These policies are the second wall: even a
-- buggy query through the app role cannot cross tenants, because the app sets
-- `app.current_shop` (and `app.current_role`) per transaction.
-- ============================================================================
-- NOTE: run after `prisma migrate deploy` against PostgreSQL. SQLite (sandbox
-- dev) does not support RLS; production docker-compose uses PostgreSQL.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Order','OrderItem','Document','Payment','PaymentVerification',
    'PricingRule','CustomerSession','Printer','Device','RoutingRule',
    'PrintJob','PrintEvent','Notification','Subscription','SubscriptionPayment'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation_%s ON %I
      USING (shop_id::text = current_setting('app.current_shop', true))
      $f$, t, t);
  END LOOP;
END $$;

-- Users: platform staff see all; shop staff see their own row only
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_self_or_platform ON "User"
  USING (current_setting('app.current_role', true) = 'SUPER_ADMIN'
         OR id::text = current_setting('app.current_user', true));

-- AuditLog: shop-scoped read; inserts allowed by any authenticated writer
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_read ON "AuditLog"
  FOR SELECT
  USING (shop_id::text = current_setting('app.current_shop', true)
         OR current_setting('app.current_role', true) = 'SUPER_ADMIN');

-- PlatformSetting: readable by authenticated app
ALTER TABLE "PlatformSetting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_read ON "PlatformSetting" FOR SELECT USING (true);
