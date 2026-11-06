import { describe, expect, it, vi } from 'vitest';
import { CloudSessionController } from '../../src/auth/cloud-session';
import { ApiError } from '../../../docs/api-client';
import type { Identity } from '../../../docs/api-client';

const user: Identity = { user_id: '9223372036854775807', username: 'sample', display_name: 'Sample', role: 'VIEWER' };
function setup() {
  const dependencies = {
    hasSession: vi.fn(async () => true), signIn: vi.fn(async (_email: string, _password: string) => {}),
    signOut: vi.fn(async () => {}), me: vi.fn(async () => ({ data: user })),
    confirm: vi.fn(async () => ({ data: user })), revoke: vi.fn(async () => {}), publish: vi.fn(),
  };
  return { dependencies, controller: new CloudSessionController(dependencies) };
}
describe('Cloud session orchestration (mock only)', () => {
  it('restores identity from backend and refreshes current RBAC after token refresh', async () => {
    const { controller, dependencies: d } = setup();
    await controller.refresh();
    expect(d.publish).toHaveBeenLastCalledWith({ user, ready: true, error: undefined });
    d.me.mockResolvedValue({ data: { ...user, role: 'STAFF' } });
    controller.changed('TOKEN_REFRESHED');
    await vi.waitFor(() => expect(d.publish).toHaveBeenLastCalledWith({ user: { ...user, role: 'STAFF' }, ready: true, error: undefined }));
  });
  it('requires backend confirmation after provider login and preserves auth errors', async () => {
    const { controller, dependencies: d } = setup();
    d.confirm.mockRejectedValue(new ApiError(401, 'NO_MAPPING', 'Missing mapping'));
    await expect(controller.login('sample@example.invalid', 'synthetic')).rejects.toMatchObject({ status: 401 });
    expect(d.signIn).toHaveBeenCalledWith('sample@example.invalid', 'synthetic');
    expect(d.publish.mock.lastCall?.[0].user).toBeNull();
  });
  it('never restores a delayed principal after sign-out or unmount', async () => {
    const { controller, dependencies: d } = setup();
    let resolve!: (value: { data: Identity }) => void;
    d.me.mockReturnValue(new Promise(done => { resolve = done; }));
    const restore = controller.refresh();
    await Promise.resolve();
    await controller.logout();
    resolve({ data: user }); await restore;
    expect(d.publish.mock.lastCall?.[0].user).toBeNull();
    controller.dispose(); d.publish.mockClear();
    await controller.refresh();
    expect(d.publish).not.toHaveBeenCalled();
  });
  it('does not report revocation success on DB outage; 401 permits local sign-out', async () => {
    const { controller, dependencies: d } = setup();
    d.revoke.mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'Unavailable'));
    await expect(controller.logout()).rejects.toMatchObject({ status: 503 });
    expect(d.signOut).not.toHaveBeenCalled();
    d.revoke.mockRejectedValue(new ApiError(401, 'EXPIRED', 'Expired'));
    await controller.logout();
    expect(d.signOut).toHaveBeenCalledOnce();
  });
});
