// Verifies a built site (dist/). Runs at the end of every build, and on its own:
//   node lib/check.mjs [dist] [--base https://example.org/site/] [--release]
// No dependencies: a small tolerant HTML tokenizer is enough because the templates only produce simple markup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER_PATTERN = /\[\[[A-Za-z]+\]\]/g;
const TEMPLATE_LEFTOVER = /\{\{|\}\}/;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style"]);

const TOKEN = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/gi;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function decode(value) {
  return value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Walks the markup, reporting nesting problems, and collects what the page-level checks need. */
export function parseHtml(source) {
  const errors = [];
  const info = { elements: [], ids: new Set(), title: "" };
  const stack = [];
  const lineAt = (index) => source.slice(0, index).split("\n").length;
  TOKEN.lastIndex = 0;
  let match;
  while ((match = TOKEN.exec(source))) {
    const [whole, closing, rawName, rawAttrs, selfClosing] = match;
    if (!rawName) continue; // comment or doctype
    const name = rawName.toLowerCase();
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) {
        errors.push(`line ${lineAt(match.index)}: </${name}> does not match ${open ? `<${open.name}> (line ${open.line})` : "any open tag"}`);
        if (open && stack.some((e) => e.name === name)) while (stack.length && stack.pop().name !== name);
      }
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(ATTR)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    const element = { name, attrs, line: lineAt(match.index), parents: stack.map((e) => e.name) };
    info.elements.push(element);
    if (attrs.id) {
      if (info.ids.has(attrs.id)) errors.push(`line ${element.line}: duplicate id "${attrs.id}"`);
      info.ids.add(attrs.id);
    }
    if (RAW_TEXT.has(name) && !selfClosing) {
      // <script> and <style> hold raw text: jump over their content and closing tag.
      const end = source.toLowerCase().indexOf(`</${name}`, TOKEN.lastIndex);
      if (end < 0) {
        errors.push(`line ${element.line}: <${name}> is never closed`);
        break;
      }
      element.text = source.slice(TOKEN.lastIndex, end);
      TOKEN.lastIndex = source.indexOf(">", end) + 1;
      continue;
    }
    if (name === "title") {
      const end = source.indexOf("</title>", TOKEN.lastIndex);
      if (end >= 0) info.title = source.slice(TOKEN.lastIndex, end).trim();
    }
    if (!VOID.has(name) && !selfClosing) stack.push({ name, line: element.line });
  }
  for (const open of stack) errors.push(`line ${open.line}: <${open.name}> is never closed`);
  return { errors, info };
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
  });
}

