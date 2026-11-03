-- PHASE 2: run this WHOLE file manually in pgAdmin Query Tool as an administrator.
-- Select database smart_warehouse first. Do not run from npm or the backend.
-- Adds only SELECT on four existing tables to the existing warehouse_readonly role.
-- No role/password, table, row, function, sequence or default-privilege changes.
BEGIN;

DO $preflight$
BEGIN
  IF current_database() <> 'smart_warehouse' THEN
    RAISE EXCEPTION 'Select smart_warehouse in Query Tool before running this script.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse_readonly') THEN
    RAISE EXCEPTION 'Existing role warehouse_readonly is required. No role will be created.';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname IN ('users', 'products', 'product_units', 'inventory', 'stock_transactions', 'scan_points')) <> 6 THEN
    RAISE EXCEPTION 'Expected six existing tables in public. No tables will be created.';
  END IF;
END;
$preflight$;

GRANT SELECT ON TABLE
  public.product_units,
  public.inventory,
  public.stock_transactions,
  public.scan_points
TO warehouse_readonly;

-- Check effective privileges, including privileges inherited from PUBLIC.
-- Abort the transaction instead of changing ACLs, memberships or role attributes.
DO $verify$
DECLARE
  relation record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse_readonly'
    AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unexpected role attributes. Review separately; no attributes will be changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'warehouse_readonly') THEN
    RAISE EXCEPTION 'Unexpected role memberships. Review separately.';
  END IF;
  IF NOT has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CONNECT')
    OR NOT has_schema_privilege('warehouse_readonly', 'public', 'USAGE')
    OR has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CREATE')
    OR has_schema_privilege('warehouse_readonly', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Unexpected database/schema privileges. Review separately.';
  END IF;
  FOR relation IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname IN ('users', 'products', 'product_units', 'inventory', 'stock_transactions', 'scan_points')
  LOOP
    IF has_table_privilege('warehouse_readonly', relation.oid,
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_any_column_privilege('warehouse_readonly', relation.oid, 'INSERT,UPDATE,REFERENCES')
      OR has_table_privilege('warehouse_readonly', relation.oid, 'SELECT WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'Unexpected non-read-only or grant privilege on public.%. Review separately.', relation.relname;
    END IF;
    IF relation.relname = 'users' THEN
      IF has_any_column_privilege('warehouse_readonly', relation.oid, 'SELECT') THEN
        RAISE EXCEPTION 'warehouse_readonly must not have SELECT on users or its columns.';
      END IF;
    ELSIF NOT has_table_privilege('warehouse_readonly', relation.oid, 'SELECT') THEN
      RAISE EXCEPTION 'Missing SELECT on public.%. Review existing grants.', relation.relname;
    END IF;
  END LOOP;
END;
$verify$;

COMMIT;
-- On success run verify-phase2-readonly.sql. On error run ROLLBACK before retrying.
-- Re-running after success is safe: GRANT does not change role/password or data.
