import {
  dist,
  angleAtVertex,
  signedAngleAtVertex,
  rotatePoint,
  rayIntersection,
  pointOnRay,
  midpoint,
  round1,
  nextId,
  PX_PER_UNIT,
  clamp,
} from "../geometry.js";
import { el, text, clear, toSvgPoint, renderRemovableLabel } from "../svgUtil.js";
import { parseFieldInput } from "../fieldInput.js";
import { paletteEntry } from "../palette.js";
import { applyLabelScale, gap, extentOf, labelOffset, spreadLabels, scaled } from "../labelScale.js";

const DEG = Math.PI / 180;

const RIGHT_ANGLE_TOLERANCE = 0.5;

// Side i connects vertex i to vertex (i+1)%3. Editing that side moves vertex (i+1)%3
// along the existing ray from vertex i, leaving the third vertex untouched. Editing
// angle i rotates vertex (i+1)%3 around vertex i, keeping vertex (i-1+3)%3 fixed, so
// the interior angle at i becomes exactly the requested value.
// Both rules only ever move one point at a time from its current position, so the
// triangle is always a real, valid triangle -- values shown are always exactly what's drawn.

export class Triangle {
  constructor({ points, labels = ["A", "B", "C"], id } = {}) {
    this.id = id || nextId("triangle");
    this.type = "triangle";
    this.points = points || [
      { x: 300, y: 480 },
      { x: 520, y: 480 },
      { x: 380, y: 260 },
    ];
    this.labels = labels;
    this.angleOverrides = [undefined, undefined, undefined];
    this.sideOverrides = [undefined, undefined, undefined];
    // A field typed in as a plain number is "locked" -- its value is protected
    // from being silently disturbed by a *later* edit to a different field.
    // With 2 angles locked (or 2 sides), that later edit is solved properly
    // (ASA / SAS reconstruction) instead of the naive single-point rule, so both
    // locked values hold simultaneously -- e.g. typing two 80s makes an isosceles
    // triangle instead of the second edit silently changing the first.
    this.angleLockDeg = [null, null, null];
    this.sideLockUnits = [null, null, null];
    this._lockOrder = []; // tokens like "angle:0", oldest first -- used to resolve 3-way conflicts
    // Exterior angle at vertex i: extends the incoming side (from the previous
    // vertex) beyond vertex i into a ray, and labels the angle between that ray
    // and the other side at i. Always display-only (180 - interior), like the
    // parallel-lines crossing angles -- there's no independent way to set it.
    this.exteriorExtended = [false, false, false];
    this.exteriorOverrides = [undefined, undefined, undefined];
    // Internal segment parallel to one side: apex is the vertex NOT on that side;
    // the segment connects points at the same fraction t (0-1) along the two sides
    // touching the apex, which by the basic proportionality theorem is always
    // exactly parallel to the third (opposite) side, for any t. Covers both a
    // midsegment-style triangle and a nested similar right-triangle construction.
    this.cevian = { apex: null, t: 0.5 };
    this.cevianLengthOverride = undefined;
    this.cevianPointLabels = ["D", "E"];
    this.fillId = "cream";
    // Perpendicular height from one vertex to the opposite side. `from` is that vertex
    // (null = not shown). On an obtuse triangle the foot lands beyond the end of the
    // base, and the textbook drawing extends the base with a dashed line to meet it --
    // that case is handled by the geometry rather than being a separate mode.
    this.height = { from: null };
    this.heightOverride = undefined;
    this.showTicks = true; // tick marks wherever two sides are genuinely equal
    this.showVertexLabels = true;
    // Set when an edit was refused as geometrically impossible, for the caller to report.
    this.lastRefusal = null;
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  // --- derived geometry -----------------------------------------------

  angles() {
    const [A, B, C] = this.points;
    return [angleAtVertex(A, B, C), angleAtVertex(B, C, A), angleAtVertex(C, A, B)];
  }

  // side[i] = length of edge between vertex i and vertex (i+1)%3
  sides() {
    const [A, B, C] = this.points;
    return [dist(A, B), dist(B, C), dist(C, A)];
  }

  centroid() {
    const [A, B, C] = this.points;
    return { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };
  }

  // --- precise editing rules -------------------------------------------

  // The single-point fallback rule, used when fewer than 2 angles are locked (so
  // there isn't yet a well-defined base to reconstruct from).
  applyAngleRotation(vertexIndex, newDeg) {
    newDeg = Math.max(1, Math.min(178, newDeg));
    const prevIdx = (vertexIndex + 2) % 3;
    const nextIdx = (vertexIndex + 1) % 3;
    const V = this.points[vertexIndex];
    const F = this.points[prevIdx];
    const R = this.points[nextIdx];
    const signedCurrent = signedAngleAtVertex(V, F, R);
    const sign = signedCurrent >= 0 ? 1 : -1;
    const newSigned = sign * newDeg;
    const delta = newSigned - signedCurrent;
    this.points[nextIdx] = rotatePoint(R, V, delta);
  }

  // The single-point fallback rule, used when fewer than 2 sides are locked.
  applySideMove(sideIndex, newLengthUnits) {
    const newLenPx = Math.max(10, newLengthUnits * PX_PER_UNIT);
    const fromIdx = sideIndex;
    const toIdx = (sideIndex + 1) % 3;
    const from = this.points[fromIdx];
    const to = this.points[toIdx];
    this.points[toIdx] = pointOnRay(from, to, newLenPx);
  }

  pushLockOrder(token) {
    this._lockOrder = this._lockOrder.filter((t) => t !== token);
    this._lockOrder.push(token);
  }

  clearAngleLock(idx) {
    this.angleLockDeg[idx] = null;
    this._lockOrder = this._lockOrder.filter((t) => t !== `angle:${idx}`);
  }

  clearSideLock(idx) {
    this.sideLockUnits[idx] = null;
    this._lockOrder = this._lockOrder.filter((t) => t !== `side:${idx}`);
  }

  lockAngle(vertexIndex, newDeg) {
    this.angleLockDeg[vertexIndex] = clamp(newDeg, 1, 178);
    this.pushLockOrder(`angle:${vertexIndex}`);

    let lockedIdx = [0, 1, 2].filter((i) => this.angleLockDeg[i] != null);
    if (lockedIdx.length === 3) {
      const sum = lockedIdx.reduce((s, i) => s + this.angleLockDeg[i], 0);
      if (Math.abs(sum - 180) > 0.05) {
        const oldest = this._lockOrder.find((t) => t.startsWith("angle:"));
        this.clearAngleLock(Number(oldest.split(":")[1]));
        lockedIdx = [0, 1, 2].filter((i) => this.angleLockDeg[i] != null);
      }
    }

    if (lockedIdx.length === 2) {
      this.placeApexFromTwoAngles(lockedIdx[0], lockedIdx[1]);
    } else {
      this.applyAngleRotation(vertexIndex, newDeg);
    }
    this.verifyLocks();
  }

  lockSide(sideIndex, newLengthUnits) {
    this.sideLockUnits[sideIndex] = Math.max(0.2, newLengthUnits);
    this.pushLockOrder(`side:${sideIndex}`);

    // If 2 angles are already locked, they fully determine the triangle's shape
    // already -- this side lock should only set the *scale*, never disturb them.
    const lockedAngles = [0, 1, 2].filter((i) => this.angleLockDeg[i] != null);
    if (lockedAngles.length >= 2) {
      this.scaleToMatchSide(lockedAngles.slice(0, 2), sideIndex);
      this.verifyLocks();
      return;
    }

    // One locked angle: hold it exactly and solve the side around it. Without this,
    // a right angle plus a leg plus the hypotenuse -- the ordinary Pythagoras setup --
    // silently bent the right angle to something like 93.6 degrees.
    if (lockedAngles.length === 1) {
      if (!this.solveSideWithLockedAngle(lockedAngles[0], sideIndex)) {
        const sideName = `${this.labels[sideIndex]}${this.labels[(sideIndex + 1) % 3]}`;
        this.lastRefusal = `${sideName}=${round1(newLengthUnits)} is impossible alongside the values already locked`;
        this.clearSideLock(sideIndex);
      }
      this.verifyLocks();
      return;
    }

    let lockedIdx = [0, 1, 2].filter((i) => this.sideLockUnits[i] != null);
    // Three sides is not over-specified -- it determines the triangle exactly -- so it
    // gets a real SSS construction rather than the drop-the-oldest-lock rule, which
    // used to leave "sides 3, 4, 5" quietly drawn as 3.4, 4, 5.
    if (lockedIdx.length === 3) {
      if (this.placeFromThreeSides()) {
        this.verifyLocks();
        return;
      }
      const sideName = `${this.labels[sideIndex]}${this.labels[(sideIndex + 1) % 3]}`;
      this.lastRefusal = `${sideName}=${round1(newLengthUnits)} breaks the triangle inequality -- no triangle has those three sides`;
      this.clearSideLock(sideIndex);
      this.verifyLocks();
      return;
    }

    if (lockedIdx.length === 2) {
      this.placeFarPointsFromTwoSides(lockedIdx[0], lockedIdx[1]);
    } else {
      this.applySideMove(sideIndex, newLengthUnits);
    }
    this.verifyLocks();
  }

  // SSS: all three side lengths given. Vertex A and the direction A->B stay put, B
  // slides to its distance, and C is the intersection of the two circles centred on A
  // and B -- taken on whichever side C already sits, so the triangle doesn't flip over.
  // Returns false when the three lengths violate the triangle inequality, which is
  // exactly when no such triangle exists.
  placeFromThreeSides() {
    const [ab, bc, ca] = this.sideLockUnits.map((u) => u * PX_PER_UNIT);
    if (ab + bc <= ca || bc + ca <= ab || ca + ab <= bc) return false;

    const A = this.points[0];
    const dir = Math.atan2(this.points[1].y - A.y, this.points[1].x - A.x);
    const ux = Math.cos(dir);
    const uy = Math.sin(dir);
    const B = { x: A.x + ux * ab, y: A.y + uy * ab };

    // Foot of C on AB, then its perpendicular offset.
    const along = (ab * ab + ca * ca - bc * bc) / (2 * ab);
    const height = Math.sqrt(Math.max(0, ca * ca - along * along));
    const prev = this.points[2];
    const cross = ux * (prev.y - A.y) - uy * (prev.x - A.x);
    const side = cross >= 0 ? 1 : -1;

    this.points[1] = B;
    this.points[2] = {
      x: A.x + ux * along - uy * height * side,
      y: A.y + uy * along + ux * height * side,
    };
    return true;
  }

  // With exactly one angle locked, at vertex v: vertex v and the directions of both
  // rays leaving it stay put (which is what keeps that angle exact), and one far point
  // slides along its own ray until the requested side measures what it should.
  //
  // For a side touching v that's a straight slide. For the side opposite v it's the
  // intersection of a ray with a circle -- a quadratic that has no solution when the
  // requested length is shorter than the perpendicular distance to the ray, which is
  // precisely the case where no such triangle exists. Returns false there instead of
  // quietly bending the locked angle to make the numbers fit.
  solveSideWithLockedAngle(v, sideIndex) {
    const target = this.sideLockUnits[sideIndex] * PX_PER_UNIT;
    const V = this.points[v];
    const a = (v + 1) % 3; // far point of side v
    const b = (v + 2) % 3; // far point of side (v+2)%3

    if (sideIndex === v || sideIndex === (v + 2) % 3) {
      const far = sideIndex === v ? a : b;
      this.points[far] = pointOnRay(V, this.points[far], target);
      return true;
    }

    // The opposite side: slide whichever far point isn't itself pinned by a side lock.
    const aPinned = this.sideLockUnits[v] != null;
    const bPinned = this.sideLockUnits[(v + 2) % 3] != null;
    const slide = aPinned && !bPinned ? b : !aPinned && bPinned ? a : b;
    const keep = slide === a ? b : a;
    const t = this.rayDistanceForLength(V, this.points[slide], this.points[keep], target);
    if (t == null) return false;
    this.points[slide] = pointOnRay(V, this.points[slide], t);
    return true;
  }

  // Distance t along the ray V->along at which the point sits exactly `target` from P.
  rayDistanceForLength(V, along, P, target) {
    const len = dist(V, along) || 1;
    const u = { x: (along.x - V.x) / len, y: (along.y - V.y) / len };
    const w = { x: V.x - P.x, y: V.y - P.y };
    const wu = w.x * u.x + w.y * u.y;
    const disc = wu * wu - (w.x * w.x + w.y * w.y) + target * target;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const candidates = [-wu + root, -wu - root].filter((t) => t > 1e-6);
    if (!candidates.length) return null;
    // Two positive roots means the classic ambiguous case; take the one nearest the
    // current shape so the triangle doesn't flip to its other solution unasked.
    return candidates.reduce((best, t) => (Math.abs(t - len) < Math.abs(best - len) ? t : best));
  }

  // Uniformly rescales the whole triangle about vertex p (one of the 2 locked-angle
  // vertices) so the given side hits its locked length exactly. A uniform scale
  // preserves every angle, so both angle locks stay satisfied no matter which side
  // is being resized.
  scaleToMatchSide([p, q], sideIndex) {
    this.placeApexFromTwoAngles(p, q);
    const fromIdx = sideIndex;
    const toIdx = (sideIndex + 1) % 3;
    const targetPx = this.sideLockUnits[sideIndex] * PX_PER_UNIT;
    const currentPx = dist(this.points[fromIdx], this.points[toIdx]);
    if (currentPx < 1e-6) return;
    const factor = targetPx / currentPx;
    const anchor = this.points[p];
    this.points = this.points.map((pt, i) =>
      i === p ? pt : { x: anchor.x + (pt.x - anchor.x) * factor, y: anchor.y + (pt.y - anchor.y) * factor }
    );
  }

  // Safety net: after any reconstruction, drop (un-lock) any field whose lock is no
  // longer actually satisfied by the resulting geometry, rather than let its lock
  // icon keep showing while quietly lying about what's protected.
  verifyLocks() {
    const angles = this.angles();
    for (let i = 0; i < 3; i++) {
      if (this.angleLockDeg[i] != null && Math.abs(angles[i] - this.angleLockDeg[i]) > 0.2) {
        this.clearAngleLock(i);
      }
    }
    const sides = this.sides();
    for (let i = 0; i < 3; i++) {
      if (this.sideLockUnits[i] != null && Math.abs(sides[i] / PX_PER_UNIT - this.sideLockUnits[i]) > 0.05) {
        this.clearSideLock(i);
      }
    }
  }

  // Base p<->q stays exactly where it is; the apex (the third vertex) is placed at
  // the intersection of the two rays defined by the locked angles at p and q, on
  // whichever side the apex currently sits (so it doesn't flip the triangle over).
  placeApexFromTwoAngles(p, q) {
    const apex = 3 - p - q;
    const P = this.points[p];
    const Q = this.points[q];
    const baseDir = Math.atan2(Q.y - P.y, Q.x - P.x);
    const cross = (Q.x - P.x) * (this.points[apex].y - P.y) - (Q.y - P.y) * (this.points[apex].x - P.x);
    const side = cross >= 0 ? 1 : -1;
    const angleFromP = baseDir + side * this.angleLockDeg[p] * DEG;
    const angleFromQ = baseDir + Math.PI - side * this.angleLockDeg[q] * DEG;
    const newApex = rayIntersection(P, angleFromP, Q, angleFromQ);
    if (newApex) this.points[apex] = newApex;
  }

  // The shared vertex of the two locked sides stays fixed; each side's far point is
  // placed at the locked distance along its existing direction from that vertex.
  placeFarPointsFromTwoSides(s1, s2) {
    const pairs = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];
    const [a1, b1] = pairs[s1];
    const [a2, b2] = pairs[s2];
    const shared = [a1, b1].find((v) => v === a2 || v === b2);
    const far1 = a1 === shared ? b1 : a1;
    const far2 = a2 === shared ? b2 : a2;
    const S = this.points[shared];
    this.points[far1] = pointOnRay(S, this.points[far1], this.sideLockUnits[s1] * PX_PER_UNIT);
    this.points[far2] = pointOnRay(S, this.points[far2], this.sideLockUnits[s2] * PX_PER_UNIT);
  }

