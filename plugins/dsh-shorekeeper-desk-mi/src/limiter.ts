/** 设备控制限流 —— token bucket，移植自 dock-hub ratelimit.py。
 *
 * 单位「每分钟几次」；满桶 = 一分钟的量（允许攒着一次用完）。
 * 时钟用 monotonic（performance.now），不用墙上时间——NTP 调整会让桶
 * 「时间倒流，于是永远有额度」。
 */

interface Bucket {
  tokens: number
  stamp: number
}

const MAX_KEYS = 512
const IDLE_SEC = 3600

export class TokenBucketLimiter {
  private readonly perMinute: number
  private readonly capacity: number
  private readonly rate: number
  private buckets = new Map<string, Bucket>()

  constructor(perMinute: number) {
    if (!Number.isFinite(perMinute) || perMinute <= 0) {
      throw new Error('per_minute 必须是正数')
    }
    this.perMinute = perMinute
    this.capacity = perMinute
    this.rate = perMinute / 60.0
  }

  /** 扣一次。返回 0 = 放行；>0 = 还要等几秒。 */
  take(key: string, nowMs?: number): number {
    const now = nowMs ?? performance.now()
    const nowSec = now / 1000
    this.prune(nowSec)
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { tokens: this.capacity, stamp: nowSec }
      this.buckets.set(key, bucket)
    } else {
      const elapsed = Math.max(0, nowSec - bucket.stamp)
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.rate)
      bucket.stamp = nowSec
    }
    if (bucket.tokens >= 1.0) {
      bucket.tokens -= 1.0
      return 0
    }
    return Math.max((1.0 - bucket.tokens) / this.rate, 0.1)
  }

  reset(): void {
    this.buckets.clear()
  }

  private prune(now: number): void {
    if (this.buckets.size < MAX_KEYS) return
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.stamp > IDLE_SEC) this.buckets.delete(key)
    }
  }
}
