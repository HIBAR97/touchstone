// A very small template engine (no dependencies) for the static site.
//
//   {{ a.b }}                  value, HTML-escaped. An unknown value is a build error, never a silent blank.
//   {{{ a.b }}}                value, raw HTML (already trusted markup, e.g. a rendered partial or SVG)
//   {{> name key=value ... }}  partial from src/_partials/name.html; arguments are visible inside it
//   {{@name key=value ... }}   helper function from lib/helpers.mjs (returns trusted HTML)
//   {{#if a}} ... {{else}} ... {{/if}}     truthy test; `!a` negates
//   {{#each list}} ... {{/each}}           each item's fields are visible directly; `loop.index` / `loop.first` / `loop.last`
//   {{!-- comment --}}         dropped from the output
//
// Arguments are `key="literal text"`, `key=true|false|123` or `key=some.path` (looked up in the current scope).

const TAG = /\{\{\{([\s\S]+?)\}\}\}|\{\{([\s\S]+?)\}\}/g;

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function parse(source, file = "<template>") {
  const root = { type: "root", children: [] };
  const stack = [{ node: root, list: root.children }];
  let last = 0;
  const fail = (message, index) => {
    throw new Error(`${file}:${lineOf(source, index)}: ${message}`);
  };
  const push = (node) => stack[stack.length - 1].list.push(node);

  for (const match of source.matchAll(TAG)) {
    if (match.index > last) push({ type: "text", value: source.slice(last, match.index) });
    last = match.index + match[0].length;
    const raw = match[1] !== undefined;
    const body = (raw ? match[1] : match[2]).trim();
    const at = match.index;

    if (body.startsWith("!")) continue; // {{!-- comment --}}
    if (body.startsWith(">")) {
      const { head, args } = splitArgs(body.slice(1).trim(), file, source, at);
      push({ type: "partial", name: head, args, at });
    } else if (body.startsWith("@")) {
      const { head, args } = splitArgs(body.slice(1).trim(), file, source, at);
      push({ type: "helper", name: head, args, at });
    } else if (body.startsWith("#if ")) {
      const node = { type: "if", expr: body.slice(4).trim(), then: [], otherwise: [], at };
      push(node);
      stack.push({ node, list: node.then });
    } else if (body === "else") {
      const top = stack[stack.length - 1];
      if (top.node.type !== "if") fail("{{else}} outside {{#if}}", at);
      top.list = top.node.otherwise;
    } else if (body === "/if") {
      if (stack.length < 2 || stack[stack.length - 1].node.type !== "if") fail("unexpected {{/if}}", at);
      stack.pop();
    } else if (body.startsWith("#each ")) {
      const node = { type: "each", expr: body.slice(6).trim(), children: [], at };
      push(node);
      stack.push({ node, list: node.children });
    } else if (body === "/each") {
      if (stack.length < 2 || stack[stack.length - 1].node.type !== "each") fail("unexpected {{/each}}", at);
      stack.pop();
    } else {
      push({ type: "var", expr: body, raw, at });
    }
  }
  if (last < source.length) push({ type: "text", value: source.slice(last) });
  if (stack.length !== 1) fail(`unclosed {{#${stack[stack.length - 1].node.type}}}`, stack[stack.length - 1].node.at);
  return root.children;
}

function splitArgs(text, file, source, at) {
  const match = /^([\w-]+)\s*([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}:${lineOf(source, at)}: bad tag "${text}"`);
  const args = {};
  const remaining = match[2].replace(/([\w-]+)=(?:"([^"]*)"|([^\s"]+))/g, (_, key, literal, expr) => {
    args[key] = literal !== undefined ? { literal } : { expr };
    return "";
  });
  if (remaining.trim()) throw new Error(`${file}:${lineOf(source, at)}: cannot parse arguments in "${text}"`);
  return { head: match[1], args };
}

function lookup(expr, scope) {
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  let value = scope;
  for (const key of expr.split(".")) {
    if (value === undefined || value === null) return undefined;
    value = value[key];
  }
  return value;
}

export function render(nodes, scope, env) {
  let out = "";
  const here = (node) => `${env.file}:${lineOf(env.source, node.at)}`;
  const evaluate = (expr, node) => {
    const negate = expr.startsWith("!");
    const value = lookup(negate ? expr.slice(1).trim() : expr, scope);
    return negate ? !value : value;
  };
  const resolveArgs = (args, node) => {
    const values = {};
    for (const [key, spec] of Object.entries(args)) {
      if ("literal" in spec) values[key] = spec.literal;
      else {
        const value = lookup(spec.expr, scope);
        if (value === undefined) throw new Error(`${here(node)}: unknown value "${spec.expr}"`);
        values[key] = value;
      }
    }
    return values;
  };

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "var": {
        const value = lookup(node.expr, scope);
        if (value === undefined || value === null) throw new Error(`${here(node)}: unknown value "${node.expr}"`);
        out += node.raw ? String(value) : escapeHtml(value);
        break;
      }
      case "if":
        out += render(evaluate(node.expr, node) ? node.then : node.otherwise, scope, env);
        break;
      case "each": {
        const list = lookup(node.expr, scope);
        if (!Array.isArray(list)) throw new Error(`${here(node)}: "${node.expr}" is not a list`);
        list.forEach((item, index) => {
          const inner = Object.assign(Object.create(scope), typeof item === "object" ? item : {}, {
            this: item,
            loop: { index, first: index === 0, last: index === list.length - 1 },
          });
          out += render(node.children, inner, env);
        });
        break;
      }
      case "partial": {
        const partial = env.partials[node.name];
        if (!partial) throw new Error(`${here(node)}: unknown partial "${node.name}"`);
        const inner = Object.assign(Object.create(scope), resolveArgs(node.args, node));
        out += render(partial.nodes, inner, { ...env, file: partial.file, source: partial.source });
        break;
      }
      case "helper": {
        const helper = env.helpers[node.name];
        if (!helper) throw new Error(`${here(node)}: unknown helper "${node.name}"`);
        try {
          out += helper(resolveArgs(node.args, node), scope);
        } catch (error) {
          throw new Error(`${here(node)}: helper "${node.name}": ${error.message}`);
        }
        break;
      }
    }
  }
  return out;
}

/** Parse and render one template string. `partials` maps name -> { nodes, file, source }. */
export function renderTemplate(source, scope, { file, partials, helpers }) {
  return render(parse(source, file), scope, { file, source, partials, helpers });
}

export function loadPartial(name, source, file) {
  return { nodes: parse(source, file), file, source };
}