export function checkDist(dist, { base = "https://example.invalid/", basePath = "/", langs = ["ko", "en"], release = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(dist)) return { errors: [`${dist} does not exist`], warnings };
  const files = new Set(walk(dist));
  const pages = new Map(); // relative path -> parsed info
  const baseUrl = new URL(base);

  const pageUrl = (rel) => base + (rel === "index.html" ? "" : rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel);

  /** Maps a link found on page `from` to a file in dist (or null for links we do not check). */
  function resolveLink(href, from, where) {
    if (href === "" || /^(mailto:|tel:|data:)/i.test(href)) return null;
    if (/^javascript:/i.test(href)) {
      errors.push(`${where}: javascript: link`);
      return null;
    }
    let target;
    if (/^https?:\/\//i.test(href)) {
      const url = new URL(href);
      if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) return null; // external
      target = url.pathname.slice(baseUrl.pathname.length) + url.hash;
    } else if (href.startsWith("//")) {
      return null;
    } else if (href.startsWith("/")) {
      if (!href.startsWith(basePath)) {
        errors.push(`${where}: root-absolute link "${href}" is outside the site base path "${basePath}"`);
        return null;
      }
      target = href.slice(basePath.length);
    } else if (href.startsWith("#")) {
      target = `${from}${href}`;
    } else {
      const dir = path.posix.dirname(from);
      target = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, href));
      if (/^\.\.(\/|$)/.test(target)) {
        errors.push(`${where}: "${href}" climbs out of the site`);
        return null;
      }
      if (href.endsWith("/") && !target.endsWith("/")) target += "/";
    }
    const [pathPart, fragment] = target.split("#");
    const clean = pathPart.split("?")[0];
    let file = clean;
    if (clean === "" || clean.endsWith("/")) file = `${clean}index.html`;
    if (!files.has(file)) {
      if (files.has(`${clean}/index.html`)) errors.push(`${where}: "${href}" is a folder; add a trailing slash`);
      else errors.push(`${where}: "${href}" does not exist (${file})`);
      return null;
    }
    return { file, fragment };
  }

  // Pass 1: parse every HTML page.
  for (const rel of [...files].filter((f) => f.endsWith(".html"))) {
    const source = fs.readFileSync(path.join(dist, rel), "utf8");
    const { errors: markup, info } = parseHtml(source);
    for (const e of markup) errors.push(`${rel}: ${e}`);
    if (TEMPLATE_LEFTOVER.test(source)) errors.push(`${rel}: template markers ({{ or }}) left in the output`);
    pages.set(rel, info);
  }

  const metaContent = (info, key, attr = "name") => info.elements.find((e) => e.name === "meta" && e.attrs[attr] === key)?.attrs.content;
  const links = (info, rel) => info.elements.filter((e) => e.name === "link" && e.attrs.rel === rel);

  // Pass 2: per-page rules.
  for (const [rel, info] of pages) {
    const where = rel;
    const isLangPage = langs.includes(rel.split("/")[0]);
    const html = info.elements.find((e) => e.name === "html");
    if (!html?.attrs.lang) errors.push(`${where}: <html> has no lang`);
    else if (isLangPage && html.attrs.lang !== rel.split("/")[0]) errors.push(`${where}: <html lang="${html.attrs.lang}"> does not match its folder`);
    if (!info.title) errors.push(`${where}: empty <title>`);
    if (!metaContent(info, "description")) errors.push(`${where}: missing meta description`);
    if (!info.elements.some((e) => e.name === "meta" && e.attrs.name === "viewport")) errors.push(`${where}: missing viewport meta`);

    const canonical = links(info, "canonical")[0]?.attrs.href;
    if (!canonical) errors.push(`${where}: missing canonical link`);
    else if (canonical !== pageUrl(rel)) errors.push(`${where}: canonical "${canonical}" should be "${pageUrl(rel)}"`);

    for (const key of ["og:title", "og:description", "og:url", "og:image", "og:type", "og:site_name"]) {
      if (!metaContent(info, key, "property")) errors.push(`${where}: missing ${key}`);
    }
    if (metaContent(info, "og:url", "property") !== canonical) errors.push(`${where}: og:url differs from canonical`);
    const ogImage = metaContent(info, "og:image", "property");
    if (ogImage) resolveLink(ogImage, rel, `${where} og:image`);
    if (!metaContent(info, "twitter:card")) errors.push(`${where}: missing twitter:card`);

    // Alternates: both languages plus x-default, each pointing at a real page that points back.
    const alternates = Object.fromEntries(links(info, "alternate").filter((e) => e.attrs.hreflang).map((e) => [e.attrs.hreflang, e.attrs.href]));
    if (rel !== "404.html") {
      for (const lang of [...langs, "x-default"]) if (!alternates[lang]) errors.push(`${where}: missing hreflang="${lang}" alternate`);
    }
    const ownLang = isLangPage ? rel.split("/")[0] : null;
    for (const [lang, href] of Object.entries(alternates)) {
      const target = resolveLink(href, rel, `${where} hreflang=${lang}`);
      if (ownLang && target && lang !== "x-default" && pages.has(target.file)) {
        const back = links(pages.get(target.file), "alternate").find((e) => e.attrs.hreflang === ownLang);
        if (back?.attrs.href !== pageUrl(rel)) errors.push(`${where}: the ${lang} page does not list this page as its ${ownLang} alternate`);
      }
    }

    // Icons and stylesheet.
    for (const e of info.elements.filter((x) => x.name === "link" && x.attrs.href && x.attrs.rel !== "canonical" && x.attrs.rel !== "alternate")) {
      if (/^https?:\/\//i.test(e.attrs.href) && new URL(e.attrs.href).origin !== baseUrl.origin) errors.push(`${where}: external <link ${e.attrs.rel}> (${e.attrs.href}); everything must be local`);
      else resolveLink(e.attrs.href, rel, `${where} <link ${e.attrs.rel}>`);
    }
    if (!info.elements.some((e) => e.name === "link" && /icon/.test(e.attrs.rel ?? ""))) errors.push(`${where}: missing favicon link`);

    // Links, images, scripts.
    for (const e of info.elements) {
      const where2 = `${where}:${e.line}`;
      if (e.name === "a" && e.attrs.href !== undefined) {
        const target = resolveLink(e.attrs.href, rel, `${where2} <a>`);
        if (target?.fragment && pages.has(target.file) && !pages.get(target.file).ids.has(target.fragment)) {
          errors.push(`${where2} <a href="${e.attrs.href}">: no element with id "${target.fragment}" in ${target.file}`);
        }
      }
      if (e.name === "img") {
        if (e.attrs.alt === undefined) errors.push(`${where2} <img> without alt`);
        if (!e.attrs.src) errors.push(`${where2} <img> without src`);
        else if (/^https?:\/\//i.test(e.attrs.src) && new URL(e.attrs.src).origin !== baseUrl.origin) errors.push(`${where2} external image ${e.attrs.src}`);
        else resolveLink(e.attrs.src, rel, `${where2} <img>`);
      }
      if (e.name === "script") {
        // Only first-party files under assets/js/ may run (the holder page's model picker); never inline or external.
        if (e.attrs.src) {
          if (/^(?:[a-z]+:)?\/\//i.test(e.attrs.src) || !/(^|\/)assets\/js\/[\w.-]+\.js$/.test(e.attrs.src)) errors.push(`${where2} script ${e.attrs.src}: only first-party assets/js/*.js files are allowed`);
          else resolveLink(e.attrs.src, rel, `${where2} <script>`);
        } else if (isLangPage) errors.push(`${where2} inline script on a content page`);
      }
      if (["iframe", "object", "embed", "form"].includes(e.name)) errors.push(`${where2} <${e.name}> is not expected on this site`);
    }

    if (isLangPage) {
      const need = (cond, text) => cond || errors.push(`${where}: ${text}`);
      need(info.elements.some((e) => e.name === "header"), "no <header> landmark");
      need(info.elements.some((e) => e.name === "main" && e.attrs.id === "main"), "no <main id=\"main\">");
      need(info.elements.some((e) => e.name === "footer"), "no <footer> landmark");
      need(info.elements.filter((e) => e.name === "nav").length >= 1, "no <nav> landmark");
      need(info.elements.some((e) => e.name === "a" && e.attrs.href === "#main"), "no skip link to #main");
      need(info.elements.filter((e) => e.name === "h1").length === 1, "needs exactly one <h1>");
      for (const lang of langs.filter((l) => l !== ownLang)) {
        const switcher = info.elements.find((e) => e.name === "a" && e.attrs.hreflang === lang && e.parents.includes("header"));
        need(switcher, `language switcher to "${lang}" missing from the header`);
        if (switcher && alternates[lang]) {
          const a = resolveLink(switcher.attrs.href, rel, `${where} language switcher`);
          const b = resolveLink(alternates[lang], rel, `${where} alternate`);
          need(!a || !b || a.file === b.file, `language switcher "${lang}" and the hreflang alternate point at different pages`);
        }
      }
      const imgs = info.elements.filter((e) => e.name === "svg" && !("aria-hidden" in e.attrs) && !("role" in e.attrs));
      if (imgs.length) warnings.push(`${where}: ${imgs.length} <svg> without aria-hidden/role (screen readers may announce them)`);
    }
  }

  // Stylesheets: local only.
  for (const rel of [...files].filter((f) => f.endsWith(".css"))) {
    const css = fs.readFileSync(path.join(dist, rel), "utf8");
    if (/@import|https?:\/\//i.test(css)) errors.push(`${rel}: CSS must not import or reference external resources`);
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      if (!/^data:/.test(m[1])) resolveLink(m[1], rel, `${rel} url()`);
    }
  }

  // sitemap.xml: every entry exists.
  if (files.has("sitemap.xml")) {
    const sitemap = fs.readFileSync(path.join(dist, "sitemap.xml"), "utf8");
    for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>|<xhtml:link[^>]*href="([^"]+)"/g)) {
      const url = (m[1] ?? m[2]).replace(/&amp;/g, "&");
      if (!url.startsWith(base)) errors.push(`sitemap.xml: ${url} is outside ${base}`);
      else resolveLink(url, "sitemap.xml", "sitemap.xml");
    }
  }

  // Release builds must not carry the development placeholder host.
  if (release) {
    const stale = [...files].filter((rel) => /\.(html|xml|txt)$/.test(rel) && fs.readFileSync(path.join(dist, rel), "utf8").includes("example.invalid"));
    if (stale.length) errors.push(`${stale.length} file(s) still point at the development placeholder host (example.invalid): set "siteBaseURL"`);
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// Standalone: node lib/check.mjs [dist] [--base URL] [--release]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dist = path.resolve(args.find((a) => !a.startsWith("--") && a !== option("--base")) ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist"));
  const base = option("--base") ?? "https://example.invalid/";
  const { errors, warnings } = checkDist(dist, { base, basePath: new URL(base).pathname, release: args.includes("--release") });
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  console.log(errors.length ? `${errors.length} problem(s) found.` : "dist/ looks good: links, alternates, metadata and markup all check out.");
  process.exit(errors.length ? 1 : 0);
}