  setLabel(vertexIndex, newLabel) {
    this.labels[vertexIndex] = newLabel.slice(0, 4) || this.labels[vertexIndex];
    this.notifyChange();
  }

  // The altitude from `height.from`: where it meets the opposite side (or that side's
  // extension), how long it is, and whether the foot falls outside the triangle.
  heightGeometry() {
    const apexIdx = this.height.from;
    if (apexIdx == null) return null;
    const apex = this.points[apexIdx];
    const A = this.points[(apexIdx + 1) % 3];
    const B = this.points[(apexIdx + 2) % 3];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const baseLen = Math.hypot(dx, dy) || 1;
    const ux = dx / baseLen;
    const uy = dy / baseLen;
    const along = (apex.x - A.x) * ux + (apex.y - A.y) * uy;
    const foot = { x: A.x + ux * along, y: A.y + uy * along };
    return {
      apex,
      foot,
      A,
      B,
      baseLen,
      unit: { x: ux, y: uy },
      along,
      outside: along < 0 || along > baseLen,
      // Which base endpoint the dashed extension has to reach out from.
      from: along < 0 ? A : B,
    };
  }

  heightUnits() {
    const g = this.heightGeometry();
    return g ? dist(g.apex, g.foot) / PX_PER_UNIT : 0;
  }

