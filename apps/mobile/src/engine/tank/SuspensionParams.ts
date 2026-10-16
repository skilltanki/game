// Port of the original SuspensionParams
export class SuspensionParams {
  maxRayLength = 50;
  nominalRayLength = 25;
  /** Recomputed every tick from gravity and tank mass (TrackedChassis.adjustSuspensionSpringCoeff). */
  springCoeff = 0;
  dampingCoeff = 1000;
}
