// Remove this gate only in a reviewed change backed by the evidence in the runbook.
// An environment flag is deliberately insufficient to approve unresolved security decisions.
export const cloudBlockers = Object.freeze([
  'Provider-supported password/recovery revocation lifecycle is not verified.',
  'D8 provider bridge and managed membership policy need approved staging verification.',
  'Cloud migrations, ACL assertions, TLS and concurrency tests have not run.',
]);
export function assertCloudReleaseReady() {
  throw Object.assign(new Error('Cloud activation is BLOCKED. See docs/SUPABASE_IMPLEMENTATION_STATUS.md. No connection was opened.'), { code: 'CLOUD_RELEASE_BLOCKED' });
}
