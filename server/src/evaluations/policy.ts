/** One budget shared by primary, repair, verifier and every transient retry. */
export class EvaluationPolicy {
  calls = 0;
  retries = 0;
  repairs = 0;
  readonly deadline: number;
  constructor(
    deadlineMs = 120_000,
    private now = Date.now,
  ) {
    this.deadline = now() + deadlineMs;
  }
  remaining() {
    return Math.max(0, this.deadline - this.now());
  }
  reserve() {
    if (this.calls >= 4 || !this.remaining()) return false;
    this.calls++;
    return true;
  }
  retry(delay: number) {
    if (
      this.retries ||
      !Number.isFinite(delay) ||
      delay < 0 ||
      delay >= this.remaining() ||
      this.calls >= 4
    )
      return false;
    this.retries++;
    return true;
  }
  repair() {
    if (this.repairs || this.calls >= 4 || !this.remaining()) return false;
    this.repairs++;
    return true;
  }
}
