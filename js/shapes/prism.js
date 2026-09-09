import { round1, nextId, PX_PER_UNIT, clamp, midpoint } from "../geometry.js";
import { el, text, clear, toSvgPoint, renderRemovableLabel } from "../svgUtil.js";
import { parseFieldInput } from "../fieldInput.js";
import { faceFill } from "../palette.js";

const DEG = Math.PI / 180;

// A prism drawn in oblique projection: a flat front face, plus a depth vector that
// offsets a copy of it behind. Faces are filled with three tints of one hue (front
// lightest, top mid, side darkest) -- that shading is what makes a flat drawing read
// as a solid, and it's exactly how the textbook diagrams do it.
export class Prism {
  constructor({
    origin,
    widthPx = 220,
    heightPx = 130,
    depthPx = 90,
    depthAngleDeg = -32,
    base = "rectangle",
    id,
  } = {}) {
    this.id = id || nextId("prism");
    this.type = "prism";
    this.origin = origin || { x: 380, y: 450 }; // front face, bottom-left
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.depthPx = depthPx;
    this.depthAngleDeg = depthAngleDeg;
    this.base = base; // "rectangle" | "triangle"
    this.fillId = "green";
    this.showHiddenEdges = false;
    this.showApexHeight = false; // triangular prism's perpendicular height
    this.overrides = {}; // width | height | depth -> "" hidden, or custom text
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

  // Front-face outline, anticlockwise from the bottom-left.
  frontFace() {
    const o = this.origin;
    if (this.base === "triangle") {
      return [
        { x: o.x, y: o.y },
        { x: o.x + this.widthPx, y: o.y },
        { x: o.x + this.widthPx / 2, y: o.y - this.heightPx },
      ];
    }
    return [
      { x: o.x, y: o.y },
      { x: o.x + this.widthPx, y: o.y },
      { x: o.x + this.widthPx, y: o.y - this.heightPx },
      { x: o.x, y: o.y - this.heightPx },
    ];
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

  volumeUnits() {
    const area =
      this.base === "triangle"
        ? 0.5 * this.widthUnits() * this.heightUnits()
        : this.widthUnits() * this.heightUnits();
    return area * this.depthUnits();
  }

  // --- editing -----------------------------------------------------------

  translate(dx, dy) {
    this.origin = { x: this.origin.x + dx, y: this.origin.y + dy };
    this.notifyChange();
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  getFields() {
    const val = (name, computed) => (this.overrides[name] !== undefined ? this.overrides[name] : round1(computed));
    const fields = [
      {
        key: "base-rectangle",
        group: "Shape",
        label: "Rectangular prism",
        kind: "toggle",
        value: this.base === "rectangle",
      },
      {
        key: "base-triangle",
        group: "Shape",
        label: "Triangular prism",
        kind: "toggle",
        value: this.base === "triangle",
      },
    ];
    fields.push({ key: "width", group: "Measurements", label: "Width", kind: "length", value: val("width", this.widthUnits()) });
    fields.push({ key: "height", group: "Measurements", label: "Height", kind: "length", value: val("height", this.heightUnits()) });
    fields.push({ key: "depth", group: "Measurements", label: "Depth", kind: "length", value: val("depth", this.depthUnits()) });
    fields.push({
      key: "volume",
      group: "Measurements",
      label: "Volume",
      kind: "length",
      readOnly: true,
      value: round1(this.volumeUnits()),
    });
    if (this.base === "triangle") {
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
    if (key === "base-rectangle") {
      if (value) this.base = "rectangle";
      this.notifyChange();
      return;
    }
    if (key === "base-triangle") {
      if (value) this.base = "triangle";
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
    if (key === "depth-angle") {
      this.depthAngleDeg = -clamp(Math.abs(Number(value) || 32), 10, 70);
      this.notifyChange();
      return;
    }
    if (key === "volume") return; // derived

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
    const cls = `shape-poly${this.selected ? " selected" : ""}`;
    const poly = (pts, fill) =>
      el("polygon", { points: pts.map((p) => `${p.x},${p.y}`).join(" "), class: cls, fill });

    // Hidden edges first (behind everything), then the far face, then the connecting
    // faces, then the front face on top -- painter's order, so no z-fighting.
    if (this.showHiddenEdges) {
      const hiddenIdx = this.base === "triangle" ? [0] : [0];
      for (const i of hiddenIdx) {
        this.group.appendChild(
          el("line", { x1: front[i].x, y1: front[i].y, x2: back[i].x, y2: back[i].y, class: "hidden-edge" })
        );
      }
      this.group.appendChild(
        el("polygon", {
          points: back.map((p) => `${p.x},${p.y}`).join(" "),
          class: "hidden-edge",
          fill: "none",
        })
      );
    }

    // One extruded quad per front edge. An edge's quad is visible exactly when the
    // depth vector points outward across it -- cross(edge, depth) > 0 for this
    // winding -- which culls the bottom and far-side faces automatically, whichever
    // way the depth vector is angled.
    const d = this.depthVector();
    const cy = front.reduce((s, p) => s + p.y, 0) / front.length;
    for (let i = 0; i < front.length; i++) {
      const a = front[i];
      const b = front[(i + 1) % front.length];
      const edge = { x: b.x - a.x, y: b.y - a.y };
      if (edge.x * d.y - edge.y * d.x <= 0) continue;
      const quad = [a, b, { x: b.x + d.x, y: b.y + d.y }, { x: a.x + d.x, y: a.y + d.y }];
      // A roughly-horizontal edge sitting above the face's middle is a top face;
      // everything else reads as a side, and takes the darker tint.
      const isTop = Math.abs(edge.x) > Math.abs(edge.y) && (a.y + b.y) / 2 < cy;
      this.group.appendChild(poly(quad, faceFill(this.fillId, isTop ? "top" : "side")));
    }

    const frontPoly = poly(front, faceFill(this.fillId, "front"));
    frontPoly.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    this.group.appendChild(frontPoly);

    if (this.base === "triangle" && this.showApexHeight) this.renderApexHeight(front);

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
    const bottomLeft = front[0];
    const bottomRight = front[1];

    // width along the bottom front edge
    this.measureLabel("width", midpoint(bottomLeft, bottomRight), { x: 0, y: 26 }, this.widthUnits());

    // height up the right-hand front edge (or to the apex for a triangular prism)
    if (this.base === "rectangle") {
      const rightMid = midpoint(front[1], front[2]);
      this.measureLabel("height", rightMid, { x: 26, y: 0 }, this.heightUnits());
    } else {
      const apex = front[2];
      this.measureLabel("height", midpoint({ x: apex.x, y: this.origin.y }, apex), { x: 22, y: 0 }, this.heightUnits());
    }

    // depth along the receding edge from the front-bottom-right corner
    const depthMid = midpoint(bottomRight, back[1]);
    this.measureLabel("depth", depthMid, { x: 20, y: 14 }, this.depthUnits());
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
    const wh = el("circle", { cx: front[1].x, cy: front[1].y, r: 6, class: "vertex-handle" });
    wh.addEventListener("pointerdown", (e) => this.onSizePointerDown(e, "width"));
    this.group.appendChild(wh);

    const topPt = this.base === "triangle" ? front[2] : front[2];
    const hh = el("circle", { cx: topPt.x, cy: topPt.y, r: 6, class: "vertex-handle" });
    hh.addEventListener("pointerdown", (e) => this.onSizePointerDown(e, "height"));
    this.group.appendChild(hh);

    const dh = el("circle", { cx: back[1].x, cy: back[1].y, r: 6, class: "drag-handle" });
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
        const dx = cur.x - this.frontFace()[1].x;
        const dy = cur.y - this.frontFace()[1].y;
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
