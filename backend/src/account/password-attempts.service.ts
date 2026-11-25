import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

// Authenticated-account limits, independent of untrusted proxy/IP headers.
// In-memory by design for the single-instance controlled demo. Restarts reset it.
@Injectable()
export class PasswordAttemptsService {
  private readonly buckets = new Map<string, { count: number; expires: number; busy: boolean }>();

  async run<T>(actorId: string, work: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) if (!bucket.busy && bucket.expires <= now) this.buckets.delete(key);
    let bucket = this.buckets.get(actorId);
    if (bucket?.busy || bucket && bucket.count >= 5 || !bucket && this.buckets.size >= 1000) {
      throw new HttpException('Đã đạt giới hạn yêu cầu mật khẩu. Vui lòng chờ tối đa 15 phút rồi thử lại.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!bucket) {
      bucket = { count: 0, expires: now + 15 * 60 * 1000, busy: false };
      this.buckets.set(actorId, bucket);
    }
    bucket.count++; bucket.busy = true;
    try { return await work(); } finally { bucket.busy = false; }
  }
}
