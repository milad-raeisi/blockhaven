/** Token bucket rate limiter. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  tryTake(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSecond);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

export type RateCategory = 'global' | 'input' | 'block' | 'chat' | 'inventory' | 'chunks';

const LIMITS: Record<RateCategory, [rate: number, burst: number]> = {
  global: [200, 400],
  input: [40, 80],
  block: [25, 40],
  chat: [1, 5],
  inventory: [30, 60],
  chunks: [20, 40],
};

/** Per-connection limiter with one bucket per message category. */
export class ConnectionRateLimiter {
  private readonly buckets = new Map<RateCategory, TokenBucket>();
  /** Number of consecutive rejected messages; used to disconnect abusive clients. */
  violations = 0;

  constructor(now: () => number = Date.now) {
    for (const [category, [rate, burst]] of Object.entries(LIMITS) as [RateCategory, [number, number]][]) {
      this.buckets.set(category, new TokenBucket(rate, burst, now));
    }
  }

  allow(category: RateCategory): boolean {
    const ok = this.buckets.get('global')!.tryTake() && (category === 'global' || this.buckets.get(category)!.tryTake());
    this.violations = ok ? Math.max(0, this.violations - 1) : this.violations + 1;
    return ok;
  }
}

export function categoryFor(type: string): RateCategory {
  if (type === 'player:input') return 'input';
  if (type.startsWith('block:')) return 'block';
  if (type === 'chat:send') return 'chat';
  if (type.startsWith('inventory:') || type.startsWith('crafting:')) return 'inventory';
  if (type.startsWith('world:chunk')) return 'chunks';
  return 'global';
}
