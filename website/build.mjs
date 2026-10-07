#!/usr/bin/env node
// Static site build for the Touchstone website. Plain Node (>= 20.6), no dependencies.
//
//   node build.mjs                 render src/ into dist/ (placeholders allowed, shown in the page)
//   node build.mjs --release       same, but FAIL if an owner-provided value is still missing
//   node build.mjs --release --strict   also fail while a store/download link is missing ("coming soon" buttons)
//   node build.mjs --serve [--port 8080] [--watch]   build, then preview dist/ locally
//
// Layout:  src/<lang>/**.html   pages (front matter + template), one file per language and page
//          src/index.html, src/404.html     root redirect page and the not-found page
//          src/_layouts, src/_partials, src/_i18n, src/_data     templates and shared strings (never copied)
//          everything else under src/        copied as-is (assets, favicon.ico)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderTemplate, loadPartial, escapeHtml } from "./lib/template.mjs";
import { renderMarkdown, splitBilingual } from "./lib/markdown.mjs";
import { helpers } from "./lib/helpers.mjs";
import { checkDist, PLACEHOLDER_PATTERN } from "./lib/check.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const CONFIG_FILE = path.join(ROOT, "site.config.json");
const PRIVACY_FILE = path.resolve(ROOT, "..", "docs", "PRIVACY.md");

export const LANGS = ["ko", "en"];
export const DEFAULT_LANG = "ko";

// Values only the owner can provide (website/site.config.json). `required` ones must be set for a release build.
const CONFIG_KEYS = {
  supportEmail: { required: true, kind: "email" },
  effectiveDate: { required: true, kind: "date" },
  siteBaseURL: { required: true, kind: "url" },
  appStoreURL: { required: false, kind: "url" },
  macDownloadURL: { required: false, kind: "url" },
  chromeStoreURL: { required: false, kind: "url" },
};
const DEV_BASE_URL = "https://example.invalid/";

class BuildError extends Error {}

const isMissing = (value) => typeof value !== "string" || value.trim() === "" || /^(todo|tbd|changeme|<.*>)/i.test(value.trim());

function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (error) {
    throw new BuildError(`Cannot read website/site.config.json: ${error.message}`);
  }
  const errors = [];
  for (const key of Object.keys(raw)) if (!(key in CONFIG_KEYS)) errors.push(`site.config.json: unknown key "${key}"`);
  const config = {};
  const missing = [];
  for (const [key, spec] of Object.entries(CONFIG_KEYS)) {
    const value = raw[key];
    if (isMissing(value)) {
      config[key] = "";
      missing.push({ key, required: spec.required });
      continue;
    }
    const text = value.trim();
    if (spec.kind === "email" && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(text)) errors.push(`${key}: "${text}" is not an email address`);
    if (spec.kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)))) errors.push(`${key}: "${text}" must be a date like 2026-10-05`);
    if (spec.kind === "url") {
      try {
        const url = new URL(text);
        if (url.protocol !== "https:") errors.push(`${key}: "${text}" must be an https:// URL`);
      } catch {
        errors.push(`${key}: "${text}" is not a URL`);
      }
    }
    config[key] = text;
  }
  if (errors.length) throw new BuildError(errors.join("\n"));
  const base = new URL(config.siteBaseURL || DEV_BASE_URL);
  base.hash = "";
  base.search = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  config.siteBaseURL = config.siteBaseURL ? base.href : "";
  return { config, missing, base: base.href, basePath: base.pathname };
}

function readDirRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDirRecursive(full));
    else out.push(full);
  }
  return out;
}

function parseFrontMatter(source, file) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) throw new BuildError(`${file}: missing front matter (--- title: ... ---)`);
  const data = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) throw new BuildError(`${file}: bad front matter line "${line}"`);
    data[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { data, body: source.slice(match[0].length) };
}

const rel = (file) => path.relative(ROOT, file);

