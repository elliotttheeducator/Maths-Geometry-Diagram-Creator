import { round1, nextId, PX_PER_UNIT, clamp, midpoint } from "../geometry.js";
import { el, clear, toSvgPoint, renderRemovableLabel } from "../svgUtil.js";
import { parseFieldInput } from "../fieldInput.js";
import { faceFill } from "../palette.js";

const DEG = Math.PI / 180;

// A prism drawn in oblique projection: any flat base polygon, plus a depth vector
// that offsets a copy of it behind. Faces are filled with three tints of one hue
// (front lightest, top mid, side darkest) -- that shading is what makes a flat
// drawing read as a solid, and it's how the textbook diagrams do it.
//
// The base can be a rectangle, triangle, parallelogram or regular polygon, or an
// arbitrary outline handed over from a 2D shape via "Turn into prism".
export class Prism {
  constructor({
    origin,
    widthPx = 220,
    heightPx = 130,
    depthPx = 90,
    depthAngleDeg = -32,
    baseKind = "rectangle",
    slantDeg = 65,
    sides = 6,
    radiusPx = 90,
    customPoints = null,
    id,
  } = {}) {
    this.id = id || nextId("prism");
    this.type = "prism";
    this.origin = origin || { x: 380, y: 450 }; // front face, bottom-left of its bounding box
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.depthPx = depthPx;
    this.depthAngleDeg = depthAngleDeg;
    this.baseKind = baseKind; // rectangle | triangle | parallelogram | polygon | custom
    this.slantDeg = slantDeg;
    this.sides = sides;
    this.radiusPx = radiusPx;
    this.customPoints = customPoints; // local coords, used when baseKind === "custom"
    this.fillId = "green";
    this.showHiddenEdges = false;
    this.showApexHeight = false;
    this.overrides = {};
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  depthVector() {
    return {
      x: this.depthPx * Math.cos(this.depthAngleDeg * DEG),
      y: this.depthPx * Math.sin(this.depthAngleDeg * DEG),
    };
  }

  // Any 2D outline (absolute canvas points) becomes a prism with that outline as its
  // base -- this is what the "Turn into prism" button hands over.
  static fromOutline(points) {
    const minX = Math.min(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    return new Prism({
      origin: { x: minX, y: maxY },
      baseKind: "custom",
      customPoints: points.map((p) => ({ x: p.x - minX, y: p.y - maxY })),
    });
  }

  // Base outline in local coordinates, bottom-left of its bounding box at (0,0), and
  // always wound the same way so the "outward" test in render() culls the right faces
  // whatever the base is.
  basePolygonLocal() {
    return windOutward(this.baseOutlineLocal());
  }

  baseOutlineLocal() {
    if (this.baseKind === "custom" && this.customPoints?.length >= 3) return this.customPoints;
    if (this.baseKind === "triangle") {
      return [
        { x: 0, y: 0 },
        { x: this.widthPx, y: 0 },
        { x: this.widthPx / 2, y: -this.heightPx },
      ];
    }
    if (this.baseKind === "parallelogram") {
      const sx = this.heightPx * Math.cos(-this.slantDeg * DEG);
      const sy = this.heightPx * Math.sin(-this.slantDeg * DEG);
      const pts = [
        { x: 0, y: 0 },
        { x: this.widthPx, y: 0 },
        { x: this.widthPx + sx, y: sy },
        { x: sx, y: sy },
      ];
      const minX = Math.min(...pts.map((p) => p.x));
      return pts.map((p) => ({ x: p.x - minX, y: p.y }));
    }
    if (this.baseKind === "polygon") {
      // Start angle chosen so the polygon sits on a flat bottom edge.
      const n = this.sides;
      const start = 90 + 180 / n;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = (start + (k * 360) / n) * DEG;
        pts.push({ x: this.radiusPx * Math.cos(a), y: this.radiusPx * Math.sin(a) });
      }
      const minX = Math.min(...pts.map((p) => p.x));
      const maxY = Math.max(...pts.map((p) => p.y));
      return pts.map((p) => ({ x: p.x - minX, y: p.y - maxY }));
    }
    return [
      { x: 0, y: 0 },
      { x: this.widthPx, y: 0 },
      { x: this.widthPx, y: -this.heightPx },
      { x: 0, y: -this.heightPx },
    ];
  }

  frontFace() {
    return this.basePolygonLocal().map((p) => ({ x: this.origin.x + p.x, y: this.origin.y + p.y }));
  }

  backFace() {
    const d = this.depthVector();
    return this.frontFace().map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
  }

  widthUnits() {
    return this.widthPx / PX_PER_UNIT;
  }
  heightUnits() {
    return this.heightPx / PX_PER_UNIT;
  }
  depthUnits() {
    return this.depthPx / PX_PER_UNIT;
  }

  // Side length of a regular-polygon base -- the measurement that's actually quoted
  // in a question, where the circumradius almost never is.
  baseSideUnits() {
    return (2 * this.radiusPx * Math.sin(Math.PI / this.sides)) / PX_PER_UNIT;
  }

  // Shoelace on the base outline -- one formula that covers every base kind,
  // including an arbitrary outline handed over from another shape.
  baseAreaUnits() {
    const pts = this.basePolygonLocal();
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum / 2) / (PX_PER_UNIT * PX_PER_UNIT);
  }

