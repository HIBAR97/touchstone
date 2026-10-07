# Touchstone website

Static site (Korean and English) for the Touchstone app: home, support, privacy policy, holder files.
Generated from the app project by `scripts/export-website.sh`; edit it there and re-export, or edit here directly.

1. Fill `website/site.config.json`: `supportEmail`, `effectiveDate` (YYYY-MM-DD) and `siteBaseURL` (the address this site
   will have, e.g. `https://<user>.github.io/<repo>/`). The store links can stay empty until the apps are published.
2. Preview: `node website/build.mjs --serve` (Node 20.6 or newer, nothing to install).
3. Push to `main`. In the repository settings choose Pages > Source: GitHub Actions. The workflow builds and publishes.

The privacy page is rendered from `docs/PRIVACY.md`; the holder page serves `hardware/stl/`.