export function build({ release = false, strict = false, quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const dist = path.join(ROOT, "dist");
  const { config, missing, base, basePath } = loadConfig();
  const warnings = [];

  // --- shared pieces -------------------------------------------------------------------------------------------
  const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
  const i18n = Object.fromEntries(LANGS.map((lang) => [lang, readJson(path.join(SRC, "_i18n", `${lang}.json`))]));
  const flatKeys = (value, prefix = "") =>
    Object.entries(value).flatMap(([key, v]) => (v && typeof v === "object" ? flatKeys(v, `${prefix}${key}.`) : [`${prefix}${key}`]));
  const reference = new Set(flatKeys(i18n[DEFAULT_LANG]));
  for (const lang of LANGS) {
    const keys = new Set(flatKeys(i18n[lang]));
    for (const key of reference) if (!keys.has(key)) throw new BuildError(`src/_i18n/${lang}.json lacks "${key}"`);
    for (const key of keys) if (!reference.has(key)) throw new BuildError(`src/_i18n/${lang}.json has extra "${key}"`);
  }
  const navItems = readJson(path.join(SRC, "_data", "nav.json"));

  const partials = {};
  const partialDir = path.join(SRC, "_partials");
  for (const file of fs.readdirSync(partialDir)) {
    if (!file.endsWith(".html")) continue;
    const full = path.join(partialDir, file);
    partials[file.replace(/\.html$/, "")] = loadPartial(file, fs.readFileSync(full, "utf8"), rel(full));
  }
  const layouts = {};
  for (const file of fs.readdirSync(path.join(SRC, "_layouts"))) {
    const full = path.join(SRC, "_layouts", file);
    layouts[file.replace(/\.html$/, "")] = { source: fs.readFileSync(full, "utf8"), file: rel(full) };
  }

  // The privacy policy is rendered from docs/PRIVACY.md (never copied by hand): ko page = Korean part, en page = English part.
  let privacy = {};
  if (fs.existsSync(PRIVACY_FILE)) {
    const parts = splitBilingual(fs.readFileSync(PRIVACY_FILE, "utf8"));
    privacy = Object.fromEntries(LANGS.map((lang) => [lang, renderMarkdown(parts[lang])]));
  } else {
    throw new BuildError(`Cannot find ${path.relative(ROOT, PRIVACY_FILE)}: the privacy page is rendered from docs/PRIVACY.md`);
  }

  // --- collect pages ---------------------------------------------------------------------------------------------
  const pages = []; // { lang, slug, file, outPath (relative to dist), urlPath }
  for (const lang of LANGS) {
    const dir = path.join(SRC, lang);
    if (!fs.existsSync(dir)) throw new BuildError(`src/${lang}/ is missing`);
    for (const file of readDirRecursive(dir)) {
      if (!file.endsWith(".html")) continue;
      const slug = path.relative(dir, file).replace(/\.html$/, "").split(path.sep).join("/").replace(/(^|\/)index$/, "");
      const urlPath = slug ? `${lang}/${slug}/` : `${lang}/`;
      pages.push({ lang, slug, file, urlPath, outPath: `${urlPath}index.html` });
    }
  }
  const slugs = [...new Set(pages.map((p) => p.slug))];
  for (const slug of slugs) {
    for (const lang of LANGS) {
      if (!pages.some((p) => p.lang === lang && p.slug === slug)) {
        throw new BuildError(`Page "${slug || "index"}" exists in another language but not in src/${lang}/ (every page needs both languages)`);
      }
    }
  }
  // A nav item shows up as soon as its page exists in every language (the trackpad-holder page is added this way).
  const nav = navItems.filter((item) => slugs.includes(item.slug));
  for (const item of nav) if (!(item.key in i18n[DEFAULT_LANG].nav)) throw new BuildError(`nav item "${item.key}" has no label in src/_i18n/*.json`);
  const hidden = navItems.filter((item) => !slugs.includes(item.slug)).map((item) => item.slug);
  if (hidden.length) log(`   nav: hidden until their pages exist: ${hidden.join(", ")}`);

  const urlOf = (urlPath) => base + urlPath;
  const pageOf = (lang, slug) => pages.find((p) => p.lang === lang && p.slug === slug);
  const alternatesOf = (slug) => [
    ...LANGS.map((lang) => ({ hreflang: lang, href: urlOf(pageOf(lang, slug).urlPath) })),
    { hreflang: "x-default", href: base },
  ];
  const languageLinks = (slug, rootPrefix, currentLang) =>
    LANGS.map((code) => ({ code, name: i18n[code].langName, hreflang: code, href: rootPrefix + pageOf(code, slug).urlPath, current: code === currentLang }));

  const env = { partials, helpers };
  const written = [];
  const writeOut = (relPath, content) => {
    const target = path.join(dist, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written.push(relPath);
  };

  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // One page: front matter + body -> body rendered with the page scope -> wrapped in its layout.
  function renderPage({ file, lang, slug, urlPath, outPath, rootPrefix, alternates, langs, ogLang }) {
    const { data, body } = parseFrontMatter(fs.readFileSync(file, "utf8"), rel(file));
    for (const key of ["title", "description"]) if (!data[key]) throw new BuildError(`${rel(file)}: front matter needs "${key}"`);
    const t = i18n[lang ?? DEFAULT_LANG];
    const page = {
      title: data.title,
      description: data.description,
      slug,
      url: urlOf(urlPath),
      ogImage: `${base}assets/img/og-${ogLang}.png`,
      ogImageAlt: i18n[ogLang].iconAlt,
      noindex: data.robots === "noindex",
    };
    const scope = {
      config,
      t,
      lang: lang ?? DEFAULT_LANG,
      root: rootPrefix,
      homeHref: lang ? `${rootPrefix}${lang}/` : rootPrefix,
      page,
      alternates,
      langs,
      nav: lang
        ? nav.map((item) => ({
            label: t.nav[item.key],
            href: `${rootPrefix}${lang}/${item.slug ? `${item.slug}/` : ""}`,
            current: item.slug === slug,
          }))
        : [],
      privacy: { html: privacy[lang ?? DEFAULT_LANG] },
      site: { name: "Touchstone", base, basePath },
    };
    const content = renderTemplate(body, scope, { ...env, file: rel(file) });
    const layout = layouts[data.layout ?? "page"];
    if (!layout) throw new BuildError(`${rel(file)}: unknown layout "${data.layout}"`);
    const html = renderTemplate(layout.source, { ...scope, content }, { ...env, file: layout.file });
    writeOut(outPath, html.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n"));
  }

  for (const p of pages) {
    const rootPrefix = "../".repeat(p.urlPath.split("/").filter(Boolean).length);
    renderPage({
      ...p,
      rootPrefix,
      alternates: alternatesOf(p.slug),
      langs: languageLinks(p.slug, rootPrefix, p.lang),
      ogLang: p.lang,
    });
  }

  // Root redirect page and the 404 page (404 is served at any depth, so it uses root-absolute paths).
  renderPage({
    file: path.join(SRC, "index.html"), lang: null, slug: "", urlPath: "", outPath: "index.html",
    rootPrefix: "", alternates: alternatesOf(""), langs: languageLinks("", "", null), ogLang: "en",
  });
  renderPage({
    file: path.join(SRC, "404.html"), lang: null, slug: "404", urlPath: "404.html", outPath: "404.html",
    rootPrefix: basePath, alternates: alternatesOf(""), langs: languageLinks("", basePath, null), ogLang: "en",
  });

  // Everything else in src/ that is not a template is copied as it is.
  for (const file of readDirRecursive(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join("/");
    if (relative.split("/").some((part) => part.startsWith("_") || part.startsWith("."))) continue;
    if (relative.endsWith(".html")) continue;
    fs.mkdirSync(path.dirname(path.join(dist, relative)), { recursive: true });
    fs.copyFileSync(file, path.join(dist, relative));
    written.push(relative);
  }

  // The 3D-printable holder files are generated next to their code in ../hardware/stl and served under /holder/stl/.
  const holderStl = path.resolve(ROOT, "..", "hardware", "stl");
  if (fs.existsSync(holderStl)) {
    for (const file of readDirRecursive(holderStl)) {
      const relative = "holder/stl/" + path.relative(holderStl, file).split(path.sep).join("/");
      fs.mkdirSync(path.dirname(path.join(dist, relative)), { recursive: true });
      fs.copyFileSync(file, path.join(dist, relative));
      written.push(relative);
    }
  }

  // Search engine and host files.
  const sitemapEntries = pages
    .map((p) => {
      const links = LANGS.map((code) => {
        return `    <xhtml:link rel="alternate" hreflang="${code}" href="${escapeHtml(urlOf(pageOf(code, p.slug).urlPath))}"/>`;
      }).join("\n");
      return `  <url>\n    <loc>${escapeHtml(urlOf(p.urlPath))}</loc>\n${links}\n  </url>`;
    })
    .join("\n");
  writeOut(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sitemapEntries}\n</urlset>\n`,
  );
  writeOut("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`);
  writeOut(".nojekyll", "");

  // --- verification ----------------------------------------------------------------------------------------------
  const problems = [];
  const required = missing.filter((m) => m.required).map((m) => m.key);
  const optional = missing.filter((m) => !m.required).map((m) => m.key);
  if (release) {
    for (const key of required) problems.push(`site.config.json: "${key}" is still empty (owner value needed)`);
    if (strict) for (const key of optional) problems.push(`site.config.json: "${key}" is still empty (strict: store/download links must exist)`);
  } else {
    for (const m of missing) warnings.push(`site.config.json: "${m.key}" is empty (${m.required ? "pages show a placeholder" : "its button shows \"coming soon\""})`);
  }
  if (release && !strict && optional.length) {
    warnings.push(`"coming soon" buttons remain for: ${optional.join(", ")} (add --strict to fail on these too)`);
  }

  const checked = checkDist(dist, { base, basePath, langs: LANGS, release });
  problems.push(...checked.errors);
  warnings.push(...checked.warnings);

  const placeholders = new Map(); // "[[name]]" -> files that still show it
  for (const relPath of written.filter((f) => /\.(html|xml|txt|css)$/.test(f))) {
    const text = fs.readFileSync(path.join(dist, relPath), "utf8");
    for (const m of text.matchAll(PLACEHOLDER_PATTERN)) placeholders.set(m[0], [...new Set([...(placeholders.get(m[0]) ?? []), relPath])]);
  }
  for (const [token, where] of placeholders) {
    const message = `placeholder ${token} is still shown in ${where.length} file(s), e.g. ${where[0]}`;
    if (release) problems.push(message);
    else warnings.push(message);
  }

  log(`   built ${pages.length + 2} pages (${LANGS.join(", ")}) into ${path.relative(process.cwd(), dist) || "dist"}/`);
  for (const w of warnings) log(`   warning: ${w}`);
  if (problems.length) {
    const message = problems.map((p) => `   error: ${p}`).join("\n");
    if (release) fs.rmSync(dist, { recursive: true, force: true }); // never leave a failed release build around to be deployed
    throw new BuildError(`${release ? "Release build" : "Build"} failed:\n${message}`);
  }
  log(release ? "   release build OK: no placeholders left." : "   build OK (development: placeholders allowed; use --release before deploying).");
  return { dist, base, pages, warnings };
}

// --- CLI -------------------------------------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
  };
  const known = ["--release", "--strict", "--serve", "--watch", "--port"];
  for (const a of args) if (a.startsWith("--") && !known.includes(a)) throw new BuildError(`Unknown option ${a}`);
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 6)) throw new BuildError(`Node 20.6 or newer is required (found ${process.version}).`);

  const options = { release: flag("--release"), strict: flag("--strict") };
  if (options.strict && !options.release) throw new BuildError("--strict only makes sense together with --release");
  if (flag("--serve") || flag("--watch")) {
    if (options.release) throw new BuildError("--release cannot be combined with --serve");
    const { serve } = await import("./lib/serve.mjs");
    const attempt = () => {
      try {
        build();
      } catch (error) {
        if (!(error instanceof BuildError)) throw error;
        console.error(error.message);
      }
    };
    attempt();
    await serve({
      dir: path.join(ROOT, "dist"),
      port: Number(option("--port", 8080)),
      watch: flag("--watch") ? [SRC, CONFIG_FILE, PRIVACY_FILE] : [],
      onChange: attempt,
    });
    return;
  }
  build(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof BuildError ? error.message : error);
    process.exit(1);
  });
}
