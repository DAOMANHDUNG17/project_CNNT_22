-- KT3: run unchanged on the source snapshot and the independent QA restore.
-- SELECT only. Use the same session timezone on both connections (UTC recommended).

SELECT current_setting('server_version') AS postgres_version,
       current_setting('TimeZone') AS session_timezone,
       current_database() AS database_name;

SELECT 'products' AS table_name, count(*)::text AS row_count FROM public.products
UNION ALL SELECT 'product_units', count(*)::text FROM public.product_units
UNION ALL SELECT 'inventory', count(*)::text FROM public.inventory
UNION ALL SELECT 'stock_transactions', count(*)::text FROM public.stock_transactions
UNION ALL SELECT 'users', count(*)::text FROM public.users
UNION ALL SELECT 'scan_points', count(*)::text FROM public.scan_points
UNION ALL SELECT 'user_scan_point_access', count(*)::text FROM public.user_scan_point_access
ORDER BY table_name;

-- Stable full-row fingerprints for the four core tables in a small QA dataset.
SELECT 'products' AS table_name,
       md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.product_id), '')) AS row_digest
FROM public.products p
UNION ALL
SELECT 'product_units',
       md5(coalesce(string_agg(md5(to_jsonb(u)::text), '' ORDER BY u.product_unit_id), ''))
FROM public.product_units u
UNION ALL
SELECT 'inventory',
       md5(coalesce(string_agg(md5(to_jsonb(i)::text), '' ORDER BY i.product_id), ''))
FROM public.inventory i
UNION ALL
SELECT 'stock_transactions',
       md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t.transaction_id), ''))
FROM public.stock_transactions t
ORDER BY table_name;

SELECT product_id, product_name, base_unit, is_active, created_at, updated_at
FROM public.products ORDER BY product_id LIMIT 20;

SELECT product_unit_id, product_id, unit_name, conversion_factor, scan_code, is_base_unit
FROM public.product_units ORDER BY product_id, product_unit_id LIMIT 20;

SELECT product_id, quantity_base, updated_at
FROM public.inventory ORDER BY product_id LIMIT 20;

SELECT movement_type, count(*)::text AS row_count,
       coalesce(sum(quantity_base), 0)::text AS quantity_base_total
FROM public.stock_transactions GROUP BY movement_type ORDER BY movement_type;

SELECT transaction_id, product_id, product_unit_id, movement_type, quantity_packages,
       quantity_base, inventory_before, inventory_after, scan_point_id, user_id, created_at
FROM public.stock_transactions ORDER BY created_at DESC, transaction_id DESC LIMIT 20;

-- Catalog validation of restored primary/foreign keys.
SELECT conrelid::regclass::text AS table_name, conname AS constraint_name,
       CASE contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY' END AS kind,
       convalidated AS is_validated,
       CASE WHEN contype = 'f' THEN confrelid::regclass::text END AS references_table
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid IN ('public.products'::regclass, 'public.product_units'::regclass,
                   'public.inventory'::regclass, 'public.stock_transactions'::regclass,
                   'public.users'::regclass)
  AND contype IN ('p', 'f')
ORDER BY table_name, kind, constraint_name;

-- These orphan counts should be zero after a complete restore.
SELECT 'inventory_to_products' AS relation_name, count(*)::text AS orphan_count
FROM public.inventory i LEFT JOIN public.products p ON p.product_id = i.product_id
WHERE p.product_id IS NULL
UNION ALL
SELECT 'units_to_products', count(*)::text
FROM public.product_units u LEFT JOIN public.products p ON p.product_id = u.product_id
WHERE p.product_id IS NULL
UNION ALL
SELECT 'transactions_to_products', count(*)::text
FROM public.stock_transactions t LEFT JOIN public.products p ON p.product_id = t.product_id
WHERE p.product_id IS NULL
UNION ALL
SELECT 'transactions_to_units', count(*)::text
FROM public.stock_transactions t LEFT JOIN public.product_units u
  ON u.product_unit_id = t.product_unit_id AND u.product_id = t.product_id
WHERE u.product_unit_id IS NULL
UNION ALL
SELECT 'transactions_to_users', count(*)::text
FROM public.stock_transactions t LEFT JOIN public.users u ON u.user_id = t.user_id
WHERE u.user_id IS NULL
UNION ALL
SELECT 'users_to_auth', count(*)::text
FROM public.users u LEFT JOIN auth.users a ON a.id = u.auth_user_id
WHERE a.id IS NULL
ORDER BY relation_name;
