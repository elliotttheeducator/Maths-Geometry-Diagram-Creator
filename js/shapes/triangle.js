import {
  dist,
  angleAtVertex,
  signedAngleAtVertex,
  rotatePoint,
  pointOnRay,
  midpoint,
  round1,
  nextId,
  PX_PER_UNIT,
  clamp,
} from "../geometry.js";
import { el, text, clear, toSvgPoint } from "../svgUtil.js";

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

  setAngle(vertexIndex, newDeg) {
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
    this.notifyChange();
  }

  setSideLength(sideIndex, newLengthUnits) {
    const newLenPx = Math.max(10, newLengthUnits * PX_PER_UNIT);
    const fromIdx = sideIndex;
    const toIdx = (sideIndex + 1) % 3;
    const from = this.points[fromIdx];
    const to = this.points[toIdx];
    this.points[toIdx] = pointOnRay(from, to, newLenPx);
    this.notifyChange();
  }

  setLabel(vertexIndex, newLabel) {
    this.labels[vertexIndex] = newLabel.slice(0, 4) || this.labels[vertexIndex];
    this.notifyChange();
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
        value: round1(angles[i]),
      });
    }
    for (let i = 0; i < 3; i++) {
      fields.push({
        key: `side-${i}`,
        group: "Side lengths",
        label: sideNames[i],
        kind: "length",
        value: round1(sides[i] / PX_PER_UNIT),
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

  setField(key, value) {
    if (key === "scale-factor") {
      this.applyScale(Number(value));
      return;
    }
    const [kind, idxStr] = key.split("-");
    const idx = Number(idxStr);
    if (kind === "angle") this.setAngle(idx, Number(value));
    else if (kind === "side") this.setSideLength(idx, Number(value));
    else if (kind === "label") this.setLabel(idx, String(value));
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

  render() {
    if (!this.group) return;
    clear(this.group);
    const [A, B, C] = this.points;
    const centroid = this.centroid();
    const angles = this.angles();

    const poly = el("polygon", {
      points: `${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`,
      class: `shape-poly${this.selected ? " selected" : ""}`,
    });
    poly.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    this.group.appendChild(poly);

    // angle arcs / right-angle markers
    for (let i = 0; i < 3; i++) {
      this.group.appendChild(this.renderAngleMark(i, angles[i]));
    }

    // side length labels
    for (let i = 0; i < 3; i++) {
      const from = this.points[i];
      const to = this.points[(i + 1) % 3];
      this.group.appendChild(this.renderSideLabel(i, from, to, centroid));
    }

    // vertex handles + labels
    for (let i = 0; i < 3; i++) {
      this.group.appendChild(this.renderVertexLabel(i, centroid));
      this.group.appendChild(this.renderVertexHandle(i));
    }
  }

  renderAngleMark(i, angleDeg) {
    const V = this.points[i];
    const F = this.points[(i + 2) % 3];
    const R = this.points[(i + 1) % 3];
    const isRight = Math.abs(angleDeg - 90) < RIGHT_ANGLE_TOLERANCE;

    const dirF = Math.atan2(F.y - V.y, F.x - V.x);
    const dirR = Math.atan2(R.y - V.y, R.x - V.x);

    if (isRight) {
      const size = 14;
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

    const r = 22;
    let diff = ((dirR - dirF + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const sweepFlag = diff > 0 ? 1 : 0;
    const start = { x: V.x + r * Math.cos(dirF), y: V.y + r * Math.sin(dirF) };
    const end = { x: V.x + r * Math.cos(dirR), y: V.y + r * Math.sin(dirR) };
    const path = el("path", {
      d: `M ${start.x} ${start.y} A ${r} ${r} 0 0 ${sweepFlag} ${end.x} ${end.y}`,
      class: "angle-arc",
    });

    const bisector = dirF + diff / 2;
    const labelR = r + 16;
    const lp = { x: V.x + labelR * Math.cos(bisector), y: V.y + labelR * Math.sin(bisector) };
    const group = el("g");
    group.appendChild(path);
    group.appendChild(
      text(`${round1(angleDeg)}°`, {
        x: lp.x,
        y: lp.y,
        class: "angle-label",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      })
    );
    group.lastChild.addEventListener("pointerdown", (e) => e.stopPropagation());
    group.lastChild.addEventListener("dblclick", (e) => this.startInlineEdit(e, `angle-${i}`, angleDeg));
    return group;
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
    const offset = 16;
    const lengthUnits = round1(dist(from, to) / PX_PER_UNIT);
    const t = text(lengthUnits, {
      x: mid.x + nx * offset,
      y: mid.y + ny * offset,
      class: "side-label",
      "text-anchor": "middle",
      "dominant-baseline": "middle",
    });
    t.addEventListener("pointerdown", (e) => e.stopPropagation());
    t.addEventListener("dblclick", (e) => this.startInlineEdit(e, `side-${i}`, lengthUnits));
    return t;
  }

  renderVertexLabel(i, centroid) {
    const p = this.points[i];
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const len = Math.hypot(dx, dy) || 1;
    const offset = 20;
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
