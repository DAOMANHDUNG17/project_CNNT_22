# Main database rollout remains pending approval

The executable .psql files in this folder refuse the main database/cluster.
No production credentials, passwords or hashes are embedded in these artifacts.

Review these exact changes before adapting a main-only guard and applying them:

1. Preserve six tables. Add users.auth_version bigint NOT NULL DEFAULT 0 without changing any password/hash. Increment it for role/status/password changes; sessions compare the current counter on every authenticated request. Redis cleanup failure must not preserve access after a committed reset.
2. Add a restricted warehouse_admin_executor NOLOGIN role with no memberships, ownership of tables, CREATE, destructive DML or inventory UPDATE. The existing stock executor remains the only owner allowed to change inventory quantities.
3. Give the admin executor only the catalog INSERT/UPDATE columns shown in 10-admin-test.psql. It can INSERT inventory.product_id to support the existing product-create trigger's zero inventory row, but cannot assign quantity_base or UPDATE inventory.
4. The admin executor may INSERT/UPDATE users.password_hash but cannot SELECT it. Backend retains the existing narrow auth SELECT and gains created_at/auth_version SELECT. Backend never receives direct DML.
5. Create admin_dashboard_write initially INVOKER, revoke PUBLIC EXECUTE, change to the restricted owner, assert it is NOLOGIN/non-superuser, and only then enable DEFINER. Fix search_path and schema-qualified table references. All steps are transactional.
6. Keep the existing stock-movement function, UUID replay protocol and quantity/factor snapshots. This migration does not rewrite that function or data/history.

Conservative conversion policy: an existing product unit's scan_code, product binding, conversion_factor and is_base_unit are immutable. PATCH may rename unit_name or submit unchanged numerical fields; a different conversion requires a new unit with a new scan code. This avoids a race with a stock movement that read its factor before waiting on inventory. Product base_unit changes are rejected once any units, transactions or nonzero stock exist; product and unit creation serialize on the product row.

Account writes serialize using a dedicated advisory transaction lock. The last active ADMIN cannot be deactivated or demoted, including two concurrent attempts against two different active admins. No hard-delete function/API is provided. Passwords are hashed in the backend with the approved Argon2id implementation before a parameterized function call; the SQL function never returns the hash.

The old phase3 permissions diagnostic deliberately describes a smaller API baseline. Run it before this migration; after adding auth_version and SELECT(created_at), use the admin metadata verification and real CRUD/auth/RBAC tests. Do not delete older regression assertions about response projection, read-only reader credentials or history invariants.

Containment: stop admin write traffic, drain in-flight operations, revoke backend EXECUTE with the guarded test script (adapted separately for main after approval). Preserve auth_version, catalog and committed data. Do not restore PUBLIC EXECUTE, drop columns, reset passwords or delete history as a rollback.