  volumeUnits() {
    return this.baseAreaUnits() * this.depthUnits();
  }

  // --- editing -----------------------------------------------------------

  translate(dx, dy) {
    this.origin = { x: this.origin.x + dx, y: this.origin.y + dy };
    this.notifyChange();
  }

  snapPoints() {
    return [...this.frontFace(), ...this.backFace()];
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  getFields() {
    const val = (name, computed) => (this.overrides[name] !== undefined ? this.overrides[name] : round1(computed));
    const fields = [];
    const kinds = [
      ["rectangle", "Rectangular"],
      ["triangle", "Triangular"],
      ["parallelogram", "Parallelogram"],
      ["polygon", "Polygon"],
    ];
    if (this.baseKind === "custom") {
      fields.push({ key: "base-info", group: "Base", label: "Base", kind: "info", value: "Custom outline" });
    }
    for (const [id, label] of kinds) {
      fields.push({ key: `base-${id}`, group: "Base", label, kind: "toggle", value: this.baseKind === id });
    }

    if (this.baseKind === "polygon") {
      fields.push({ key: "sides", group: "Base", label: "Sides", kind: "angle", value: this.sides });
      fields.push({ key: "side", group: "Measurements", label: "Side", kind: "length", value: val("side", this.baseSideUnits()) });
      fields.push({ key: "radius", group: "Measurements", label: "Radius", kind: "length", value: val("radius", this.radiusPx / PX_PER_UNIT) });
    } else if (this.baseKind !== "custom") {
      fields.push({ key: "width", group: "Measurements", label: "Width", kind: "length", value: val("width", this.widthUnits()) });
      fields.push({ key: "height", group: "Measurements", label: "Height", kind: "length", value: val("height", this.heightUnits()) });
      if (this.baseKind === "parallelogram") {
        fields.push({ key: "slant", group: "Measurements", label: "Base angle", kind: "angle", value: round1(this.slantDeg) });
      }
    }
    fields.push({ key: "depth", group: "Measurements", label: "Depth", kind: "length", value: val("depth", this.depthUnits()) });
    fields.push({
      key: "volume",
      group: "Measurements",
      label: "Volume",
      kind: "length",
      readOnly: true,
      value: round1(this.volumeUnits()),
    });
    if (this.baseKind === "triangle") {
      fields.push({
        key: "show-apex-height",
        group: "Measurements",
        label: "Show perp. height",
        kind: "toggle",
        value: this.showApexHeight,
      });
    }
    fields.push({ key: "fill", group: "Appearance", label: "Fill", kind: "swatch", value: this.fillId });
    fields.push({
      key: "depth-angle",
      group: "Appearance",
      label: "Depth angle",
      kind: "angle",
      value: round1(Math.abs(this.depthAngleDeg)),
    });
    fields.push({
      key: "hidden-edges",
      group: "Appearance",
      label: "Show hidden edges",
      kind: "toggle",
      value: this.showHiddenEdges,
    });
    return fields;
  }

  setField(key, value) {
    if (key.startsWith("base-") && key !== "base-info") {
      if (value) {
        this.baseKind = key.slice(5);
        this.customPoints = null;
      }
      this.notifyChange();
      return;
    }
    if (key === "fill") {
      this.fillId = value;
      this.notifyChange();
      return;
    }
    if (key === "hidden-edges") {
      this.showHiddenEdges = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "show-apex-height") {
      this.showApexHeight = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "sides") {
      this.sides = clamp(Math.round(Number(value) || 6), 3, 12);
      this.notifyChange();
      return;
    }
    if (key === "slant") {
      this.slantDeg = clamp(Number(value) || 65, 15, 165);
      this.notifyChange();
      return;
    }
    if (key === "depth-angle") {
      this.depthAngleDeg = -clamp(Math.abs(Number(value) || 32), 10, 70);
      this.notifyChange();
      return;
    }
    if (key === "volume" || key === "base-info") return;

    const parsed = parseFieldInput(value);
    if (parsed.hidden) {
      this.overrides[key] = "";
      this.notifyChange();
      return;
    }
    if (parsed.label !== undefined) {
      this.overrides[key] = parsed.label;
      this.notifyChange();
      return;
    }
    delete this.overrides[key];
    const px = Math.max(20, parsed.numeric * PX_PER_UNIT);
    if (key === "width") this.widthPx = px;
    else if (key === "height") this.heightPx = px;
    else if (key === "depth") this.depthPx = px;
    else if (key === "radius") this.radiusPx = px;
    else if (key === "side") this.radiusPx = px / (2 * Math.sin(Math.PI / this.sides));
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
    const front = this.frontFace();
    const back = this.backFace();
    const d = this.depthVector();
    const cls = `shape-poly${this.selected ? " selected" : ""}`;
    const poly = (pts, fill) =>
      el("polygon", { points: pts.map((p) => `${p.x},${p.y}`).join(" "), class: cls, fill });

    // An edge's extruded quad faces the viewer exactly when the depth vector points
    // outward across it, which culls the bottom and far-side faces automatically at
    // any depth angle.
    const visibleEdge = front.map((a, i) => {
      const b = front[(i + 1) % front.length];
      const edge = { x: b.x - a.x, y: b.y - a.y };
      return edge.x * d.y - edge.y * d.x > 0;
    });

    const cy = front.reduce((s, p) => s + p.y, 0) / front.length;
    for (let i = 0; i < front.length; i++) {
      if (!visibleEdge[i]) continue;
      const a = front[i];
      const b = front[(i + 1) % front.length];
      const edge = { x: b.x - a.x, y: b.y - a.y };
      const quad = [a, b, { x: b.x + d.x, y: b.y + d.y }, { x: a.x + d.x, y: a.y + d.y }];
      // A roughly-horizontal edge above the face's middle reads as a top; everything
      // else is a side and takes the darker tint.
      const isTop = Math.abs(edge.x) > Math.abs(edge.y) && (a.y + b.y) / 2 < cy;
      this.group.appendChild(poly(quad, faceFill(this.fillId, isTop ? "top" : "side")));
    }

    const frontPoly = poly(front, faceFill(this.fillId, "front"));
    frontPoly.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    this.group.appendChild(frontPoly);

    // Hidden edges go on TOP of the opaque faces -- drawn underneath they'd simply be
    // painted over. An edge is hidden when no visible face uses it: a back edge whose
    // own quad is culled, or a connecting edge with a culled quad on both sides.
    if (this.showHiddenEdges) {
      const n = front.length;
      for (let i = 0; i < n; i++) {
        if (!visibleEdge[i]) {
          const a = back[i];
          const b = back[(i + 1) % n];
          this.group.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "hidden-edge" }));
        }
        const prev = (i - 1 + n) % n;
        if (!visibleEdge[i] && !visibleEdge[prev]) {
          this.group.appendChild(
            el("line", { x1: front[i].x, y1: front[i].y, x2: back[i].x, y2: back[i].y, class: "hidden-edge" })
          );
        }
      }
    }

    if (this.baseKind === "triangle" && this.showApexHeight) this.renderApexHeight(front);

    this.renderMeasurements(front, back);
    this.renderHandles(front, back);
  }

  renderApexHeight(front) {
    const apex = front[2];
    const foot = { x: apex.x, y: this.origin.y };
    this.group.appendChild(
      el("line", { x1: apex.x, y1: apex.y, x2: foot.x, y2: foot.y, class: "construction-line" })
    );
    const s = 11;
    this.group.appendChild(
      el("path", {
        d: `M ${foot.x + s} ${foot.y} L ${foot.x + s} ${foot.y - s} L ${foot.x} ${foot.y - s}`,
        class: "right-angle-mark",
      })
    );
  }

  renderMeasurements(front, back) {
    if (this.baseKind === "rectangle" || this.baseKind === "triangle" || this.baseKind === "parallelogram") {
      const bottomLeft = front[0];
      const bottomRight = front[1];
      this.measureLabel("width", midpoint(bottomLeft, bottomRight), { x: 0, y: 26 }, this.widthUnits());
      if (this.baseKind === "triangle") {
        const apex = front[2];
        this.measureLabel("height", midpoint({ x: apex.x, y: this.origin.y }, apex), { x: 22, y: 0 }, this.heightUnits());
      } else {
        this.measureLabel("height", midpoint(front[1], front[2]), { x: 26, y: 0 }, this.heightUnits());
      }
      const depthMid = midpoint(bottomRight, back[1]);
      this.measureLabel("depth", depthMid, { x: 20, y: 14 }, this.depthUnits());
      return;
    }
    // Polygon / custom bases: label the depth off the rightmost front vertex, and
    // (for regular polygons) one base edge.
    let far = front[0];
    for (const p of front) if (p.x > far.x) far = p;
    const idx = front.indexOf(far);
    this.measureLabel("depth", midpoint(far, back[idx]), { x: 20, y: 14 }, this.depthUnits());
    if (this.baseKind === "polygon") {
      const a = front[0];
      const b = front[1];
      const sideUnits = Math.hypot(b.x - a.x, b.y - a.y) / PX_PER_UNIT;
      this.measureLabel("side", midpoint(a, b), { x: 0, y: 24 }, sideUnits);
    }
  }

  measureLabel(key, at, offset, computedUnits) {
    const override = this.overrides[key];
    const hidden = override === "";
    const computed = round1(computedUnits);
    const displayValue = override !== undefined && override !== "" ? override : computed;
    this.group.appendChild(
      renderRemovableLabel({
        x: at.x + offset.x,
        y: at.y + offset.y,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField(key, ""),
        onRestore: (e) => this.startInlineEdit(e, key, computed),
        onDoubleClick: (e) => this.startInlineEdit(e, key, displayValue),
      })
    );
  }

  renderHandles(front, back) {
    if (this.baseKind === "rectangle" || this.baseKind === "triangle" || this.baseKind === "parallelogram") {
      const wh = el("circle", { cx: front[1].x, cy: front[1].y, r: 6, class: "vertex-handle" });
      wh.addEventListener("pointerdown", (e) => this.onSizePointerDown(e, "width"));
      this.group.appendChild(wh);

      const hh = el("circle", { cx: front[2].x, cy: front[2].y, r: 6, class: "vertex-handle" });
      hh.addEventListener("pointerdown", (e) => this.onSizePointerDown(e, "height"));
      this.group.appendChild(hh);
    }
    let far = front[0];
    for (const p of front) if (p.x > far.x) far = p;
    const idx = front.indexOf(far);
    const dh = el("circle", { cx: back[idx].x, cy: back[idx].y, r: 6, class: "drag-handle" });
    dh.addEventListener("pointerdown", (e) => this.onSizePointerDown(e, "depth"));
    this.group.appendChild(dh);
  }

  // --- interaction -------------------------------------------------------

  onBodyPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const start = toSvgPoint(svg, e.clientX, e.clientY);
    const startOrigin = { ...this.origin };
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      this.origin = { x: startOrigin.x + (cur.x - start.x), y: startOrigin.y + (cur.y - start.y) };
      const nudge = this.controller?.snapNudge?.(this);
      if (nudge) this.origin = { x: this.origin.x + nudge.dx, y: this.origin.y + nudge.dy };
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

  onSizePointerDown(e, which) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      if (which === "width") {
        this.widthPx = Math.max(20, cur.x - this.origin.x);
        delete this.overrides.width;
      } else if (which === "height") {
        this.heightPx = Math.max(20, this.origin.y - cur.y);
        delete this.overrides.height;
      } else {
        const front = this.frontFace();
        let far = front[0];
        for (const p of front) if (p.x > far.x) far = p;
        const dx = cur.x - far.x;
        const dy = cur.y - far.y;
        this.depthPx = clamp(Math.hypot(dx, dy), 20, 400);
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
        this.depthAngleDeg = -clamp(Math.abs(deg), 10, 70) * (deg < 0 ? 1 : -1);
        delete this.overrides.depth;
      }
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
    if (this.controller?.onInlineEdit) this.controller.onInlineEdit(this, fieldKey, currentValue, e);
  }
}

// The face-culling test in render() only works if every base is wound the same way
// round. Rectangles, triangles and parallelograms are built with a negative shoelace
// sum; regular polygons and outlines handed over from other shapes may come either
// way, so reverse the ones that don't match.
function windOutward(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum > 0 ? [...pts].reverse() : pts;
}
