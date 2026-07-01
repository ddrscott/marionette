// One Euro filter — carried over unchanged from the validated dot test.
// Defaults (minCutoff 1.5, beta 0.01) are a §2 settled decision: do not retune.

const alpha = (cutoff: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

class LowPass {
  private s: number | null = null;
  filter(x: number, a: number): number {
    this.s = this.s === null ? x : a * x + (1 - a) * this.s;
    return this.s;
  }
}

export class OneEuro {
  private xf = new LowPass();
  private dxf = new LowPass();
  private lastT: number | null = null;
  private lastX = 0;

  constructor(private minCutoff = 1.5, private beta = 0.01) {}

  // Clear all internal state so the next filter() call re-primes from scratch (returns its input
  // verbatim, no ease-in from a stale value). Used when a tracked source disappears and later
  // reappears somewhere else — the cursor should snap to the new position, not glide across.
  reset(): void {
    this.xf = new LowPass();
    this.dxf = new LowPass();
    this.lastT = null;
    this.lastX = 0;
  }

  filter(x: number, tMs: number): number {
    if (this.lastT === null) {
      this.lastT = tMs;
      this.lastX = x;
      return x;
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;
    const edx = this.dxf.filter((x - this.lastX) / dt, alpha(1.0, dt));
    const fx = this.xf.filter(x, alpha(this.minCutoff + this.beta * Math.abs(edx), dt));
    this.lastX = x;
    return fx;
  }
}
