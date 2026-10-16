// Port of the original CollisionGroup
export class CollisionGroup {
  static readonly TANK = 1;
  static readonly ACTIVE_TRACK = 2;
  static readonly INACTIVE_TRACK = 4;
  static readonly WEAPON = 8;
  static readonly STATIC = 16;
  static readonly BONUS_WITH_TANK = 64;
}
