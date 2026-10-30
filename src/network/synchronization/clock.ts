/**
 * Estimates round-trip latency and the offset between the local clock and the
 * server clock from ping/pong exchanges (smoothed to ignore jitter).
 */
export class ServerClock {
  latency = 0;
  private offset = 0;
  private samples = 0;

  /** @param sentAt local Date.now() when the ping was sent */
  addSample(sentAt: number, serverTime: number, receivedAt = Date.now()): void {
    const rtt = Math.max(0, receivedAt - sentAt);
    const offset = serverTime - (sentAt + rtt / 2);
    if (this.samples === 0) {
      this.latency = rtt;
      this.offset = offset;
    } else {
      this.latency = this.latency * 0.8 + rtt * 0.2;
      this.offset = this.offset * 0.9 + offset * 0.1;
    }
    this.samples++;
  }

  /** Current server time in milliseconds. */
  now(): number {
    return Date.now() + this.offset;
  }

  reset(): void {
    this.samples = 0;
    this.latency = 0;
    this.offset = 0;
  }
}
