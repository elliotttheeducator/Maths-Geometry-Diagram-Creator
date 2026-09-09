#!/usr/bin/env node
// Bundles the modular ES-module source (index.html + style.css + js/**) into a single
// self-contained HTML file with no external references, suitable for publishing as a
// Claude Artifact (which requires one file, no relative script/style src). The GitHub
// Pages build stays modular -- this is purely a packaging step, run whenever the
// source changes and the artifact needs to be republished.
//
// Usage: node build/bundle.mjs [output-path]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const outPath = process.argv[2] || join(ROOT, "dist", "artifact.html");

// Dependency order matters: each file's imports must already have been concatenated.
const JS_FILES = [
  "js/geometry.js",
  "js/palette.js",
  "js/svgUtil.js",
  "js/fieldInput.js",
  "js/sidebar.js",
  "js/export.js",
  "js/shapes/triangle.js",
  "js/shapes/parallelLines.js",
  "js/shapes/lineGraph.js",
  "js/shapes/circle.js",
  "js/shapes/quadrilateral.js",
  "js/shapes/prism.js",
  "js/shapes/polygon.js",
  "js/app.js",
];

// Each source file was its own module scope, so e.g. two files can each privately
// declare `const DEG = ...` with no conflict. Concatenated into one shared scope
// that collides -- so every file except the entry point (app.js, which nothing else
// imports from) gets wrapped in its own IIFE that only leaks its actual `export`ed
// names into the shared top-level scope, exactly mirroring real module isolation.
const EXPORT_NAME_RE = /^export\s+(?:async\s+function|function|class|const)\s+([A-Za-z_$][\w$]*)/gm;

function stripModuleSyntax(src, relPath) {
  // Multi-line or single-line `import {...} from "...";`
  let out = src.replace(/^import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, "");
  // `export function`, `export async function`, `export class`, `export const`
  out = out.replace(/^export\s+(?=(async\s+)?function|class|const)/gm, "");
  if (/^\s*import\s/m.test(out) || /^\s*export\s/m.test(out)) {
    throw new Error(`${relPath}: leftover import/export syntax after stripping -- update the bundler's patterns`);
  }
  return out.trim();
}

function exportedNames(src) {
  return [...src.matchAll(EXPORT_NAME_RE)].map((m) => m[1]);
}

function readText(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}

const html = readText("index.html");
const css = readText("style.css");

const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error("index.html: could not find <body>...</body>");
let body = bodyMatch[1];
// Drop the modular script tag -- replaced with the inlined bundle below.
body = body.replace(/\s*<script type="module" src="js\/app\.js"><\/script>\s*/, "\n");

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
const title = titleMatch ? titleMatch[1] : "Geometry Diagram Creator";

const jsBundle = JS_FILES.map((relPath) => {
  const src = readText(relPath);
  const names = exportedNames(src);
  const stripped = stripModuleSyntax(src, relPath);
  if (names.length === 0) {
    // The entry point: nothing imports from it, so no isolation needed -- it just
    // needs to see every other file's exports already sitting in the shared scope.
    return `// --- ${relPath} ---\n${stripped}`;
  }
  const nameList = names.join(", ");
  return `// --- ${relPath} ---\nconst { ${nameList} } = (function () {\n${stripped}\nreturn { ${nameList} };\n})();`;
}).join("\n\n");

const out = `<meta charset="utf-8">
<title>${title}</title>
<style>
${css}
</style>
${body.trim()}
<script>
(function () {
"use strict";
${jsBundle}
})();
</script>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out, "utf8");
console.log(`Wrote ${out.length.toLocaleString()} bytes to ${outPath}`);
