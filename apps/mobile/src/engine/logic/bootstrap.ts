// App/scene bootstrap and the map registry: the pieces of main.ts that have no
// battle state at all. Moved verbatim from main.ts (step "разбиение main.ts",
// see packages/server/PLAN.md §11); behavior is 1:1.
import * as pc from 'playcanvas';
import { assetUrl } from '../tank/TankAssets';

// Simulation runs in original client space: Z-up, 1 m = 100 units, 33 ms fixed step
// (BattleRunner.PHYSICS_STEP_IN_MS). The render root converts to PlayCanvas space.
export const UNITS_TO_METERS = 0.01;
/** BattleSkyBox.SKYBOX_SIZE. */
export const SKYBOX_SIZE = 200000;
export const SKYBOX_BASE = assetUrl('/battle/skyboxes');
/**
 * Fallback sky for a map with no `skybox` in maps.json. The original picked
 * the set per battle on the server, which this port has no equivalent of, so
 * the choice lives in the map registry instead.
 */
export const DEFAULT_SKYBOX = 'skybox6';

export const DEFAULT_GRAVITY = 1000; // units/s^2, from map init params in the original

export interface MapRegistryEntry {
  id: string;
  name: string;
  theme: 'summer' | 'winter';
  /** Fully-qualified map XML URL (see assetUrl). */
  file: string;
  /** Fully-qualified preview image URL. */
  thumbnail?: string;
  /** Skybox set id (see maps.json); absent = the default sky. */
  skybox?: string;
  gravity?: number;
  /** Per-map lighting/fog/dust from the ProTanki map data; see MapVisual. */
  visual?: MapVisual;
  /**
   * False when the map XML has no <ctf-flags>, so Capture the Flag cannot be
   * played there. Written by sync-assets, which already parses every map.
   */
  supportsCtf?: boolean;
}

/**
 * Per-map look, transcribed from the ProTanki server's map data (the `visual`
 * block). The original client received all of this from the server, so none of it
 * is recoverable from the decompile — before this it was hardcoded or guessed.
 */
export interface MapVisual {
  lightColor: string;
  shadowColor: string;
  fogColor: string;
  fogAlpha: number;
  /** Fog start / full strength, in SIM units. */
  nearLimit: number;
  farLimit: number;
  /** Sun direction. */
  angleX: number;
  angleZ: number;
  dustParticle: 'summer' | 'winter';
  dustDensity: number;
  dustSize: number;
  dustAlpha: number;
  dustNearDistance: number;
  dustFarDistance: number;
}

export interface MapRegistry {
  defaultMap: string;
  maps: MapRegistryEntry[];
}

export async function loadMapRegistry(): Promise<MapRegistry> {
  const response = await fetch(assetUrl('/maps.json'));
  if (!response.ok) {
    throw new Error(`Failed to load /maps.json: HTTP ${response.status}`);
  }
  const registry = (await response.json()) as MapRegistry;
  // Qualify the manifest's site-absolute paths against the page origin so every
  // consumer holds a complete URL and never re-prefixes one by hand.
  return {
    ...registry,
    maps: registry.maps.map((m) => ({
      ...m,
      file: assetUrl(m.file),
      ...(m.thumbnail != null ? { thumbnail: assetUrl(m.thumbnail) } : {}),
    })),
  };
}

export function createApp(): pc.AppBase {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  const app = new pc.Application(canvas, {
    keyboard: new pc.Keyboard(window),
    graphicsDeviceOptions: { antialias: true },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  window.addEventListener('resize', () => app.resizeCanvas());
  return app;
}

export function createScene(app: pc.AppBase): { simRoot: pc.Entity; camera: pc.Entity } {
  const camera = new pc.Entity('camera');
  camera.addComponent('camera', {
    clearColor: new pc.Color(0.55, 0.7, 0.9),
    farClip: 2000,
  });
  camera.setPosition(0, 8, 14);
  camera.addComponent('audiolistener');
  app.root.addChild(camera);

  const light = new pc.Entity('light');
  light.addComponent('light', {
    type: 'directional',
    castShadows: false,
    intensity: 1.2,
  });
  light.setEulerAngles(50, 30, 0);
  app.root.addChild(light);

  // Z-up sim space -> PlayCanvas Y-up world: rotate -90deg about X, scale to meters.
  const simRoot = new pc.Entity('simRoot');
  simRoot.setLocalEulerAngles(-90, 0, 0);
  simRoot.setLocalScale(UNITS_TO_METERS, UNITS_TO_METERS, UNITS_TO_METERS);
  app.root.addChild(simRoot);

  return { simRoot, camera };
}

/** "#rrggbb" -> pc.Color. */
export function hexColor(hex: string): pc.Color {
  const n = parseInt(hex.replace('#', ''), 16);
  return new pc.Color(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/**
 * Applies a map's `visual` block to the scene: sun colour and direction, fog,
 * and the camera's clear colour. Distances are SIM units in the data and
 * metres in the renderer, hence the UNITS_TO_METERS conversion.
 */
export function applyMapVisual(app: pc.AppBase, camera: pc.Entity, visual: MapVisual): void {
  const light = app.root.findByName('light') as pc.Entity | null;
  if (light?.light != null) {
    light.light.color = hexColor(visual.lightColor);
    // angleX/angleZ are the server's sun direction; its X is a pitch in
    // radians-ish units and Z a yaw, both negative-down in the original's
    // Z-up space. Mapped onto PlayCanvas' Y-up euler angles.
    light.setEulerAngles((-visual.angleX * 180) / Math.PI + 90, (visual.angleZ * 180) / Math.PI, 0);
  }
  // Ambient stands in for the original's shadowColor: what the unlit side of
  // geometry fades toward.
  app.scene.ambientLight = hexColor(visual.shadowColor);
  const fog = hexColor(visual.fogColor);
  app.scene.fog.color = fog;
  if (visual.fogAlpha > 0) {
    // EXPONENTIAL, not linear. The original capped fog at fogAlpha —
    // Camera3D fed the shader `fogAlpha * fogStrength`, so even infinitely far
    // geometry was only ever 25% fog. PlayCanvas' linear fog reaches FULL
    // opacity at `end`, which painted everything past 100 m (the server's far
    // limit) as a solid wall, while the map runs out to ~275 m.
    //
    // Exponential fog with a density matched to the original's blend at its
    // far limit keeps the near range identical and stays gentle beyond it:
    //   100 m -> 0.25 (as the original), 275 m -> 0.55, 1000 m -> 0.94.
    const farMetres = Math.max(1, visual.farLimit * UNITS_TO_METERS);
    app.scene.fog.type = pc.FOG_EXP;
    app.scene.fog.density = -Math.log(1 - visual.fogAlpha) / farMetres;
  } else {
    app.scene.fog.type = pc.FOG_NONE;
  }
  // The sky is a textured box, so the clear colour only shows where it does
  // not reach — matching it to the fog keeps the horizon seamless.
  if (camera.camera != null) {
    camera.camera.clearColor = fog;
  }
}