  // Setting the height slides the apex along its own perpendicular, so the base stays
  // exactly where it is and only the height changes.
  setHeight(units) {
    const g = this.heightGeometry();
    if (!g) return;
    const target = Math.max(10, units * PX_PER_UNIT);
    const current = dist(g.apex, g.foot) || 1;
    const dirX = (g.apex.x - g.foot.x) / current;
    const dirY = (g.apex.y - g.foot.y) / current;
    this.points[this.height.from] = { x: g.foot.x + dirX * target, y: g.foot.y + dirY * target };
    this.verifyLocks();
    this.notifyChange();
  }

  // Vertices and edge midpoints are the points other shapes snap to; the outline is
  // what "Turn into prism" extrudes.
  snapPoints() {
    const p = this.points;
    return [...p, ...p.map((pt, i) => midpoint(pt, p[(i + 1) % 3]))];
  }

  outline() {
    return this.points.map((p) => ({ ...p }));
  }

  translate(dx, dy) {
    this.points = this.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    this.notifyChange();
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  // --- sidebar field descriptors ---------------------------------------

  getFields() {
    const angles = this.angles();
    const sides = this.sides();
    const sideNames = [
      `${this.labels[0]}${this.labels[1]}`,
      `${this.labels[1]}${this.labels[2]}`,
      `${this.labels[2]}${this.labels[0]}`,
    ];
    const fields = [];
    for (let i = 0; i < 3; i++) {
      fields.push({
        key: `angle-${i}`,
        group: "Angles",
        label: `∠${this.labels[i]}`,
        kind: "angle",
        locked: this.angleLockDeg[i] != null,
        value: this.angleOverrides[i] !== undefined ? this.angleOverrides[i] : round1(angles[i]),
      });
    }
    for (let i = 0; i < 3; i++) {
      fields.push({
        key: `side-${i}`,
        group: "Side lengths",
        label: sideNames[i],
        kind: "length",
        locked: this.sideLockUnits[i] != null,
        value: this.sideOverrides[i] !== undefined ? this.sideOverrides[i] : round1(sides[i] / PX_PER_UNIT),
      });
    }
    for (let i = 0; i < 3; i++) {
      fields.push({
        key: `label-${i}`,
        group: "Vertex labels",
        label: `Vertex ${i + 1}`,
        kind: "text",
        value: this.labels[i],
      });
    }
    for (let i = 0; i < 3; i++) {
      fields.push({
        key: `ext-toggle-${i}`,
        group: "Exterior angle",
        label: `Extend at ${this.labels[i]}`,
        kind: "toggle",
        value: this.exteriorExtended[i],
      });
      if (this.exteriorExtended[i]) {
        const override = this.exteriorOverrides[i];
        fields.push({
          key: `ext-${i}`,
          group: "Exterior angle",
          label: `  value at ${this.labels[i]}`,
          kind: "angle",
          value: override !== undefined ? override : round1(180 - angles[i]),
        });
      }
    }
    fields.push({
      key: "show-height",
      group: "Perpendicular height",
      label: "Show",
      kind: "toggle",
      value: this.height.from != null,
    });
    if (this.height.from != null) {
      for (let i = 0; i < 3; i++) {
        fields.push({
          key: `height-from-${i}`,
          group: "Perpendicular height",
          label: `From ${this.labels[i]}`,
          kind: "toggle",
          value: this.height.from === i,
        });
      }
      fields.push({
        key: "height",
        group: "Perpendicular height",
        label: "Height",
        kind: "length",
        value: this.heightOverride !== undefined ? this.heightOverride : round1(this.heightUnits()),
      });
      fields.push({
        key: "height-outside",
        group: "Perpendicular height",
        label: "Falls outside",
        kind: "info",
        value: this.heightGeometry()?.outside ? "yes -- base extended" : "no",
      });
    }

    fields.push({ key: "fill", group: "Appearance", label: "Fill", kind: "swatch", value: this.fillId });
    fields.push({
      key: "show-ticks",
      group: "Appearance",
      label: "Equal-side ticks",
      kind: "toggle",
      value: this.showTicks,
    });
    fields.push({
      key: "show-vertex-labels",
      group: "Appearance",
      label: "Vertex letters",
      kind: "toggle",
      value: this.showVertexLabels,
    });
    fields.push({
      key: "cevian-toggle",
      group: "Parallel segment",
      label: "Show",
      kind: "toggle",
      value: this.cevian.apex != null,
    });
    if (this.cevian.apex != null) {
      for (let i = 0; i < 3; i++) {
        fields.push({
          key: `cevian-apex-${i}`,
          group: "Parallel segment",
          label: `From ${this.labels[i]}`,
          kind: "toggle",
          value: this.cevian.apex === i,
        });
      }
      fields.push({
        key: "cevian-t",
        group: "Parallel segment",
        label: "Position",
        kind: "ratio",
        value: this.cevian.t,
      });
      const cp = this.cevianPoints();
      const lengthUnits = round1(dist(cp.P1, cp.P2) / PX_PER_UNIT);
      fields.push({
        key: "cevian-length",
        group: "Parallel segment",
        label: "Length",
        kind: "length",
        value: this.cevianLengthOverride !== undefined ? this.cevianLengthOverride : lengthUnits,
      });
      fields.push({
        key: "cevian-label-0",
        group: "Parallel segment",
        label: "Point 1 label",
        kind: "text",
        value: this.cevianPointLabels[0],
      });
      fields.push({
        key: "cevian-label-1",
        group: "Parallel segment",
        label: "Point 2 label",
        kind: "text",
        value: this.cevianPointLabels[1],
      });
    }
    if (this._scaleBasePoints) {
      fields.unshift({
        key: "scale-factor",
        group: "Scale",
        label: "Scale factor",
        kind: "scale",
        value: this.scaleFactor,
      });
    }
    return fields;
  }

  // Releases a lock directly (e.g. clicking its lock icon) without hiding or
  // relabeling the field -- the value stays exactly as-is, just no longer protected.
  unlockField(key) {
    const [kind, idxStr] = key.split("-");
    const idx = Number(idxStr);
    if (kind === "angle") this.clearAngleLock(idx);
    else if (kind === "side") this.clearSideLock(idx);
    this.notifyChange();
  }

  setField(key, value) {
    if (key === "scale-factor") {
      this.applyScale(Number(value));
      return;
    }
    if (key === "show-ticks") {
      this.showTicks = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "show-height") {
      // Default to the apex furthest from the longest side, which is the vertex a
      // question means when it just says "the height".
      this.height.from = value ? (this.height.from ?? 2) : null;
      this.notifyChange();
      return;
    }
    if (key.startsWith("height-from-")) {
      if (value) this.height.from = Number(key.slice(12));
      this.notifyChange();
      return;
    }
    if (key === "height-outside") return; // derived
    if (key === "height") {
      if (this.height.from == null) this.height.from = 2;
      const parsed = parseFieldInput(value);
      if (parsed.hidden) {
        this.heightOverride = "";
        this.notifyChange();
        return;
      }
      if (parsed.label !== undefined) {
        this.heightOverride = parsed.label;
        this.notifyChange();
        return;
      }
      this.heightOverride = undefined;
      this.setHeight(parsed.numeric);
      return;
    }
    if (key === "show-vertex-labels") {
      this.showVertexLabels = Boolean(value);
      this.notifyChange();
      return;
    }
    const [kind, idxStr] = key.split("-");
    const idx = Number(idxStr);
    if (kind === "label") {
      this.setLabel(idx, String(value));
      return;
    }
    if (key.startsWith("ext-toggle-")) {
      this.exteriorExtended[Number(key.slice(11))] = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key.startsWith("ext-")) {
      const extIdx = Number(key.slice(4));
      const str = String(value).trim();
      this.exteriorOverrides[extIdx] = str === "" ? "" : str;
      this.notifyChange();
      return;
    }
    if (key === "fill") {
      this.fillId = value;
      this.notifyChange();
      return;
    }
    if (key === "cevian-toggle") {
      this.setCevianApex(value ? (this.cevian.apex == null ? 2 : this.cevian.apex) : null);
      return;
    }
    if (key.startsWith("cevian-apex-")) {
      this.setCevianApex(Number(key.slice(12)));
      return;
    }
    if (key === "cevian-t") {
      this.setCevianT(Number(value));
      return;
    }
    if (key === "cevian-length") {
      const parsed = parseFieldInput(value);
      if (parsed.numeric !== undefined) {
        this.cevianLengthOverride = undefined;
        this.setCevianLength(parsed.numeric);
      } else {
        this.cevianLengthOverride = parsed.hidden ? "" : parsed.label;
        this.notifyChange();
      }
      return;
    }
    if (key.startsWith("cevian-label-")) {
      const li = Number(key.slice(13));
      this.cevianPointLabels[li] = String(value).slice(0, 4) || this.cevianPointLabels[li];
      this.notifyChange();
      return;
    }
    if (kind !== "angle" && kind !== "side") return;
    const overrides = kind === "angle" ? this.angleOverrides : this.sideOverrides;
    const parsed = parseFieldInput(value);
    if (parsed.hidden) {
      overrides[idx] = "";
      if (kind === "angle") this.clearAngleLock(idx);
      else this.clearSideLock(idx);
      this.notifyChange();
    } else if (parsed.label !== undefined) {
      overrides[idx] = parsed.label;
      if (kind === "angle") this.clearAngleLock(idx);
      else this.clearSideLock(idx);
      this.notifyChange();
    } else {
      overrides[idx] = undefined;
      if (kind === "angle") this.lockAngle(idx, parsed.numeric);
      else this.lockSide(idx, parsed.numeric);
      this.notifyChange();
    }
  }

  // --- cloning for scale-factor duplication -----------------------------

  cloneScaled(factor = 1, offset = { x: 110, y: 0 }) {
    const anchor = { ...this.points[0] };
    const basePoints = this.points.map((p) => ({ ...p }));
    const labels = this.labels.map((l) => (l.endsWith("'") ? l : `${l}'`));
    const clone = new Triangle({ points: basePoints.map((p) => ({ ...p })), labels });
    clone._scaleBasePoints = basePoints;
    clone._scaleAnchor = anchor;
    clone._scaleOffset = offset;
    clone.scaleFactor = 1;
    clone.applyScale(factor);
    return clone;
  }

  applyScale(factor) {
    if (!this._scaleBasePoints) return;
    this.scaleFactor = round1(clamp(factor, 0.2, 3));
    this.points = this._scaleBasePoints.map((p) => ({
      x: this._scaleAnchor.x + (p.x - this._scaleAnchor.x) * this.scaleFactor + this._scaleOffset.x,
      y: this._scaleAnchor.y + (p.y - this._scaleAnchor.y) * this.scaleFactor + this._scaleOffset.y,
    }));
    this.notifyChange();
  }

  // --- internal parallel segment (cevian) --------------------------------

  cevianPoints() {
    if (this.cevian.apex == null) return null;
    const apex = this.cevian.apex;
    const n1 = (apex + 1) % 3;
    const n2 = (apex + 2) % 3;
    const A = this.points[apex];
    const N1 = this.points[n1];
    const N2 = this.points[n2];
    const t = this.cevian.t;
    return {
      apex,
      farSideIndex: n1, // side n1 connects vertex n1 & n2 -- the side this segment is parallel to
      P1: { x: A.x + t * (N1.x - A.x), y: A.y + t * (N1.y - A.y) },
      P2: { x: A.x + t * (N2.x - A.x), y: A.y + t * (N2.y - A.y) },
    };
  }

  setCevianApex(apex) {
    this.cevian.apex = apex;
    this.notifyChange();
  }

  setCevianT(t) {
    this.cevian.t = clamp(t, 0.05, 0.95);
    this.notifyChange();
  }

  // Solve t so the segment has the requested length (segment length = t * far side length).
  setCevianLength(newLengthUnits) {
    if (this.cevian.apex == null) return;
    const cp = this.cevianPoints();
    const farSideLenPx = dist(this.points[cp.farSideIndex], this.points[(cp.farSideIndex + 1) % 3]);
    if (farSideLenPx < 1) return;
    const t = (newLengthUnits * PX_PER_UNIT) / farSideLenPx;
    this.cevian.t = clamp(t, 0.05, 0.95);
    this.notifyChange();
  }

  // --- rendering ---------------------------------------------------------

  mount(layer, controller) {
    this.controller = controller;
    this.group = el("g", { class: "shape-group", "data-id": this.id });
    layer.appendChild(this.group);
    this.render();
  }

  destroy() {
    if (this.group) this.group.remove();
  }

  ownExtentPx() {
    return extentOf(this.points);
  }

  // Notation scales with the diagram, not with each shape on its own: two shapes
  // butted into one composite have to be labelled at the same size to read as one
  // drawing. Falls back to this shape's own size when it stands alone.
  extentPx() {
    return this.controller?.diagramExtent?.() || this.ownExtentPx();
  }

  render() {
    if (!this.group) return;
    clear(this.group);
    applyLabelScale(this.group, this.extentPx());
    const [A, B, C] = this.points;
    const centroid = this.centroid();
    const angles = this.angles();

    const poly = el("polygon", {
      points: `${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`,
      class: `shape-poly${this.selected ? " selected" : ""}`,
      fill: paletteEntry(this.fillId).fill,
    });
    poly.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    this.group.appendChild(poly);

    // angle arcs / right-angle markers
    for (let i = 0; i < 3; i++) {
      this.group.appendChild(this.renderAngleMark(i, angles[i]));
    }

    // exterior angle extensions
    for (let i = 0; i < 3; i++) {
      if (this.exteriorExtended[i]) this.group.appendChild(this.renderExteriorAngle(i, angles[i]));
    }

    if (this.showTicks) this.group.appendChild(this.renderEqualTicks());
    const heightGroup = this.renderHeight();
    if (heightGroup) this.group.appendChild(heightGroup);

    // side length labels
    for (let i = 0; i < 3; i++) {
      const from = this.points[i];
      const to = this.points[(i + 1) % 3];
      this.group.appendChild(this.renderSideLabel(i, from, to, centroid));
    }

    if (this.cevian.apex != null) this.group.appendChild(this.renderCevian(centroid));

    // vertex handles + labels
    for (let i = 0; i < 3; i++) {
      if (this.showVertexLabels) this.group.appendChild(this.renderVertexLabel(i, centroid));
      this.group.appendChild(this.renderVertexHandle(i));
    }

    this.group.appendChild(this.renderRotateHandle(centroid));
 
    spreadLabels(this.group, this.extentPx());
  }

  renderAngleMark(i, angleDeg) {
    const V = this.points[i];
    const F = this.points[(i + 2) % 3];
    const R = this.points[(i + 1) % 3];
    const isRight = Math.abs(angleDeg - 90) < RIGHT_ANGLE_TOLERANCE;
    const hidden = this.angleOverrides[i] === "";

    const dirF = Math.atan2(F.y - V.y, F.x - V.x);
    const dirR = Math.atan2(R.y - V.y, R.x - V.x);
    const r = scaled(this.extentPx(), 22);
    let diff = ((dirR - dirF + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const bisector = dirF + diff / 2;
    const labelR = r + labelOffset(`${round1(angleDeg)}°`, this.extentPx(), Math.cos(bisector), Math.sin(bisector), 6);
    const lp = { x: V.x + labelR * Math.cos(bisector), y: V.y + labelR * Math.sin(bisector) };

    const group = el("g");

    if (hidden) {
      // A right angle keeps its square even with the number hidden -- the square IS
      // the statement, and a right-angled triangle with no mark on it reads wrong.
      if (isRight) group.appendChild(this.rightAngleMark(V, dirF, dirR));
      group.appendChild(
        renderRemovableLabel({
          x: lp.x,
          y: lp.y,
          hidden: true,
          onRestore: (e) => this.startInlineEdit(e, `angle-${i}`, round1(angleDeg)),
        })
      );
      return group;
    }

    if (isRight) {
      group.appendChild(this.rightAngleMark(V, dirF, dirR));
      return group;
    }

    const sweepFlag = diff > 0 ? 1 : 0;
    const start = { x: V.x + r * Math.cos(dirF), y: V.y + r * Math.sin(dirF) };
    const end = { x: V.x + r * Math.cos(dirR), y: V.y + r * Math.sin(dirR) };
    group.appendChild(
      el("path", {
        d: `M ${start.x} ${start.y} A ${r} ${r} 0 0 ${sweepFlag} ${end.x} ${end.y}`,
        class: "angle-arc",
      })
    );

    const displayValue = this.angleOverrides[i] !== undefined ? this.angleOverrides[i] : `${round1(angleDeg)}°`;
    group.appendChild(
      renderRemovableLabel({
        x: lp.x,
        y: lp.y,
        value: displayValue,
        hidden: false,
        cssClass: "angle-label",
        onRemove: () => this.setField(`angle-${i}`, ""),
        onDoubleClick: (e) => this.startInlineEdit(e, `angle-${i}`, displayValue),
      })
    );
    return group;
  }

  // The textbook perpendicular height: a dashed altitude with a right-angle box where
  // it meets the base, and -- when the foot lands past the end of the base, as it does
  // on any obtuse triangle -- a dashed extension of the base out to meet it.
  renderHeight() {
    const g = this.heightGeometry();
    if (!g) return null;
    const group = el("g");

    if (g.outside) {
      group.appendChild(
        el("line", {
          x1: g.from.x,
          y1: g.from.y,
          x2: g.foot.x,
          y2: g.foot.y,
          class: "construction-line base-extension",
        })
      );
    }

    group.appendChild(
      el("line", { x1: g.apex.x, y1: g.apex.y, x2: g.foot.x, y2: g.foot.y, class: "construction-line" })
    );

    // The box sits in the corner between the altitude and the base, on the side the
    // base actually runs -- for an external height that's back towards the triangle.
    const size = scaled(this.extentPx(), 12);
    const up = { x: (g.apex.x - g.foot.x) / (dist(g.apex, g.foot) || 1), y: (g.apex.y - g.foot.y) / (dist(g.apex, g.foot) || 1) };
    const towards = g.along < 0 ? 1 : -1; // point the box back along the base
    const bx = g.unit.x * towards;
    const by = g.unit.y * towards;
    group.appendChild(
      el("path", {
        d: `M ${g.foot.x + bx * size} ${g.foot.y + by * size} L ${g.foot.x + (bx + up.x) * size} ${
          g.foot.y + (by + up.y) * size
        } L ${g.foot.x + up.x * size} ${g.foot.y + up.y * size}`,
        class: "right-angle-mark",
      })
    );

    const hidden = this.heightOverride === "";
    const computed = round1(this.heightUnits());
    const displayValue = this.heightOverride !== undefined && this.heightOverride !== "" ? this.heightOverride : computed;
    // The altitude splits the base into two pieces; the label goes on the side of the
    // longer one, which is the open part of the triangle. Putting it on the short side
    // is what makes a height label collide with the edge next to it.
    const mid = midpoint(g.apex, g.foot);
    const towardsB = g.outside ? (g.along < 0 ? -1 : 1) : g.along < g.baseLen / 2 ? 1 : -1;
    const nx = g.unit.x * towardsB;
    const ny = g.unit.y * towardsB;
    const off = labelOffset(displayValue, this.extentPx(), nx, ny);
    group.appendChild(
      renderRemovableLabel({
        x: mid.x + nx * off,
        y: mid.y + ny * off,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField("height", ""),
        onRestore: (e) => this.startInlineEdit(e, "height", computed),
        onDoubleClick: (e) => this.startInlineEdit(e, "height", displayValue),
      })
    );
    return group;
  }

  rightAngleMark(V, dirF, dirR) {
    const size = scaled(this.extentPx(), 14);
    const uF = { x: Math.cos(dirF), y: Math.sin(dirF) };
    const uR = { x: Math.cos(dirR), y: Math.sin(dirR) };
    const p1 = { x: V.x + uF.x * size, y: V.y + uF.y * size };
    const p2 = { x: V.x + uF.x * size + uR.x * size, y: V.y + uF.y * size + uR.y * size };
    const p3 = { x: V.x + uR.x * size, y: V.y + uR.y * size };
    return el("path", {
      d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y}`,
      class: "right-angle-mark",
    });
  }

  // Tick marks on sides that are genuinely the same length -- the notation that says
  // "isosceles" without repeating the number, and the reason an unlabelled equal side
  // still carries information. Sides are grouped by measured length, so the marks can
  // never claim an equality the triangle doesn't have.
  renderEqualTicks() {
    const g = el("g");
    const lengths = this.sides();
    const groups = []; // [{ len, indices }]
    lengths.forEach((len, i) => {
      const match = groups.find((grp) => Math.abs(grp.len - len) < 0.5);
      if (match) match.indices.push(i);
      else groups.push({ len, indices: [i] });
    });

    const tick = scaled(this.extentPx(), 5);
    let markIndex = 0;
    for (const grp of groups) {
      if (grp.indices.length < 2) continue;
      markIndex += 1;
      for (const i of grp.indices) {
        const a = this.points[i];
        const b = this.points[(i + 1) % 3];
        const mid = midpoint(a, b);
        const len = dist(a, b) || 1;
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        for (let t = 0; t < markIndex; t++) {
          const off = (t - (markIndex - 1) / 2) * tick;
          const c = { x: mid.x + ux * off, y: mid.y + uy * off };
          g.appendChild(
            el("line", {
              x1: c.x - uy * tick,
              y1: c.y + ux * tick,
              x2: c.x + uy * tick,
              y2: c.y - ux * tick,
              class: "equal-length-tick",
            })
          );
        }
      }
    }
    return g;
  }

  // Extends the side (i-1 -> i) beyond vertex i, and labels the angle between
  // that extension and the other side at i (always = 180 - interior angle at i).
  renderExteriorAngle(i, interiorDeg) {
    const V = this.points[i];
    const F = this.points[(i + 2) % 3]; // base of the extended side
    const R = this.points[(i + 1) % 3]; // the other neighbor, defines the exterior angle's far edge
    const sideLen = dist(F, V);
    const extLen = clamp(sideLen * 0.55, 40, 140);
    const dirFV = { x: (V.x - F.x) / sideLen, y: (V.y - F.y) / sideLen };
    const ext = { x: V.x + dirFV.x * extLen, y: V.y + dirFV.y * extLen };

    const g = el("g");
    g.appendChild(el("line", { x1: V.x, y1: V.y, x2: ext.x, y2: ext.y, class: "shape-line" }));

    const dirExt = Math.atan2(ext.y - V.y, ext.x - V.x);
    const dirR = Math.atan2(R.y - V.y, R.x - V.x);
    const r = 22;
    let diff = ((dirR - dirExt + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const sweepFlag = diff > 0 ? 1 : 0;
    const start = { x: V.x + r * Math.cos(dirExt), y: V.y + r * Math.sin(dirExt) };
    const end = { x: V.x + r * Math.cos(dirR), y: V.y + r * Math.sin(dirR) };
    const bisector = dirExt + diff / 2;
    const labelR = r + 16;
    const lp = { x: V.x + labelR * Math.cos(bisector), y: V.y + labelR * Math.sin(bisector) };

    const exteriorDeg = round1(180 - interiorDeg);
    const hidden = this.exteriorOverrides[i] === "";

    if (!hidden) {
      g.appendChild(
        el("path", { d: `M ${start.x} ${start.y} A ${r} ${r} 0 0 ${sweepFlag} ${end.x} ${end.y}`, class: "angle-arc" })
      );
    }
    const displayValue = this.exteriorOverrides[i] !== undefined && this.exteriorOverrides[i] !== ""
      ? this.exteriorOverrides[i]
      : `${exteriorDeg}°`;
    g.appendChild(
      renderRemovableLabel({
        x: lp.x,
        y: lp.y,
        value: displayValue,
        hidden,
        cssClass: "angle-label",
        onRemove: () => this.setField(`ext-${i}`, ""),
        onRestore: (e) => this.startInlineEdit(e, `ext-${i}`, exteriorDeg),
        onDoubleClick: (e) => this.startInlineEdit(e, `ext-${i}`, displayValue),
      })
    );
    return g;
  }

  renderSideLabel(i, from, to, centroid) {
    const mid = midpoint(from, to);
    const normal = { x: -(to.y - from.y), y: to.x - from.x };
    const len = Math.hypot(normal.x, normal.y) || 1;
    let nx = normal.x / len;
    let ny = normal.y / len;
    const towardCentroidX = centroid.x - mid.x;
    const towardCentroidY = centroid.y - mid.y;
    if (nx * towardCentroidX + ny * towardCentroidY > 0) {
      nx = -nx;
      ny = -ny;
    }
    const hidden = this.sideOverrides[i] === "";
    const lengthUnits = round1(dist(from, to) / PX_PER_UNIT);
    const displayValue = this.sideOverrides[i] !== undefined ? this.sideOverrides[i] : lengthUnits;
    const offset = labelOffset(displayValue, this.extentPx(), nx, ny);
    const pos = { x: mid.x + nx * offset, y: mid.y + ny * offset };

    return renderRemovableLabel({
      x: pos.x,
      y: pos.y,
      value: displayValue,
      hidden,
      cssClass: "side-label",
      onRemove: () => this.setField(`side-${i}`, ""),
      onRestore: (e) => this.startInlineEdit(e, `side-${i}`, lengthUnits),
      onDoubleClick: (e) => this.startInlineEdit(e, `side-${i}`, displayValue),
    });
  }

  renderCevian(centroid) {
    const cp = this.cevianPoints();
    const g = el("g");
    g.appendChild(el("line", { x1: cp.P1.x, y1: cp.P1.y, x2: cp.P2.x, y2: cp.P2.y, class: "shape-line" }));

    // point labels
    for (const [p, label] of [
      [cp.P1, this.cevianPointLabels[0]],
      [cp.P2, this.cevianPointLabels[1]],
    ]) {
      const dx = p.x - centroid.x;
      const dy = p.y - centroid.y;
      const len = Math.hypot(dx, dy) || 1;
      g.appendChild(
        text(label, {
          x: p.x + (dx / len) * 16,
          y: p.y + (dy / len) * 16,
          class: "vertex-label",
          "text-anchor": "middle",
          "dominant-baseline": "middle",
        })
      );
    }

    // length label, offset away from the apex
    const mid = midpoint(cp.P1, cp.P2);
    const apexPt = this.points[cp.apex];
    const away = { x: mid.x - apexPt.x, y: mid.y - apexPt.y };
    const awayLen = Math.hypot(away.x, away.y) || 1;
    const labelPos = { x: mid.x + (away.x / awayLen) * 16, y: mid.y + (away.y / awayLen) * 16 };
    const hidden = this.cevianLengthOverride === "";
    const lengthUnits = round1(dist(cp.P1, cp.P2) / PX_PER_UNIT);
    const displayValue = this.cevianLengthOverride !== undefined ? this.cevianLengthOverride : lengthUnits;
    g.appendChild(
      renderRemovableLabel({
        x: labelPos.x,
        y: labelPos.y,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField("cevian-length", ""),
        onRestore: (e) => this.startInlineEdit(e, "cevian-length", lengthUnits),
        onDoubleClick: (e) => this.startInlineEdit(e, "cevian-length", displayValue),
      })
    );

    // drag handle on P1 to steer t interactively
    const handle = el("circle", { cx: cp.P1.x, cy: cp.P1.y, r: 5, class: "drag-handle" });
    handle.addEventListener("pointerdown", (e) => this.onCevianPointerDown(e));
    g.appendChild(handle);
    return g;
  }

  onCevianPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const apex = this.points[this.cevian.apex];
    const n1 = this.points[(this.cevian.apex + 1) % 3];
    const dirLenSq = (n1.x - apex.x) ** 2 + (n1.y - apex.y) ** 2;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const t = ((cur.x - apex.x) * (n1.x - apex.x) + (cur.y - apex.y) * (n1.y - apex.y)) / dirLenSq;
      this.cevian.t = clamp(t, 0.05, 0.95);
      this.render();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (this.controller?.onChange) this.controller.onChange(this);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  renderRotateHandle(centroid) {
    const maxR = Math.max(...this.points.map((p) => dist(p, centroid)));
    const handleR = maxR + 32;
    const pos = { x: centroid.x, y: centroid.y - handleR };
    const g = el("g");
    g.appendChild(
      el("line", {
        x1: centroid.x,
        y1: centroid.y,
        x2: pos.x,
        y2: pos.y,
        class: "rotate-handle-line",
      })
    );
    const handle = el("circle", { cx: pos.x, cy: pos.y, r: 6, class: "rotate-handle" });
    handle.addEventListener("pointerdown", (e) => this.onRotatePointerDown(e, centroid));
    g.appendChild(handle);
    return g;
  }

  renderVertexLabel(i, centroid) {
    const p = this.points[i];
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const len = Math.hypot(dx, dy) || 1;
    const offset = scaled(this.extentPx(), 20);
    const t = text(this.labels[i], {
      x: p.x + (dx / len) * offset,
      y: p.y + (dy / len) * offset,
      class: "vertex-label",
      "text-anchor": "middle",
      "dominant-baseline": "middle",
    });
    return t;
  }

  renderVertexHandle(i) {
    const p = this.points[i];
    const c = el("circle", { cx: p.x, cy: p.y, r: 6, class: "vertex-handle" });
    c.addEventListener("pointerdown", (e) => this.onVertexPointerDown(e, i));
    return c;
  }

  // --- interaction ---------------------------------------------------------

  onBodyPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const start = toSvgPoint(svg, e.clientX, e.clientY);
    const startPoints = this.points.map((p) => ({ ...p }));
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      this.points = startPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      const nudge = this.controller?.snapNudge?.(this);
      if (nudge) this.points = this.points.map((p) => ({ x: p.x + nudge.dx, y: p.y + nudge.dy }));
      this.render();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (this.controller?.onChange) this.controller.onChange(this);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  onVertexPointerDown(e, i) {
    e.stopPropagation();
    this.select();
    // Dragging a vertex directly overrides any lock tied to it -- otherwise the
    // next typed edit elsewhere would silently snap it back to the locked value.
    this.clearAngleLock(i);
    this.clearSideLock(i);
    this.clearSideLock((i + 2) % 3);
    const svg = this.group.ownerSVGElement;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      this.points[i] = cur;
      this.render();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (this.controller?.onChange) this.controller.onChange(this);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  onRotatePointerDown(e, centroid) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const startPoints = this.points.map((p) => ({ ...p }));
    const startMouse = toSvgPoint(svg, e.clientX, e.clientY);
    const startDeg = (Math.atan2(startMouse.y - centroid.y, startMouse.x - centroid.x) * 180) / Math.PI;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const curDeg = (Math.atan2(cur.y - centroid.y, cur.x - centroid.x) * 180) / Math.PI;
      const delta = curDeg - startDeg;
      this.points = startPoints.map((p) => rotatePoint(p, centroid, delta));
      this.render();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (this.controller?.onChange) this.controller.onChange(this);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  select() {
    if (this.controller?.onSelect) this.controller.onSelect(this);
  }

  setSelected(v) {
    this.selected = v;
    this.render();
  }

  startInlineEdit(e, fieldKey, currentValue) {
    e.stopPropagation();
    if (this.controller?.onInlineEdit) {
      this.controller.onInlineEdit(this, fieldKey, currentValue, e);
    }
  }
}
