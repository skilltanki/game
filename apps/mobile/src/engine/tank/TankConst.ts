// Port of the original TankConst
export class TankConst {
  static readonly RAY_OFFSET = 10;
  static readonly NUM_RAYS_PER_TRACK = 5;
  static readonly MAX_SLOPE_ANGLE = Math.PI / 3;
  static readonly MAX_SLOPE_ANGLE_COS = Math.cos(TankConst.MAX_SLOPE_ANGLE);
}
