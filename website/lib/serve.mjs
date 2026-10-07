// Local preview server for dist/ (no dependencies). Behaves like GitHub Pages: folder URLs serve index.html,
// "/ko/support" redirects to "/ko/support/", and unknown paths get 404.html with a 404 status.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".stl": "model/stl",
  ".ico": "image/x-icon",
};

export function serve({ dir, port = 8080, watch = [], onChange = () => {} }) {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    let file = path.join(dir, path.normalize(pathname));
    if (!file.startsWith(dir)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!pathname.endsWith("/")) {
        res.writeHead(301, { Location: `${pathname}/` }).end();
        return;
      }
      file = path.join(file, "index.html");
    }
    let status = 200;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      status = 404;
      file = path.join(dir, "404.html");
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found (run the build first)");
      return;
    }
    const headers = { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
    // Byte ranges, like every real host: a <video> cannot seek without them.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    const size = fs.statSync(file).size;
    if (range && status === 200 && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(status, headers);
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`   preview: http://127.0.0.1:${port}/  (Ctrl+C to stop)`);
      let timer;
      for (const target of watch) {
        if (!fs.existsSync(target)) continue;
        fs.watch(target, { recursive: fs.statSync(target).isDirectory() }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            console.log("   change detected, rebuilding...");
            onChange();
          }, 150);
        });
      }
      if (watch.length) console.log("   watching src/, site.config.json and docs/PRIVACY.md");
      server.on("close", resolve);
    });
  });
}
