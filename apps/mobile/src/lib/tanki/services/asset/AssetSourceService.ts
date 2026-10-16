// Runtime view of the asset routing installed in config/assets.ts: where the
// assets come from and URL helpers for the UI.
import { CC_REMOTE_ASSET_BASE } from '../../../../config/params';
import { resolveAssetUrl } from '../../../../config/assets';

export class AssetSourceService {
  /** /assets/ on the app's own origin. */
  public get remoteBase(): string {
    return CC_REMOTE_ASSET_BASE;
  }

  /** Site-absolute asset path ("/embedded/ui/x.png") -> URL. */
  public url = (path: string): string => resolveAssetUrl(path);

  /** The brand logo shipped with the app shell (apps/mobile/public/logo.png). */
  public get logoUrl(): string {
    return '/logo.png';
  }
}

export default AssetSourceService;
