# branding — icon sources

- `favicon.png` (96×96) → `public/icons/favicon.png` as is (the tab icon, `index.html`).
- `icon.png` (460×460) → `public/icons/icon-512.png`, `icon-192.png` (the PWA manifest,
  `vite.config.ts`) and `apple-touch-icon.png` (180×180, the iOS web clip).

Regenerate after replacing a source (macOS `sips`):

```
cp branding/favicon.png public/icons/favicon.png
sips -z 512 512 branding/icon.png --out public/icons/icon-512.png
sips -z 192 192 branding/icon.png --out public/icons/icon-192.png
sips -z 180 180 branding/icon.png --out public/icons/apple-touch-icon.png
```

`public/icons/*.png` are the only hand-maintained files under `public/`
(everything else there is built by `scripts/`).
