// Per-tank status state (Freeze chill, Firebird burn, who-hit-whom) and the
// weapon/status visuals that run every step or every frame: frost and flame
// overlays, Isida's idle sparks, the Twins and Railgun charge glows, and the
// continuous stream jets. Moved verbatim from main.ts; behavior is 1:1.
import { Vector3 } from '../math/Vector3';
import { TankState } from '../game/TankRoster';
import { StreamWeapon } from '../weapon/StreamWeapon';
import { ShaftWeapon } from '../weapon/ShaftWeapon';
import { RailgunWeapon } from '../weapon/RailgunWeapon';
import { getHullSpec } from '../tank/HullSpecs';
import { GameTank, WEAPON_SPECS } from '../game/GameTank';
import type { HitEffects } from '../weapon/HitEffects';
import { STREAM_SPRITE } from './effects';

// Freeze stream chills victims (the original server applied the slowdown)
const FREEZE_SLOW_MS = 2500;
/** Freeze also doubles the victim's reload while the chill lasts. */
const FROZEN_RELOAD_FACTOR = 2;
/** Firebird leaves the victim burning: x1.5 incoming damage for this long. */
const BURN_MS = 2500;
const BURN_DAMAGE_FACTOR = 1.5;
const ISIDA_SPARK_MS = 420;
/** Next sim time each chilled tank may re-spawn its frost overlay. */
const FROST_LOOP_MS = 540;
/** Ice patches spread over a chilled hull each loop. */
const FROST_PATCHES = 6;
const BURN_LOOP_MS = 420;
/** Flame tongues spread over a burning hull each loop. */
const BURN_FLAMES = 3;

/**
 * Turret name for a tank. Reads it off the tank itself: the old form asked
 * "is this the player?" and handed every other tank the BOT's turret, so a
 * third tank silently got the wrong weapon's effects and sounds.
 */
const turretNameOf = (gameTank: GameTank): string => gameTank.turretName;

export interface StatusEffectsDeps {
  hitEffects: HitEffects;
  tanks: () => GameTank[];
}

export class StatusEffects {
  private readonly chargeShown = new TankState<boolean>();
  /** Next sim time each Isida may re-spawn its idle muzzle sparks. */
  private readonly isidaSparkAt = new TankState<number>();
  private readonly frostSpawnAt = new TankState<number>();
  private readonly burnSpawnAt = new TankState<number>();
  private readonly frozenUntil = new TankState<number>();
  private readonly burningUntil = new TankState<number>();
  /** Who damaged this tank last (credits fall-off-the-map kills). */
  private readonly lastHitBy = new TankState<{ by: GameTank; t: number }>();
  /** Last applied speed multiplier per tank (chill / own jet slowdown). */
  private readonly speedFactorApplied = new TankState<number>();
  private readonly _frostAt = new Vector3();
  private readonly _burnAt = new Vector3();
  private readonly _streamPoint = new Vector3();
  private readonly _jetDir = new Vector3();
  private readonly _jetVel = new Vector3();

  constructor(private readonly deps: StatusEffectsDeps) {}

  /**
   * Railgun charge glow for a REMOTE tank: its weapon object never charges
   * locally (shots arrive as relayed messages), so the isCharging() sweep in
   * renderTick stays silent — the relayed charge message calls this instead.
   */
  showChargeGlow(gameTank: GameTank): void {
    const weapon = gameTank.weapon;
    if (weapon instanceof RailgunWeapon && weapon.getChargingDuration() > 0) {
      this.deps.hitEffects.spawnAttachedSheet(
        'charge_Railgun',
        (out) => gameTank.getMuzzleWorldPosition(out),
        300,
        weapon.getChargingDuration(),
      );
    }
  }

  /** Records the attacker so drownings and self-destructs credit a frag. */
  markHit(victim: GameTank, by: GameTank, now: number): void {
    this.lastHitBy.set(victim, { by, t: now });
  }

  /** Whoever damaged the victim within the window, else null. */
  lastAttacker(victim: GameTank, now: number, windowMs: number): GameTank | null {
    const record = this.lastHitBy.get(victim);
    return record != null && now - record.t < windowMs ? record.by : null;
  }

