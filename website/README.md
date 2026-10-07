# Touchstone website

The public site for Touchstone (시금석): home (with the how-to video), support, privacy and trackpad-holder pages in Korean (`/ko/`, default) and
English (`/en/`), plus `404.html`. It exists for the App Store listing (Support URL, Privacy Policy URL) and is a plain
static site: no external fonts, analytics or CDNs, everything is served from `dist/`. The only script is the first-party model picker
(`src/assets/js/holder.js`) on the holder page; the checker rejects inline and external scripts.

Plain Node (>= 20.6), no dependencies, nothing to `npm install`.

```bash
cd website
node build.mjs                    # src/ -> dist/ (placeholders allowed; you see them on the pages)
node build.mjs --release          # same, but FAILS while an owner value below is missing
node build.mjs --release --strict # also fails while a store/download link is missing
node build.mjs --serve --watch    # preview at http://127.0.0.1:8080/, rebuilds when you edit src/
node lib/check.mjs                # re-check an existing dist/ (the build already runs this)
```
`npm run build`, `npm run build:release`, `npm run preview` and `npm run check` do the same.

## Owner values: `site.config.json`

The only file you have to edit. An empty string means "not provided yet".

| Key | Needed for release | Used for |
|---|---|---|
| `supportEmail` | yes | `mailto:` links on the support page and footer, privacy page contact |
| `effectiveDate` | yes | privacy policy effective date, written `YYYY-MM-DD` (shown as "2026년 10월 5일" / "October 5, 2026") |
| `siteBaseURL` | yes | where the site will live, `https://...`: canonical, hreflang, Open Graph and sitemap URLs |
| `appStoreURL` | no | "App Store에서 받기" buttons |
| `macDownloadURL` | no | "Mac 앱 받기" buttons |
| `chromeStoreURL` | no | "Chrome 웹 스토어에서 받기" button |

- A missing store/download URL renders a **disabled button with a "곧 공개돼요 / Coming soon" label**, never a dead link.
- `--release` fails (and deletes `dist/`, so a failed build cannot be deployed by accident) if a required value is empty,
  if any `[[placeholder]]`, `{{` or the development host `example.invalid` is left in the output, or if a link is broken.
  The three store links are optional so the site can go live before the apps do; pass `--strict` once they exist.
- Values are validated even in development (email shape, https URLs, a real date).

## Deploy

`dist/` is the whole site. The links between pages are relative, so it works at a domain root or under a sub-path.

**GitHub Pages** (project site, `https://<user>.github.io/<repo>/`): set `siteBaseURL` to that address, then either
use a workflow like the one below (Settings > Pages > Source: GitHub Actions), or commit `dist/` after removing the
`dist/` line from `website/.gitignore`.

```yaml
# .github/workflows/website.yml
name: website
on: { push: { branches: [main], paths: ["website/**", "docs/PRIVACY.md"] }, workflow_dispatch: {} }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node website/build.mjs --release
      - uses: actions/upload-pages-artifact@v3
        with: { path: website/dist }
      - id: deployment
        uses: actions/deploy-pages@v4
```

**Any static host** (Cloudflare Pages, Netlify, S3, nginx...): run `node build.mjs --release` and upload `dist/`.
Use `404.html` as the not-found page. For a custom domain put a `CNAME` file in `src/` (files there that are not
templates are copied as they are) and set `siteBaseURL` to the domain.

App Store Connect values (replace the base with yours): Support URL `<base>ko/support/` (Korean) and
`<base>en/support/` (English); Privacy Policy URL `<base>ko/privacy/` and `<base>en/privacy/`.

## Layout

```
website/
  site.config.json        owner values (see above)
  build.mjs               the build; lib/ holds the template engine, Markdown, SVG helpers, checker, preview server
  src/
    index.html            language redirect (navigator.language, <noscript> links); 404.html
    ko/  en/              one file per page and language: index, support, privacy, holder
    _layouts/ _partials/  page shell, <head> (SEO, Open Graph, hreflang), header, footer
    _i18n/ko.json en.json shared UI strings (both files must have the same keys)
    _data/nav.json        navigation (see "Add a page")
    assets/               css/site.css, img/ (app icon, Open Graph images), favicons; favicon.ico at src/
  tools/make-assets.py    regenerates the icons and Open Graph images from ../branding/png
  dist/                   build output (git-ignored)
```

The privacy pages are **rendered from `docs/PRIVACY.md`** (Korean part for `/ko/privacy/`, English part for
`/en/privacy/`); the date and contact come from the config. Edit the policy there, not in `website/`, then rebuild.

Pages are templates: front matter (`title`, `description`) followed by HTML. `{{value}}` is escaped, `{{{value}}}` is raw,
`{{> partial arg=value}}` includes `_partials/`, `{{@helper arg=value}}` calls `lib/helpers.mjs` (buttons, mailto link,
date, SVG pictures), `{{#if x}}...{{else}}...{{/if}}` and `{{#each list}}...{{/each}}`. An unknown value is a build error.
Content pages are Korean 해요체 and English with the same sections; a page that exists in only one language fails the build.

## Add a page (e.g. the 3D-printable trackpad holder)

1. Create `src/ko/holder.html` and `src/en/holder.html` (copy `support.html` for the front matter and `page-head`).
2. That is all: `_data/nav.json` already has a `holder` slot with labels in `_i18n/*.json` ("트랙패드 거치대" /
   "Trackpad holder"). The menu entry stays hidden until both files exist, then appears in the header and footer, and the
   sitemap, hreflang alternates and language switcher include the page automatically. For another slug, add it to
   `nav.json` and a label under `nav` in both `_i18n` files.

## What the build verifies

Every build ends with `lib/check.mjs` and fails on: unbalanced markup; leftover `{{`; internal links, anchors, images,
stylesheets or sitemap entries that do not resolve; a page without `<title>`, description, canonical, Open Graph tags or
favicon; a missing `ko`/`en`/`x-default` alternate (or one that does not link back); a missing language switcher,
skip link, landmark or single `<h1>`; any external resource, script or form on content pages.

## Owner TODO

- [ ] Fill `supportEmail`, `effectiveDate`, `siteBaseURL` in `site.config.json` (and decide where to host).
- [ ] Fill `appStoreURL`, `macDownloadURL` and `chromeStoreURL` as soon as they exist (the review notes need the Mac
      download link, see `docs/RELEASE_CHECKLIST.md`), rebuild with `--release --strict`, redeploy.
- [ ] Have the privacy policy (`docs/PRIVACY.md`) and the footer trademark line reviewed; set the effective date to the
      day the policy goes live.
- [ ] Read the Safari and macOS/iOS settings paths on the pages against a notarized build on a clean Mac and iPhone.
- [ ] Add the trackpad holder page (see above) when it is ready.
