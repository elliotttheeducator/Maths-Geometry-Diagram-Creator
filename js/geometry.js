// Small 2D vector / geometry helpers shared by all shapes.
// Points are plain {x, y} objects in SVG user-space coordinates.

export const PX_PER_UNIT = 50; // used to translate on-screen distance into a "length" a teacher can label

export function dist(p, q) {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

export function lengthInUnits(p, q) {
  return dist(p, q) / PX_PER_UNIT;
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(v, k) {
  return { x: v.x * k, y: v.y * k };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function magnitude(v) {
  return Math.hypot(v.x, v.y);
}

export function normalize(v) {
  const m = magnitude(v);
  return m === 0 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
}

// Unsigned interior angle (0-180 deg) at vertex `v` between rays to `a` and `b`.
export function angleAtVertex(v, a, b) {
  const va = sub(a, v);
  const vb = sub(b, v);
  const m = magnitude(va) * magnitude(vb);
  if (m === 0) return 0;
  let c = dot(va, vb) / m;
  c = Math.max(-1, Math.min(1, c));
  return (Math.acos(c) * 180) / Math.PI;
}

// Signed angle (-180..180 deg) from ray v->a to ray v->b, positive = counter-clockwise
// in standard math orientation (note SVG's y-axis points down, so "counter-clockwise"
// here is visually clockwise on screen -- doesn't matter as long as it's consistent).
export function signedAngleAtVertex(v, a, b) {
  const va = sub(a, v);
  const vb = sub(b, v);
  return (Math.atan2(cross(va, vb), dot(va, vb)) * 180) / Math.PI;
}

// Rotate point p around center c by `deg` degrees (screen/SVG coords).
export function rotatePoint(p, center, deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const d = sub(p, center);
  return {
    x: center.x + d.x * cos - d.y * sin,
    y: center.y + d.x * sin + d.y * cos,
  };
}

export function pointOnRay(from, through, length) {
  const dir = normalize(sub(through, from));
  return add(from, scale(dir, length));
}

// Intersection of ray from P (direction angle dirPRad) and ray from Q (direction
// angle dirQRad). Returns null if the rays are parallel.
export function rayIntersection(P, dirPRad, Q, dirQRad) {
  const dPx = Math.cos(dirPRad);
  const dPy = Math.sin(dirPRad);
  const dQx = Math.cos(dirQRad);
  const dQy = Math.sin(dirQRad);
  const denom = dPx * dQy - dPy * dQx;
  if (Math.abs(denom) < 1e-9) return null;
  const dx = Q.x - P.x;
  const dy = Q.y - P.y;
  const t = (dx * dQy - dy * dQx) / denom;
  return { x: P.x + dPx * t, y: P.y + dPy * t };
}

// Intersection of segment p1-p2 and segment p3-p4, but ONLY if it falls strictly
// inside both segments (not at or near an endpoint) -- endpoint coincidences are
// real shared vertices, handled separately, not "crossings".
export function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const s = (dx * d1y - dy * d1x) / denom;
  const EPS = 0.02;
  if (t > EPS && t < 1 - EPS && s > EPS && s < 1 - EPS) {
    return { x: p1.x + d1x * t, y: p1.y + d1y * t };
  }
  return null;
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

let idCounter = 0;
export function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
