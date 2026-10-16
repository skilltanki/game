// The death lifecycle: spawn-point picking (chosen AT DEATH for the camera
// fly-in and, later, the multiplayer protocol), respawning with spawn
// protection, frag crediting for weaponless deaths, the held self-destruct,
// overturned-tank recovery and the out-of-world (killZ) check. Moved verbatim
// from main.ts; behavior is 1:1.
import { Vector3 } from '../math/Vector3';
import { TankState } from '../game/TankRoster';
import { PHYSICS_STEP_IN_MS } from '../tank/TankPhysicsScene';
import type { GameTank } from '../game/GameTank';
import type { BattleScore } from '../game/BattleScore';
import type { Supplies } from '../game/Supplies';
import type { SpawnPoint } from '../map/SpawnPoints';
import type { CtfMode } from '../game/CtfMode';
import type { HitEffects } from '../weapon/HitEffects';
import type { StatusEffects } from './statusEffects';
import type { CombatPresenter } from './combat';

export const SPAWN_PROTECTION_MS = 3000;
export const RESPAWN_DELAY_MS = 2500;
export const SUICIDE_DELAY_MS = 5000;
export const OVERTURN_WARN_MS = 2000;
const OVERTURN_FLIP_MS = 6000;
/**
 * Who earns the frag for a death that no weapon caused (drowning, self
 * destruct): whoever damaged the victim within the last 10 s, else the
 * nearest enemy. Shared so the two paths cannot drift apart.
 */
const CREDIT_WINDOW_MS = 10000;

export interface RespawnDeps {
  statusEffects: StatusEffects;
  battleScore: BattleScore;
  combat: CombatPresenter;
  hitEffects: HitEffects;
  suppliesByTank: TankState<Supplies>;
  spawnPoints: SpawnPoint[];
  killZ: number;
  ctf: () => CtfMode | null;
  tanks: () => GameTank[];
  localPlayer: () => GameTank;
  getNow(): number;
  /** The local player died: the camera flies toward this upcoming spawn. */
  onLocalSpawnPicked(spawn: SpawnPoint): void;
  /** The local player is back: the fly-in (if any) is over. */
  onLocalRespawned(): void;
}

export class RespawnSystem {
  // The next spawn point is chosen AT DEATH, not at respawn: the camera fly-in
  // needs the destination in advance (and so will the multiplayer protocol).
  private readonly pendingSpawns = new TankState<SpawnPoint>();
  private readonly respawnTimers = new TankState<number>();
  private readonly overturnMs = new TankState<number>();
  /**
   * Self-destruct is a HELD action. The elapsed time is accumulated inside the
   * fixed-step loop rather than compared against a deadline captured in a DOM
   * handler — those run between steps, so the game time there is stale and the
   * trigger fired early (measured: death at ~2.8 s of a 5 s hold).
   */
  suicideHeld = false;
  suicideHeldMs = 0;
  /**
   * Multiplayer: the server owns deaths and respawns. When set, a completed
   * self-destruct hold SENDS the claim instead of detonating locally, and
   * stepDeaths() does nothing — kills arrive as server messages, drowning
   * included (detected server-side from the move stream).
   */
  network: { sendSuicide(): void } | null = null;
  /** Latched when the hold is invalidated (death) until the button is released. */
  private suicideCancelled = false;

  constructor(private readonly deps: RespawnDeps) {}

  setSuicideHeld(held: boolean): void {
    if (held && this.deps.localPlayer().tank.isDead()) {
      return;
    }
    this.suicideHeld = held;
    if (held) {
      this.suicideCancelled = false;
    } else {
      this.suicideHeldMs = 0;
      this.suicideCancelled = false;
    }
  }

  /** Milliseconds this tank has been dead (0 = alive or just died). */
  respawnTimerMs(gameTank: GameTank): number {
    return this.respawnTimers.get(gameTank) ?? 0;
  }

  /** True once the overturn warning should show for this tank. */
  isOverturnWarning(gameTank: GameTank): boolean {
    return (this.overturnMs.get(gameTank) ?? 0) >= OVERTURN_WARN_MS;
  }

  pickNextSpawn(gameTank: GameTank): SpawnPoint {
    const { spawnPoints } = this.deps;
    const spawn =
      (spawnPoints.length > 0 ? gameTank.pickSpawnPoint(spawnPoints) : null) ??
      { type: 'dm' as const, position: new Vector3(0, 0, 150), rotationZ: 0 };
    this.pendingSpawns.set(gameTank, spawn);
    return spawn;
  }

