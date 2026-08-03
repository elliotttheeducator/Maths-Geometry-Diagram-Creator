const EXPORT_SCALE = 2; // render at 2x for crisp pasting into a Word doc / slide

// The live page's shape styling lives in style.css, which is NOT included when an
// SVG subtree is serialized standalone -- without this, browsers fall back to SVG's
// default fill (solid black) for every polygon/path, which visibly breaks the export.
// This mirrors the relevant rules from style.css so exported files render identically.
const EXPORT_STYLE = `
text { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
.shape-poly { fill: rgba(37, 99, 235, 0.06); stroke: #1f2430; stroke-width: 2; }
.shape-line { stroke: #1f2430; stroke-width: 2; fill: none; }
.vertex-label { font-size: 15px; font-weight: 600; fill: #1f2430; }
.side-label, .angle-label { font-size: 13px; fill: #374151; }
.angle-arc { fill: none; stroke: #d97706; stroke-width: 1.5; }
.right-angle-mark { fill: none; stroke: #d97706; stroke-width: 1.5; }
.parallel-chevron { stroke: #1f2430; stroke-width: 1.5; fill: none; }
.equal-length-tick { stroke: #1f2430; stroke-width: 1.5; }
`;

const CROP_PADDING = 24;
const INTERACTIVE_ONLY_SELECTOR =
  ".vertex-handle, .drag-handle, .rotate-handle, .rotate-handle-line, .label-remove, .label-plus, .segment-delete-group, .new-vertex-handle";

// Measure the actual drawn content (not the fixed 1000x700 workspace) so the export
// isn't full of blank canvas. Must run on an SVG still attached to the document --
// getBBox() on a fully detached node throws/returns garbage in most browsers -- so
// this temporarily mounts an offscreen copy purely to read geometry, then discards it.
function measureContentBBox(svgEl) {
  const probe = svgEl.cloneNode(true);
  probe.style.position = "fixed";
  probe.style.left = "-99999px";
  probe.style.top = "0";
  document.body.appendChild(probe);
  const layer = probe.querySelector("#shapes-layer");
  let box = null;
  if (layer && layer.childNodes.length) {
    const b = layer.getBBox();
    if (b.width > 0 && b.height > 0) box = b;
  }
  document.body.removeChild(probe);
  return box;
}

function prepareCleanSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.querySelectorAll(INTERACTIVE_ONLY_SELECTOR).forEach((n) => n.remove());
  clone.querySelectorAll(".selected").forEach((n) => n.classList.remove("selected"));
  const gridBg = clone.querySelector("#grid-bg");
  if (gridBg) gridBg.remove();

  const box = measureContentBBox(clone);
  const [origX, origY, origW, origH] = clone.getAttribute("viewBox").split(" ").map(Number);
  const vbX = box ? box.x - CROP_PADDING : origX;
  const vbY = box ? box.y - CROP_PADDING : origY;
  const vbW = box ? box.width + CROP_PADDING * 2 : origW;
  const vbH = box ? box.height + CROP_PADDING * 2 : origH;

  clone.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  clone.setAttribute("width", vbW);
  clone.setAttribute("height", vbH);

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = EXPORT_STYLE;
  clone.insertBefore(style, clone.firstChild);

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", vbX);
  bg.setAttribute("y", vbY);
  bg.setAttribute("width", vbW);
  bg.setAttribute("height", vbH);
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

function serialize(svgEl) {
  return new XMLSerializer().serializeToString(svgEl);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportSvg(svgEl) {
  const clean = prepareCleanSvg(svgEl);
  const str = serialize(clean);
  const blob = new Blob([str], { type: "image/svg+xml" });
  downloadBlob(blob, "diagram.svg");
}

export function exportPng(svgEl) {
  const clean = prepareCleanSvg(svgEl);
  const [, , vbWidth, vbHeight] = clean.getAttribute("viewBox").split(" ").map(Number);
  const str = serialize(clean);
  const svgBlob = new Blob([str], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = vbWidth * EXPORT_SCALE;
    canvas.height = vbHeight * EXPORT_SCALE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => downloadBlob(blob, "diagram.png"), "image/png");
  };
  img.src = url;
}
