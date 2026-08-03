export const SVGNS = "http://www.w3.org/2000/svg";

export function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

export function text(str, attrs = {}) {
  const node = el("text", attrs);
  node.textContent = str;
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Shared rendering for any angle/side label that can be shown (with a small "x" to
// remove it), custom-overridden (e.g. "x" for an unknown), or hidden (shown as a
// small "+" that restores it). Used by every shape so labels behave consistently.
export function renderRemovableLabel({ x, y, value, hidden, cssClass, onRemove, onRestore, onDoubleClick }) {
  const g = el("g", { class: "removable-label" });
  if (hidden) {
    const plus = text("+", {
      x,
      y,
      class: "label-plus",
      "text-anchor": "middle",
      "dominant-baseline": "middle",
    });
    plus.addEventListener("pointerdown", (e) => e.stopPropagation());
    plus.addEventListener("click", (e) => {
      e.stopPropagation();
      onRestore(e);
    });
    g.appendChild(plus);
    return g;
  }

  const t = text(value, { x, y, class: cssClass, "text-anchor": "middle", "dominant-baseline": "middle" });
  t.addEventListener("pointerdown", (e) => e.stopPropagation());
  if (onDoubleClick) t.addEventListener("dblclick", onDoubleClick);
  g.appendChild(t);

  const cross = text("×", {
    x: x + 13,
    y: y - 11,
    class: "label-remove",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
  });
  cross.addEventListener("pointerdown", (e) => e.stopPropagation());
  cross.addEventListener("click", (e) => {
    e.stopPropagation();
    onRemove(e);
  });
  g.appendChild(cross);

  return g;
}

// Convert a client-space (mouse/pointer) coordinate into the SVG's user-space
// coordinate system, accounting for the viewBox scaling.
export function toSvgPoint(svgRoot, clientX, clientY) {
  const pt = svgRoot.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svgRoot.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}