  /** Firebird sets the victim alight: it takes x1.5 damage while burning. */
  ignite(victim: GameTank, now: number): void {
    this.burningUntil.set(victim, now + BURN_MS);
  }

  /**
   * Freeze chills the victim (the original server slowed frozen tanks) and
   * drains its weapon gauge. The shooter gets NOTHING back: in the original
   * StreamWeapon the gauge only drains while firing and recharges while
   * idle, so refunding it per hit made Freeze self-sustaining — on target
   * the gauge refilled faster than firing drained it (measured 0.845 -> 1.0
   * while the same burst into empty air fell to 0.57).
   */
  chill(victim: GameTank, now: number, drainEnergy = true): void {
    this.frozenUntil.set(victim, now + FREEZE_SLOW_MS);
    // The victim is hit by BOTH the locally simulated remote stream and the
    // server's status message; the slow is idempotent (an until-timestamp),
    // the gauge drain is not — the network path passes false.
    if (!drainEnergy) {
      return;
    }
    const victimWeapon = victim.weapon;
    if (victimWeapon instanceof StreamWeapon || victimWeapon instanceof ShaftWeapon) {
      victimWeapon.addEnergy(-0.03);
    }
  }

  /** Twins afterglow position scratch (barrel pick). */
  private readonly _barrelAt = new Vector3();

  /**
   * Post-shot barrel glow for a REMOTE Twins: locally renderTick keys it on
   * the weapon's reload progress, which never moves for a remote weapon.
   * The relayed launch calls this instead, picking the barrel nearest the
   * sender's real muzzle origin — which also restores the left/right
   * alternation on observer screens.
   */
  showTwinsAfterglow(gameTank: GameTank, origin: Vector3): void {
    const count = gameTank.getBarrelCount();
    let barrel = 0;
    let best = Infinity;
    for (let i = 0; i < count; i++) {
      gameTank.getBarrelWorldPosition(i, this._barrelAt);
      const d = this._barrelAt.distanceToSquared(origin);
      if (d < best) {
        best = d;
        barrel = i;
      }
    }
    const reload = (WEAPON_SPECS.Twins as { reloadTime: number }).reloadTime;
    this.deps.hitEffects.spawnAttachedSheet(
      'charge_Twins',
      (out) => gameTank.getBarrelWorldPosition(barrel, out),
      90,
      reload * 0.75,
    );
  }

  /** Status effects from enemy stream weapons die with the tank. */
  resetFor(gameTank: GameTank): void {
    gameTank.tank.reloadTimeMultiplier = 1;
    gameTank.tank.burnDamageMultiplier = 1;
    this.frozenUntil.delete(gameTank);
    this.burningUntil.delete(gameTank);
  }

