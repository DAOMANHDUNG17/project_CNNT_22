-- Read-only verification. Run as administrator in smart_warehouse after setup.
SELECT current_database() AS database;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolinherit, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname = 'warehouse_readonly';
-- Expected: rolcanlogin=true; other attributes above=false.

SELECT
  has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CONNECT') AS can_connect,
  has_database_privilege('warehouse_readonly', 'smart_warehouse', 'CREATE') AS can_create_in_database,
  has_schema_privilege('warehouse_readonly', 'public', 'USAGE') AS can_use_schema,
  has_schema_privilege('warehouse_readonly', 'public', 'CREATE') AS can_create_in_schema;
-- Expected: true, false, true, false.

WITH expected(table_name) AS (
  VALUES ('users'), ('products'), ('product_units'), ('scan_points'),
         ('inventory'), ('stock_transactions')
)
SELECT e.table_name, c.oid IS NOT NULL AS table_exists,
  has_table_privilege('warehouse_readonly', c.oid, 'SELECT') AS can_select,
  has_any_column_privilege('warehouse_readonly', c.oid, 'SELECT') AS can_select_any_column,
  has_table_privilege('warehouse_readonly', c.oid,
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS has_non_select_table_privilege,
  has_any_column_privilege('warehouse_readonly', c.oid,
    'INSERT,UPDATE,REFERENCES') AS has_non_select_column_privilege
FROM expected e
LEFT JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name AND c.relkind IN ('r', 'p')
ORDER BY e.table_name;
-- All six tables should exist. SELECT columns: true only for products.
-- Both non-SELECT columns: false on all six tables.

SELECT parent.rolname AS member_of
FROM pg_auth_members m
JOIN pg_roles child ON child.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE child.rolname = 'warehouse_readonly';
-- Expected: no memberships.

SELECT d.datname AS database, s.setconfig
FROM pg_db_role_setting s
JOIN pg_roles r ON r.oid = s.setrole
JOIN pg_database d ON d.oid = s.setdatabase
WHERE r.rolname = 'warehouse_readonly' AND d.datname = 'smart_warehouse';
-- Expected: default_transaction_read_only=on.
