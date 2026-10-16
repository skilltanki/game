// Advertising seam. Ads are MODAL only (interstitials between screens); no
// banners anywhere in the UI. The default provider shows nothing, so the game
// is playable without any ad SDK; the Google Play build (Capacitor) will
// provide AdMob here.

export type AdPlacement = string;

export interface AdProvider {
  readonly name: string;
  /** Shows a full-screen interstitial if one is ready; resolves when closed. */
  showInterstitial(placement: AdPlacement): Promise<void>;
  /** Pre-fetches an interstitial for the placement. */
  preloadInterstitial(placement: AdPlacement): void;
}
