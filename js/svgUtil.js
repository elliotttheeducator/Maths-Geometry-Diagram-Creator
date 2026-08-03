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
