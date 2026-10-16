// Port of the original PhysicsMaterial
export class PhysicsMaterial {
  static readonly DEFAULT_MATERIAL = new PhysicsMaterial();

  constructor(public restitution = 0, public friction = 0.3) {}
}
