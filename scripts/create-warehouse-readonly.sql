SELECT
    rolname,
    rolcanlogin
FROM pg_roles
WHERE rolname = 'warehouse_readonly';