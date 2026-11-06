import { ApiError } from '../../../docs/api-client';
import type { Identity } from '../../../docs/api-client';

export interface CloudSessionState { user: Identity | null; ready: boolean; error: unknown }
export interface CloudSessionDependencies {
  hasSession: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  me: () => Promise<{ data: Identity }>;
  confirm: () => Promise<{ data: Identity }>;
  revoke: () => Promise<void>;
  publish: (state: CloudSessionState) => void;
}

// Epochs prevent a delayed /me or login response from restoring a logged-out user.
export class CloudSessionController {
  private epoch = 0;
  private disposed = false;
  private changing = false;
  constructor(private readonly dependencies: CloudSessionDependencies) {}
  private publish(epoch: number, user: Identity | null, error?: unknown) {
    if (!this.disposed && epoch === this.epoch) this.dependencies.publish({ user, ready: true, error });
  }
  invalidate() { this.publish(++this.epoch, null); }
  dispose() { this.disposed = true; this.epoch++; }
  async refresh() {
    const epoch = ++this.epoch;
    try {
      if (!await this.dependencies.hasSession()) { this.publish(epoch, null); return; }
      this.publish(epoch, (await this.dependencies.me()).data);
    } catch (error) {
      this.publish(epoch, null, error instanceof ApiError && error.status === 401 ? undefined : error);
    }
  }
  // The SDK callback must schedule this outside its internal auth lock.
  changed(event: string) {
    if (event === 'SIGNED_OUT') this.invalidate();
    else if (!this.changing && !this.disposed) void this.refresh();
  }
  async login(email: string, password: string) {
    const epoch = ++this.epoch;
    this.changing = true;
    try {
      await this.dependencies.signIn(email, password);
      const result = await this.dependencies.confirm();
      this.publish(epoch, result.data);
    } catch (error) { this.publish(epoch, null, error); throw error; }
    finally { this.changing = false; }
  }
  async logout() {
    this.epoch++;
    this.changing = true;
    try {
      // A 503 is not evidence of successful server-side revocation: allow retry.
      try { await this.dependencies.revoke(); }
      catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
      this.invalidate();
      await this.dependencies.signOut();
    } finally { this.changing = false; }
  }
}
