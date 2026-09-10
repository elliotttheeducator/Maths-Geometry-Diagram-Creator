import { withUnit } from "./units.js";

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

  // A numeric value is a measured length, so it carries the diagram's unit; anything
  // already a string is either an angle (with its own degree sign) or a label the
  // user chose, and is shown exactly as it is.
  const t = text(withUnit(value), { x, y, class: cssClass, "text-anchor": "middle", "dominant-baseline": "middle" });
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

// A textbook dimension line: double-headed arrow between two points, with a short
// perpendicular tick at each end -- the convention for marking an overall length
// outside the shape rather than labelling the edge itself.
export function dimensionLine(from, to, offset = 0, scale = 1) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const a = { x: from.x + nx * offset, y: from.y + ny * offset };
  const b = { x: to.x + nx * offset, y: to.y + ny * offset };

  const g = el("g", { class: "dimension-line" });
  g.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "dimension-shaft" }));

  // Arrowheads and end ticks are notation, so they scale with the figure like
  // everything else -- fixed ones vanish on a large diagram.
  const head = 7 * scale;
  const wing = 3.2 * scale;
  for (const [tip, dir] of [
    [a, 1],
    [b, -1],
  ]) {
    const bx = tip.x + ux * head * dir;
    const by = tip.y + uy * head * dir;
    g.appendChild(
      el("path", {
        d: `M ${tip.x} ${tip.y} L ${bx + nx * wing} ${by + ny * wing} L ${bx - nx * wing} ${by - ny * wing} Z`,
        class: "dimension-head",
      })
    );
    const tick = 5 * scale;
    g.appendChild(
      el("line", {
        x1: tip.x + nx * tick,
        y1: tip.y + ny * tick,
        x2: tip.x - nx * tick,
        y2: tip.y - ny * tick,
        class: "dimension-shaft",
      })
    );
  }
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