  /**
   * Fixed-step pass: frost/flame overlays, reload and burn multipliers, and
   * the speed modifiers — enemy Freeze chill (x0.45) and firing your own
   * Firebird/Freeze/Isida jet (x0.7); the strongest slowdown wins, applied on
   * top of the hull figure times the nitro boost (Tank.speedBoost), so a jet
   * that stops gives the nitro back instead of the bare hull speed.
   */
  applyStep(now: number): void {
    const { hitEffects } = this.deps;
    for (const gameTank of this.deps.tanks()) {
      const frozen = (this.frozenUntil.get(gameTank) ?? 0) > now && !gameTank.tank.isDead();
      // Ice crusting the chilled hull. Like the burn overlay, several smaller
      // patches spread over the tank read far better than one big sprite —
      // Freeze's own jet uses a different texture, but a single decal still
      // got lost against the hull at distance.
      const nextFrostAt = this.frostSpawnAt.get(gameTank) ?? 0;
      if (frozen && now >= nextFrostAt) {
        const hull = gameTank.hullSize;
        for (let i = 0; i < FROST_PATCHES; i++) {
          const along = ((i + 0.5) / FROST_PATCHES - 0.5) * hull.y * 0.85;
          const across = (i % 2 === 0 ? 1 : -1) * hull.x * 0.3;
          hitEffects.spawnJetParticle(
            'frost',
            (() => {
              const pos = gameTank.tank.getBody().state.position;
              const base = gameTank.tank.getBody().baseMatrix;
              this._frostAt.x = pos.x + base.m00 * across + base.m01 * along;
              this._frostAt.y = pos.y + base.m10 * across + base.m11 * along;
              this._frostAt.z = pos.z + base.m20 * across + base.m21 * along + hull.z * 0.4;
              return this._frostAt;
            })(),
            hull.z * 1.0,
            hull.z * 1.35,
            FROST_LOOP_MS,
            // Crystals drift up and settle, slower than flames
            { x: 0, y: 0, z: 55 },
          );
        }
        this.frostSpawnAt.set(gameTank, now + FROST_LOOP_MS);
      } else if (!frozen) {
        this.frostSpawnAt.set(gameTank, 0);
      }
      // Chilled tanks reload twice as slowly; burning tanks take x1.5 damage.
      gameTank.tank.reloadTimeMultiplier = frozen ? FROZEN_RELOAD_FACTOR : 1;
      const burning = (this.burningUntil.get(gameTank) ?? 0) > now && !gameTank.tank.isDead();
      // Flames on the burning hull, mirroring the frost overlay above.
      // Several smaller tongues spread over the hull rather than one big
      // sprite: Firebird's jet uses the SAME fireball texture, so a single
      // overlay was indistinguishable from the ~48 jet particles in flight.
      const nextBurnAt = this.burnSpawnAt.get(gameTank) ?? 0;
      if (burning && now >= nextBurnAt) {
        const hull = gameTank.hullSize;
        for (let i = 0; i < BURN_FLAMES; i++) {
          // Spread along the hull, alternating sides, rising as they burn
          const along = ((i + 0.5) / BURN_FLAMES - 0.5) * hull.y * 0.7;
          const across = (i % 2 === 0 ? 1 : -1) * hull.x * 0.22;
          hitEffects.spawnJetParticle(
            'burn',
            (() => {
              const pos = gameTank.tank.getBody().state.position;
              const base = gameTank.tank.getBody().baseMatrix;
              this._burnAt.x = pos.x + base.m00 * across + base.m01 * along;
              this._burnAt.y = pos.y + base.m10 * across + base.m11 * along;
              this._burnAt.z = pos.z + base.m20 * across + base.m21 * along + hull.z * 0.45;
              return this._burnAt;
            })(),
            hull.z * 0.75,
            hull.z * 1.15,
            BURN_LOOP_MS,
            { x: 0, y: 0, z: 110 },
          );
        }
        this.burnSpawnAt.set(gameTank, now + BURN_LOOP_MS);
      } else if (!burning) {
        this.burnSpawnAt.set(gameTank, 0);
      }
      // Separate field: takeDamage multiplies it with the armour supply's
      // own multiplier, so the two stack instead of clobbering each other.
      gameTank.tank.burnDamageMultiplier = burning ? BURN_DAMAGE_FACTOR : 1;
      const weapon = gameTank.weapon;
      const turretName = gameTank.turretName;
      const jetting =
        weapon instanceof StreamWeapon &&
        weapon.isStreaming() &&
        (turretName === 'Firebird' || turretName === 'Freeze' || turretName === 'Isida');
      let factor = jetting ? 0.7 : 1;
      if (frozen) {
        factor = Math.min(factor, 0.45);
      }
      // The applied product includes the nitro boost: a boost that comes or goes mid-jet re-applies too.
      const tank = gameTank.tank;
      const speedWant = factor * tank.speedBoost;
      const previous = this.speedFactorApplied.get(gameTank) ?? 1;
      if (speedWant !== previous) {
        const spec = getHullSpec(gameTank.hullName);
        // Only a slowdown or its end touches the cap here (nitro's own start/stop set it immediately in Supplies).
        if (factor !== 1 || previous / tank.speedBoost !== 1) {
          tank.setMaxSpeed(spec.maxSpeed * speedWant, false);
          tank.chassis.setAcceleration(spec.acceleration * tank.accelerationBoost * (factor < 0.7 ? 0.5 : factor));
        }
        this.speedFactorApplied.set(gameTank, speedWant);
      }
    }
  }