  respawn(gameTank: GameTank): void {
    this.respawnAt(gameTank, this.pendingSpawns.get(gameTank) ?? this.pickNextSpawn(gameTank));
  }

  /**
   * Respawns at an EXPLICIT point — the multiplayer client calls this with the
   * server's spawn message, bypassing the local pick.
   */
  respawnAt(gameTank: GameTank, spawn: SpawnPoint): void {
    const { deps } = this;
    deps.suppliesByTank.get(gameTank)?.clearEffects();
    // A respawned tank starts fresh: full weapon gauge and no pending
    // charge/overheat, instead of inheriting whatever was left at death.
    gameTank.weapon.reset?.();
    // Status effects from enemy stream weapons die with the tank
    deps.statusEffects.resetFor(gameTank);
    gameTank.tank.respawn();
    gameTank.spawnAtPoint(spawn);
    this.pendingSpawns.delete(gameTank);
    // Spawn protection: brief invulnerability (the tank blinks while it lasts)
    gameTank.tank.invulnerableUntil = deps.getNow() + SPAWN_PROTECTION_MS;
    // Assault spawns carriers on their own pedestal; without a brief hold
    // they would grab the flag on the spawn frame.
    deps.ctf()?.lockPickup(gameTank, deps.getNow());
  }

  /**
   * Closest living enemy to `victim`. Used to credit a frag when nobody dealt
   * the finishing damage (self-destruct, falling off the map): with more than
   * one opponent on the field the nearest one is the plausible cause, whereas
   * picking the first in the list always credited the same tank.
   */
  private nearestEnemy(victim: GameTank): GameTank | null {
    let bestAlive: GameTank | null = null;
    let bestAliveDistSq = Infinity;
    // Fallback across ALL enemies, dead ones included: in a 1v1 the only
    // opponent is often sitting in its respawn delay, and skipping it dropped
    // the frag entirely ("Бот утонул" instead of "Игрок утопил Бот").
    let bestAny: GameTank | null = null;
    let bestAnyDistSq = Infinity;
    const from = victim.tank.getBody().state.position;
    for (const candidate of this.deps.tanks()) {
      if (candidate === victim) {
        continue;
      }
      if (victim.tank.team !== 'dm' && candidate.tank.team === victim.tank.team) {
        continue;
      }
      const p = candidate.tank.getBody().state.position;
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      const dz = p.z - from.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < bestAnyDistSq) {
        bestAnyDistSq = distSq;
        bestAny = candidate;
      }
      if (!candidate.tank.isDead() && distSq < bestAliveDistSq) {
        bestAliveDistSq = distSq;
        bestAlive = candidate;
      }
    }
    // A living enemy is the plausible cause; a dead one still gets the credit
    // rather than letting the kill go unattributed.
    return bestAlive ?? bestAny;
  }

  creditFor(victim: GameTank): GameTank | null {
    return (
      this.deps.statusEffects.lastAttacker(victim, this.deps.getNow(), CREDIT_WINDOW_MS) ??
      this.nearestEnemy(victim)
    );
  }

  /** Self-destruct: only while the button stays held. Fixed-step pass. */
  stepSuicide(): void {
    if (!this.suicideHeld) {
      return;
    }
    const { deps } = this;
    const player = deps.localPlayer();
    // Dying mid-hold cancels it. The check has to latch: the respawn lands
    // while the button is still down, so by the time the timer elapsed the
    // tank was ALIVE again and a fresh one detonated (measured: died at
    // 2.5 s of a 5 s hold, blast still dealt 240).
    if (player.tank.isDead()) {
      this.suicideCancelled = true;
    }
    if (this.suicideCancelled) {
      this.suicideHeld = false;
      this.suicideHeldMs = 0;
    } else if ((this.suicideHeldMs += PHYSICS_STEP_IN_MS) >= SUICIDE_DELAY_MS) {
      this.suicideHeld = false;
      this.suicideHeldMs = 0;
      if (this.network != null) {
        // The server kills us and answers with `kill` + `spawnPoint`.
        this.network.sendSuicide();
        return;
      }
      player.tank.kill();
      player.audio?.playDeath();
      deps.hitEffects.spawnExplosion(player.tank.getBody().state.position);
      deps.combat.detonateWreck(player);
      // Self-destruct counts as a kill for the opponent, same rule as
      // falling off the map: credit whoever damaged us last (we blew up to
      // deny them the kill), otherwise the enemy.
      const killer = this.creditFor(player);
      deps.battleScore.recordDeath({
        victim: player,
        killer: killer != null && !killer.isLocal ? killer : null,
        cause: 'selfDestruct',
      });
    }
  }

  private static isTurnedOver(gameTank: GameTank): boolean {
    return gameTank.tank.getBody().baseMatrix.m22 < 0.15;
  }

  private static flipUpright(gameTank: GameTank): void {
    const body = gameTank.tank.getBody();
    const yaw = gameTank.tank.getTankDirection();
    body.state.position.z += 150;
    body.state.orientation.setFromAxisAngleComponents(0, 0, 1, yaw);
    body.state.velocity.reset(0, 0, 0);
    body.state.angularVelocity.reset(0, 0, 0);
    body.saveState();
    body.calcDerivedData();
  }

  /** Overturned tanks: warn, then flip back upright. Fixed-step pass. */
  stepOverturn(): void {
    for (const gameTank of this.deps.tanks()) {
      // Multiplayer: only the LOCAL tank may be flipped. A remote copy's
      // pose belongs to the wire — an observer-side flip (+150 z teleport)
      // would fight the owner's packets. Bots never coexist with network.
      if (this.network != null && gameTank !== this.deps.localPlayer()) {
        continue;
      }
      if (!gameTank.tank.isDead() && RespawnSystem.isTurnedOver(gameTank)) {
        const t = (this.overturnMs.get(gameTank) ?? 0) + PHYSICS_STEP_IN_MS;
        if (t >= OVERTURN_FLIP_MS) {
          RespawnSystem.flipUpright(gameTank);
          this.overturnMs.delete(gameTank);
        } else {
          this.overturnMs.set(gameTank, t);
        }
      } else {
        this.overturnMs.delete(gameTank);
      }
    }
  }

  /** KillZ drownings and the delayed respawn of damage kills. Fixed-step pass. */
  stepDeaths(): void {
    if (this.network != null) {
      return; // the server runs the death lifecycle (kill/spawnPoint/spawn)
    }
    const { deps } = this;
    for (const gameTank of deps.tanks()) {
      // Fell off the map (water has no collision): instant death + respawn.
      // Only for a LIVE tank — a wreck killed by damage keeps its body in the
      // world during the respawn delay and can slide into the water, which
      // would award the killer a second frag (and the victim a second death)
      // for the same death. A dead tank falls through to the respawn branch.
      if (!gameTank.tank.isDead() && gameTank.tank.getBody().state.position.z < deps.killZ) {
        gameTank.tank.kill();
        gameTank.audio?.playDeath();
        // NO detonateWreck here: the tank is far below the map by now, so the
        // blast would either hit nothing or reach tanks standing above the
        // water through empty space.
        // The death itself is counted by recordDeath below.
        // Falling off the map counts as a kill for the opponent: credit the
        // last tank that damaged the victim (knocked it off), else the enemy.
        deps.battleScore.recordDeath({
          victim: gameTank,
          killer: this.creditFor(gameTank),
          cause: 'drown',
        });
        this.pickNextSpawn(gameTank);
        this.respawn(gameTank);
        this.respawnTimers.delete(gameTank);
        if (gameTank.isLocal) {
          deps.onLocalRespawned();
        }
      } else if (gameTank.tank.isDead()) {
        // Killed by damage: respawn after a delay; the next spawn point is
        // chosen immediately so the camera can fly there during the delay
        const previous = this.respawnTimers.get(gameTank) ?? 0;
        if (previous === 0) {
          // The death itself was already recorded by whoever caused it
          // (battleScore.recordDeath on the weapon-kill and self-destruct
          // paths). Counting it again here double-counted every death.
          const spawn = this.pickNextSpawn(gameTank);
          if (gameTank.isLocal) {
            deps.onLocalSpawnPicked(spawn);
          }
        }
        const timer = previous + PHYSICS_STEP_IN_MS;
        if (timer >= RESPAWN_DELAY_MS) {
          this.respawn(gameTank);
          this.respawnTimers.delete(gameTank);
          if (gameTank.isLocal) {
            deps.onLocalRespawned();
          }
        } else {
          this.respawnTimers.set(gameTank, timer);
        }
      }
    }
  }
}
