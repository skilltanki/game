// Fixed-timestep accumulator (the BattleRunner pattern): frame time is
// accumulated, whole physics steps are run, and the remainder is exposed as
// the interpolation alpha for rendering.

export class FixedStepper {
  private accumulatorMs = 0;
  /** Number of steps simulated so far (the simulation tick). */
  tick = 0;
  /** Simulation time, ms, = tick * stepMs. */
  timeMs = 0;

  constructor(
    readonly stepMs: number,
    /** Frame time cap, so a background tab does not simulate seconds at once. */
    private readonly maxFrameMs = 250,
  ) {}

  /** Feeds a frame and runs `step` once per whole physics step. */
  advance(frameDtMs: number, step: (tick: number, timeMs: number, dtSec: number) => void): void {
    this.accumulatorMs += Math.min(frameDtMs, this.maxFrameMs);
    while (this.accumulatorMs >= this.stepMs) {
      this.tick += 1;
      this.timeMs += this.stepMs;
      step(this.tick, this.timeMs, this.stepMs / 1000);
      this.accumulatorMs -= this.stepMs;
    }
  }

  /** 0..1 fraction of the next step already elapsed (render interpolation). */
  get alpha(): number {
    return this.accumulatorMs / this.stepMs;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.tick = 0;
    this.timeMs = 0;
  }

  /** Drops the partial frame (after a pause, so nothing catches up). */
  drain(): void {
    this.accumulatorMs = 0;
  }
}
