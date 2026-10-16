// WebGL availability check and the "cannot run" modal.
// Copied from packages/game/src/logic/webglSupport.ts (CLAUDE.md rule 10: no
// cross-package imports); maintained independently.
//
// There is NO polyfill for WebGL and there cannot be one: it is GPU access
// through a driver, not a JS API a library can supply. Software rendering
// (SwiftShader, llvmpipe) is the BROWSER's fallback, chosen by the browser —
// a page cannot load it. The old canvas-2d "webgl polyfill" packages emulate a
// few primitives at a handful of frames per second and cannot run a
// PlayCanvas scene, so shipping one would only trade a clear error for a
// frozen tab. Hence: detect, explain, and tell the player how to fix it.

/** Why the device cannot run the game, or null when it can. */
export type WebGLFailure = 'disabled' | 'unavailable';

/**
 * Probes for a usable WebGL context on a THROWAWAY canvas.
 *
 * Done before PlayCanvas boots, because `new pc.Application()` throws when the
 * context is missing and the failure surfaces as an unhandled rejection — a
 * black page with an error only in the console.
 *
 * Both webgl2 and webgl are tried: PlayCanvas falls back to WebGL 1, so
 * refusing a device that only has WebGL 1 would lock out players who can
 * actually run the game.
 */
export function detectWebGL(): WebGLFailure | null {
  if (typeof WebGLRenderingContext === 'undefined') {
    // The constructor itself is gone: the build has WebGL compiled out or
    // switched off by policy, rather than failing to get a device.
    return 'disabled';
  }
  const canvas = document.createElement('canvas');
  for (const type of ['webgl2', 'webgl', 'experimental-webgl'] as const) {
    try {
      if (canvas.getContext(type) != null) {
        return null;
      }
    } catch {
      // Some builds throw instead of returning null; keep trying the rest.
    }
  }
  return 'unavailable';
}

/**
 * Full-screen explanation, shown instead of the game.
 *
 * Plain DOM with its own <style> on purpose: this must render when the
 * renderer is the thing that failed, so it may not depend on anything the
 * game loads. Laid out for a phone in both orientations: one column in
 * portrait, two columns in landscape so it fits 390 px of height without
 * scrolling (and scrolls when it still does not fit).
 */
export function showWebGLModal(reason: WebGLFailure): void {
  const style = document.createElement('style');
  style.textContent = `
#webgl-unsupported{position:fixed;inset:0;z-index:10000;display:flex;justify-content:center;overflow-y:auto;box-sizing:border-box;
  padding:calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left));
  background:#0e100d;font:14px/1.5 Verdana,Geneva,sans-serif;color:#d8d8d8;-webkit-text-size-adjust:100%}
#webgl-unsupported .wgl-card{margin:auto;width:100%;max-width:560px;box-sizing:border-box;padding:20px 18px;
  background:linear-gradient(#1d211b,#14170f);border:1px solid #3a4036;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.6)}
#webgl-unsupported h1{margin:0 0 10px;font:700 19px/1.25 Verdana,sans-serif;color:#8fdc8f}
#webgl-unsupported p{margin:0 0 12px}
#webgl-unsupported .wgl-how{margin:0 0 6px;color:#9fb08f}
#webgl-unsupported ul{margin:0;padding-left:18px}
#webgl-unsupported li{margin:0 0 6px;font-size:13px;line-height:1.45}
#webgl-unsupported button{display:block;width:100%;min-height:44px;margin-top:16px;padding:10px 22px;cursor:pointer;
  font:700 14px Verdana,sans-serif;color:#0e100d;background:linear-gradient(#8fdc8f,#5fb35f);border:1px solid #3a4036;border-radius:6px}
@media (orientation: landscape) and (max-height: 520px){
  #webgl-unsupported .wgl-card{max-width:820px;padding:14px 18px;display:grid;grid-template-columns:1fr 1.15fr;column-gap:22px;align-items:start}
  #webgl-unsupported .wgl-fix{grid-column:2;grid-row:1 / span 2}
  #webgl-unsupported button{grid-column:1;align-self:end}
  #webgl-unsupported h1{font-size:17px;margin-bottom:6px}
  #webgl-unsupported p{font-size:13px;margin-bottom:8px}
  #webgl-unsupported li{font-size:12px;margin-bottom:4px}
  #webgl-unsupported button{margin-top:8px;min-height:40px}
}
@media (max-width: 400px){
  #webgl-unsupported h1{font-size:18px}
  #webgl-unsupported .wgl-card{padding:18px 16px}
}`;

  const overlay = document.createElement('div');
  overlay.id = 'webgl-unsupported';

  const card = document.createElement('div');
  card.className = 'wgl-card';

  // Column 1 (the only column in portrait): what happened, and the button.
  const intro = document.createElement('div');
  const title = document.createElement('h1');
  title.textContent = 'WebGL is turned off';
  const lead = document.createElement('p');
  lead.textContent =
    reason === 'disabled'
      ? 'This browser has WebGL disabled, so the tank battle cannot be drawn. It is a 3D game and there is no 2D fallback \u2014 switching WebGL back on is the only way to play.'
      : 'This browser could not start WebGL, so the tank battle cannot be drawn. Usually the graphics driver is blocked or hardware acceleration is off.';
  intro.append(title, lead);

  // The button: last in portrait (after the steps), under the text in landscape.
  const retry = document.createElement('button');
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => window.location.reload());

  // Column 2: how to fix it.
  const fix = document.createElement('div');
  fix.className = 'wgl-fix';
  const how = document.createElement('p');
  how.className = 'wgl-how';
  how.textContent = 'How to switch it on:';
  const list = document.createElement('ul');
  const steps = [
    'Chrome / Edge: Settings \u2192 System \u2192 turn on "Use graphics acceleration when available", then restart the browser.',
    'Firefox: open about:config and set webgl.disabled to false.',
    'Safari: Settings \u2192 Advanced \u2192 Show Develop menu, then Develop \u2192 uncheck "Disable WebGL".',
    'On a phone, updating the browser usually brings it back.',
  ];
  for (const step of steps) {
    const li = document.createElement('li');
    li.textContent = step;
    list.append(li);
  }
  fix.append(how, list);

  card.append(intro, fix, retry);
  overlay.append(card);
  document.head.append(style);
  document.body.append(overlay);
}
