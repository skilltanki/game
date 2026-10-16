// Battle-wide visual effects: tracers, the flipbook sheets (muzzle flashes,
// explosions, status overlays), the railgun's trail/smoke/pow, and the dust
// from under the tracks. Moved verbatim from main.ts; behavior is 1:1.
import { assetUrl } from '../tank/TankAssets';
import * as pc from 'playcanvas';
import { TracerEffects } from '../weapon/TracerEffects';
import { HitEffects } from '../weapon/HitEffects';
import { RailgunShotEffect } from '../weapon/RailgunShotEffect';
import { Dust } from '../game/Dust';
import type { GameTank } from '../game/GameTank';
import type { MapVisual } from './bootstrap';

/** Stream turrets draw their jet with these sheets instead of a tracer line. */
export const STREAM_SPRITE: Record<string, string> = {
  Firebird: 'stream_Firebird',
  Freeze: 'stream_Freeze',
};
export const MUZZLE_SIZE: Record<string, number> = { Smoky: 150, Thunder: 210 };
/** Smoky's VISUAL shell speed (damage is still instant), units/s. */
export const VISUAL_SHELL_SPEED = 7000;

export interface BattleEffects {
  tracers: TracerEffects;
  hitEffects: HitEffects;
  railgunShot: RailgunShotEffect;
  dust: Dust;
  /** Registers a tank with the dust system (one chance per suspension ray). */
  addTankDust(gameTank: GameTank): void;
}

export async function createBattleEffects(
  app: pc.AppBase,
  simRoot: pc.Entity,
  dustVisual: MapVisual | undefined,
): Promise<BattleEffects> {
  const tracers = new TracerEffects(simRoot);
  tracers.init(app); // original per-turret shot textures
  const hitEffects = new HitEffects(simRoot);
  hitEffects.init(app); // original flipbook sheets (explosion/smoke)
  // Original muzzle-flash and shell-explosion flipbooks per turret
  const FX = assetUrl('/turrets');
  hitEffects.registerSheet('muzzle_Smoky', `${FX}/smoky/m0/fire.png`, 16);
  hitEffects.registerSheet('muzzle_Thunder', `${FX}/thunder/m0/fire.png`, 29);
  hitEffects.registerSheet('expl_Twins', `${FX}/twins/m0/explosion.png`, 10);
  // Twins: plasma orb glowing on the barrel while the gun recharges (charge.png,
  // a steady crackling loop) and the shell dissipating at max range (fade.png,
  // 12 frames that shrink to nothing).
  hitEffects.registerSheet('charge_Twins', `${FX}/twins/m0/charge.png`, 10);
  hitEffects.registerSheet('fade_Twins', `${FX}/twins/m0/fade.png`, 12);
  // Isida idle sparks: IsisState.IDLE — the muzzle crackles while the beam is off
  hitEffects.registerSheet('idle_Isida', `${FX}/isida/m0/idle_spark.png`, 10);
  // Ice crystals swirling on a tank chilled by Freeze
  hitEffects.registerSheet('frost', `${FX}/frezee/m0/snow_flake.png`, 13);
  // Flames on a tank set alight by Firebird — the counterpart to 'frost'
  hitEffects.registerSheet('burn', `${FX}/firebird/m0/fireball.png`, 10);
  hitEffects.registerSheet('expl_Ricochet', `${FX}/ricochet/m0/ricochet_explosion.png`, 20);
  hitEffects.registerSheet('expl_Shaft', `${FX}/shaft/m0/shaft_explosion.png`, 17);
  // Stream jets render as their original sprites along the beam, not a line
  hitEffects.registerSheet('stream_Firebird', `${FX}/firebird/m0/fireball.png`, 10);
  hitEffects.registerSheet('stream_Freeze', `${FX}/frezee/m0/snow_breeze.png`, 18);
  // Dust from under the tracks (Dust.as). The original pulled its sprite from a
  // server resource id; the death smoke puff is the matching visual here.
  hitEffects.registerSheet('dust', assetUrl('/battle/death/smoke.png'), 20);
  // Railgun "pow" flash at the hit point (RailgunPowEffect, size 200 @ 30fps)
  hitEffects.registerSheet('pow_Railgun', assetUrl('/battle/death/shock_wave.png'), 16);
  // Smoky's hitscan shows a VISUAL shell flying out of the muzzle (its
  // original shot.png is the shell sprite) — damage is still instant
  hitEffects.registerSheet('shell_Smoky', `${FX}/smoky/m0/shot.png`, 1);
  // Railgun charge animation (original ChargeEffect: charge_part1..3 glued,
  // 3 frames played over the whole charging time at the muzzle, size 300)
  hitEffects.registerSheet('charge_Railgun', `${FX}/railgun/m0/charge_strip.png`, 3);
  // Railgun shot visuals (ShotTrailEffect + ShotSmokeEffect): glowing rings
  // along the ray plus a smoke ribbon trailing from the muzzle.
  const railgunShot = await RailgunShotEffect.create(
    app, simRoot, `${FX}/railgun/m0/railgun.png`, assetUrl('/battle/death/smoke.png'),
  );
  // Dust from under the tracks (port of Dust.as) — driven per physics step.
  // Dust size/density are per-map in the server data (visual.dust*). The
  // original also named the sprite there (`summer`/`winter`), which is the
  // asset this port could never find by name — it still paints a tinted puff.
  const dust = new Dust(
    hitEffects,
    'dust',
    dustVisual != null ? dustVisual.dustSize : 90,
    700,
    undefined,
    dustVisual?.dustDensity,
  );
  // Tank.calculateBoundSphereRadius: |(halfX, halfY, halfZ)| of the hull box.
  const addTankDust = (gameTank: GameTank): void => {
    dust.addTank(
      gameTank.tank,
      Math.hypot(gameTank.hullSize.x / 2, gameTank.hullSize.y / 2, gameTank.hullSize.z / 2),
    );
  };
  return { tracers, hitEffects, railgunShot, dust, addTankDust };
}
