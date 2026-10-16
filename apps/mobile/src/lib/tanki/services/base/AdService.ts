// Advertising: modal interstitials only, at the placements in
// CC_AD_PLACEMENTS. Which network answers is a runtime decision
// (`setProvider`); the default provider shows nothing, so the PWA ships
// ad-free until a provider is plugged in (AdMob through Capacitor).
import type { AdPlacement, AdProvider } from '../../../../model/Ads';
import { inject } from '../../core/di';
import TYPES from '../../core/types';
import type LoggerService from './LoggerService';

class NoopAdProvider implements AdProvider {
  readonly name = 'none';

  async showInterstitial(): Promise<void> {}

  preloadInterstitial(): void {}
}

export class AdService {
  private readonly loggerService = inject<LoggerService>(TYPES.loggerService);

  private provider: AdProvider = new NoopAdProvider();

  public setProvider = (provider: AdProvider): void => {
    this.loggerService.log('ad provider', provider.name);
    this.provider = provider;
  };

  public get providerName(): string {
    return this.provider.name;
  }

  public showInterstitial = async (placement: AdPlacement): Promise<void> => {
    try {
      await this.provider.showInterstitial(placement);
    } catch (error) {
      this.loggerService.warn('showInterstitial failed', placement, error);
    }
  };

  public preloadInterstitial = (placement: AdPlacement): void => {
    try {
      this.provider.preloadInterstitial(placement);
    } catch (error) {
      this.loggerService.warn('preloadInterstitial failed', placement, error);
    }
  };
}

export default AdService;
