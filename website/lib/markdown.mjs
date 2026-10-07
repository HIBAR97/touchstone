// Just enough Markdown for docs/PRIVACY.md: ### headings, paragraphs, "- " lists with indented continuations,
// pipe tables, **bold**, `code` and [links](url). No dependencies; everything is HTML-escaped first.
import { escapeHtml } from "./template.mjs";

/** Splits PRIVACY.md into its Korean and English parts (the "## 한국어" and "## English" sections). */
export function splitBilingual(markdown, headings = { ko: "## 한국어", en: "## English" }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = {};
  for (const [lang, heading] of Object.entries(headings)) {
    const index = lines.findIndex((line) => line.trim() === heading);
    if (index < 0) throw new Error(`docs/PRIVACY.md has no "${heading}" section`);
    start[lang] = index;
  }
  const order = Object.entries(start).sort((a, b) => a[1] - b[1]);
  const parts = {};
  order.forEach(([lang, index], i) => {
    const end = i + 1 < order.length ? order[i + 1][1] : lines.length;
    let body = lines.slice(index + 1, end);
    while (body.length && (body[body.length - 1].trim() === "" || body[body.length - 1].trim() === "---")) body.pop();
    parts[lang] = body.join("\n");
  });
  return parts;
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

/** `headingOffset` 1 turns "### x" into <h2>. */
export function renderMarkdown(markdown, { headingOffset = 1 } = {}) {
  const lines = markdown.split("\n");
  const html = [];
  let i = 0;
  let section = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
    } else if (/^#{1,6}\s/.test(line)) {
      const level = Math.min(6, Math.max(2, line.match(/^#+/)[0].length - headingOffset));
      section++;
      html.push(`<h${level} id="section-${section}">${inline(line.replace(/^#+\s*/, ""))}</h${level}>`);
      i++;
    } else if (line.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      const [head, separator, ...body] = rows;
      if (!separator || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) throw new Error("PRIVACY.md: table without a header separator row");
      html.push(
        '<div class="table-wrap"><table><thead><tr>' +
          head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("") +
          "</tr></thead><tbody>" +
          body
            .map(
              (row) =>
                "<tr>" + row.map((cell, n) => `<td data-label="${escapeHtml(head[n] ?? "")}">${inline(cell)}</td>`).join("") + "</tr>",
            )
            .join("") +
          "</tbody></table></div>",
      );
    } else if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && lines[i].trim() !== "" && (/^[-*]\s+/.test(lines[i]) || /^\s+\S/.test(lines[i]))) {
        if (/^[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^[-*]\s+/, "").trim());
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      html.push("<ul>" + items.map((item) => `<li>${inline(item)}</li>`).join("") + "</ul>");
    } else {
      const paragraph = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|[-*]\s|\|)/.test(lines[i])) paragraph.push(lines[i++].trim());
      html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    }
  }
  return html.join("\n");
}
