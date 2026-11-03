-- PHASE 2: read-only checks in smart_warehouse; no write attempts against real data.
-- Run manually after grant-phase2-readonly.sql. Safe to run as warehouse_readonly.
SELECT current_database() AS database, current_user AS checking_role;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolinherit, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname = 'warehouse_readonly';

SELECT
  has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CONNECT') AS can_connect,
  has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CREATE') AS can_create_in_database,
  has_schema_privilege('warehouse_readonly', 'public', 'USAGE') AS can_use_public,
  has_schema_privilege('warehouse_readonly', 'public', 'CREATE') AS can_create_in_public;
-- Expected true, false, true, false.

WITH expected(table_name, expected_select) AS (
  VALUES ('users', false), ('products', true), ('product_units', true),
         ('inventory', true), ('stock_transactions', true), ('scan_points', true)
)
SELECT e.table_name, e.expected_select, c.oid IS NOT NULL AS table_exists,
  has_table_privilege('warehouse_readonly', c.oid, 'SELECT') AS can_select,
  has_any_column_privilege('warehouse_readonly', c.oid, 'SELECT') AS can_select_any_column,
  has_table_privilege('warehouse_readonly', c.oid, 'INSERT') AS can_insert,
  has_table_privilege('warehouse_readonly', c.oid, 'UPDATE') AS can_update,
  has_table_privilege('warehouse_readonly', c.oid, 'DELETE') AS can_delete,
  has_table_privilege('warehouse_readonly', c.oid, 'TRUNCATE') AS can_truncate,
  has_table_privilege('warehouse_readonly', c.oid, 'REFERENCES,TRIGGER,MAINTAIN') AS has_other_table_privilege,
  has_any_column_privilege('warehouse_readonly', c.oid, 'INSERT,UPDATE,REFERENCES') AS has_non_select_column_privilege,
  has_table_privilege('warehouse_readonly', c.oid, 'SELECT WITH GRANT OPTION') AS can_grant_select
FROM expected e LEFT JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name AND c.relkind IN ('r', 'p')
ORDER BY e.table_name;
-- All tables exist; both SELECT columns match expected_select.
-- Every other privilege column must be false, including column-level grants.

SELECT parent.rolname AS member_of
FROM pg_auth_members m JOIN pg_roles child ON child.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE child.rolname = 'warehouse_readonly';
-- Expected no rows.

WITH expected(table_name, expected_select) AS (
  VALUES ('users', false), ('products', true), ('product_units', true),
         ('inventory', true), ('stock_transactions', true), ('scan_points', true)
), table_checks AS (
  SELECT e.table_name,
    c.oid IS NOT NULL
    AND has_table_privilege('warehouse_readonly', c.oid, 'SELECT') = e.expected_select
    AND has_any_column_privilege('warehouse_readonly', c.oid, 'SELECT') = e.expected_select
    AND NOT has_table_privilege('warehouse_readonly', c.oid,
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
    AND NOT has_any_column_privilege('warehouse_readonly', c.oid, 'INSERT,UPDATE,REFERENCES') AS ok
  FROM expected e LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name AND c.relkind IN ('r', 'p')
), overall AS (
  SELECT current_database() = 'smart_warehouse'
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse_readonly' AND rolcanlogin
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    AND has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CONNECT')
    AND NOT has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CREATE')
    AND has_schema_privilege('warehouse_readonly', 'public', 'USAGE')
    AND NOT has_schema_privilege('warehouse_readonly', 'public', 'CREATE')
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
      WHERE r.rolname = 'warehouse_readonly')
    AND (SELECT bool_and(COALESCE(ok, false)) FROM table_checks) AS ok
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS phase2_permissions,
  (SELECT array_agg(table_name ORDER BY table_name) FROM table_checks WHERE ok IS NOT TRUE) AS tables_needing_review
FROM overall;
-- PASS only means privileges meet phase 2 expectations; it does not test new APIs.