  /**
   * Render pass: Isida's idle sparks, the Twins/Railgun charge glows and the
   * Sub-Zero style continuous stream jets.
   */
  renderTick(now: number): void {
    const { hitEffects } = this.deps;
    // Isida at rest sparks at the muzzle (IsisState.IDLE). Re-armed whenever
    // the previous burst has played out, so it reads as a continuous crackle.
    for (const gameTank of this.deps.tanks()) {
      if (turretNameOf(gameTank) !== 'Isida' || gameTank.tank.isDead()) {
        continue;
      }
      const weapon = gameTank.weapon;
      const idle = weapon instanceof StreamWeapon && !weapon.isStreaming();
      const nextAt = this.isidaSparkAt.get(gameTank) ?? 0;
      if (idle && now >= nextAt) {
        hitEffects.spawnAttachedSheet(
          'idle_Isida',
          (out) => gameTank.getMuzzleWorldPosition(out),
          70,
          ISIDA_SPARK_MS,
        );
        this.isidaSparkAt.set(gameTank, now + ISIDA_SPARK_MS);
      } else if (!idle) {
        this.isidaSparkAt.set(gameTank, 0);
      }
    }

    // Twins: the plasma orb glows on the barrel while the gun recharges and
    // winks out as it becomes ready (original charge.png on the muzzle).
    for (const gameTank of this.deps.tanks()) {
      if (turretNameOf(gameTank) !== 'Twins' || gameTank.tank.isDead()) {
        continue;
      }
      const ready = gameTank.weapon.getStatus(now);
      const charging = ready > 0.25 && ready < 1;
      if (charging && !this.chargeShown.get(gameTank)) {
        const reload = (WEAPON_SPECS.Twins as { reloadTime: number }).reloadTime;
        // The glow belongs to the barrel that JUST fired — it is the plasma
        // still burning off after the discharge. barrelIndex already points at
        // the NEXT barrel (the shot advances it immediately), so step back one.
        const count = gameTank.getBarrelCount();
        const barrel = (gameTank.getCurrentBarrel() + count - 1) % count;
        hitEffects.spawnAttachedSheet(
          'charge_Twins',
          (out) => gameTank.getBarrelWorldPosition(barrel, out),
          90,
          reload * 0.75,
        );
      }
      this.chargeShown.set(gameTank, charging);
    }

    // Railgun charge: when the pre-shot charge starts, pin the original
    // 3-frame charge animation to the muzzle for the whole charging time
    for (const gameTank of this.deps.tanks()) {
      const weapon = gameTank.weapon;
      if (!(weapon instanceof RailgunWeapon)) {
        continue;
      }
      const charging = weapon.isCharging();
      if (charging && !this.chargeShown.get(gameTank)) {
        hitEffects.spawnAttachedSheet(
          'charge_Railgun',
          (out) => gameTank.getMuzzleWorldPosition(out),
          300,
          weapon.getChargingDuration(),
        );
      }
      this.chargeShown.set(gameTank, charging);
    }

    // Sub-Zero style continuous jets: while a stream weapon fires, emit
    // particles from the muzzle every frame; they fly along the beam, grow
    // and burn through their sprite frames — a solid flame/ice stream
    for (const gameTank of this.deps.tanks()) {
      const weapon = gameTank.weapon;
      if (!(weapon instanceof StreamWeapon) || !weapon.isStreaming()) {
        continue;
      }
      const key = STREAM_SPRITE[gameTank.turretName];
      if (key == null || !hitEffects.hasSheet(key)) {
        continue;
      }
      gameTank.getMuzzleWorldPosition(this._streamPoint);
      gameTank.getShotDirection(this._jetDir);
      const beamLength = Math.max(300, weapon.lastBeamLength);
      const lifeMs = 300;
      const speed = beamLength / (lifeMs / 1000);
      for (let i = 0; i < 2; i++) {
        // slight cone jitter so the jet looks alive
        const jx = (Math.random() - 0.5) * 0.14;
        const jy = (Math.random() - 0.5) * 0.14;
        this._jetVel.x = (this._jetDir.x + jx) * speed;
        this._jetVel.y = (this._jetDir.y + jy) * speed;
        this._jetVel.z = (this._jetDir.z + (Math.random() - 0.5) * 0.06) * speed;
        hitEffects.spawnJetParticle(key, this._streamPoint, 45, 185, lifeMs, this._jetVel);
      }
    }
  }
}
