// Entry point. Order matters:
//   1. bind the asset resolver (bundled vs remote) — several engine modules
//      resolve asset URLs the moment they are imported;
//   2. register the service worker (offline shell + cached remote assets);
//   3. only then import the DI module, which pulls in the engine, and boot.
import { installAssetResolver } from './config/assets';
import { CC_ASSET_CACHE_VERSION } from './config/params';
import { detectWebGL, showWebGLModal } from './ui/webglSupport';

async function main(): Promise<void> {
  // Before anything touches the renderer: new pc.Application() THROWS when no
  // WebGL context can be had, and the throw would surface as a black page with
  // the reason only in the console. Explain it instead.
  const noWebGL = detectWebGL();
  if (noWebGL != null) {
    showWebGLModal(noWebGL);
    return;
  }
  installAssetResolver();
  console.info(`[tanki] assets: /assets/ on ${location.origin} (cache v${CC_ASSET_CACHE_VERSION})`);

  if (!import.meta.env.DEV) {
    try {
      const { registerSW } = await import('virtual:pwa-register');
      registerSW({ immediate: true });
    } catch (error) {
      console.warn('[tanki] service worker not registered', error);
    }
  }

  const canvas = document.getElementById('app') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const params = new URLSearchParams(location.search);
  if (params.get('bench') === 'nav') {
    // Navigation-only benchmark over several maps (grid build + spawn reachability).
    const { runNavBench } = await import('./bench/BenchMode');
    await runNavBench((params.get('maps') ?? params.get('map') ?? 'island_old_summer').split(','), canvas, uiRoot);
    return;
  }
  if (params.has('bench')) {
    // Bot benchmark: no menu, no player, a JSON report at the end (see bench/BenchMode.ts).
    const { parseBenchConfig, runBench } = await import('./bench/BenchMode');
    await runBench(parseBenchConfig(params), canvas, uiRoot);
    return;
  }
  const { tanki } = await import('./lib/tanki');
  if (params.get('debug') === 'nav') {
    tanki.navOverlayService.enable();
  }
  await tanki.gameFacadeService.boot(canvas, uiRoot);
}

// A boot failure must not leave a black page: anything that escapes main()
// lands here, and a renderer-shaped failure gets the same explanation as a
// missing context (some drivers fail later, inside the first draw).
main().catch((error) => {
  console.error(error);
  if (document.getElementById('webgl-unsupported') == null) {
    showWebGLModal(detectWebGL() ?? 'unavailable');
  }
});
