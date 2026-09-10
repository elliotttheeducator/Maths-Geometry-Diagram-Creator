import { round1, nextId, PX_PER_UNIT, clamp, midpoint } from "../geometry.js";
import { el, text, clear, toSvgPoint, renderRemovableLabel } from "../svgUtil.js";
import { parseFieldInput } from "../fieldInput.js";
import { paletteEntry } from "../palette.js";
import { applyLabelScale, gap, extentOf, labelOffset, spreadLabels } from "../labelScale.js";

const DEG = Math.PI / 180;
const VERTEX_NAMES = "ABCDEFGHIJKL";

// A regular n-gon (pentagon, hexagon, octagon...) held as a centre plus a
// circumradius. Every side is equal and every interior angle is (n-2)*180/n by
// construction, so the tick marks and the quoted angle are always honest -- typing
// a side length just solves the radius that produces it.
export class RegularPolygon {
  constructor({ center, sides = 5, radiusPx = 110, rotationDeg = 0, id } = {}) {
    this.id = id || nextId("polygon");
    this.type = "polygon";
    this.center = center || { x: 500, y: 350 };
    this.sides = clamp(Math.round(sides), 3, 12);
    this.radiusPx = radiusPx;
    this.rotationDeg = rotationDeg;
    this.fillId = "blue";
    this.showLabels = false;
    this.showTicks = true;
    this.showInteriorAngle = false;
    this.overrides = {}; // side | angle -> "" hidden, or custom text
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  // Vertices run clockwise on screen from a start angle chosen so the polygon
  // always sits on a flat bottom edge, whatever n is.
  vertices() {
    const n = this.sides;
    const start = 90 + 180 / n + this.rotationDeg;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (start + (k * 360) / n) * DEG;
      pts.push({
        x: this.center.x + this.radiusPx * Math.cos(a),
        y: this.center.y + this.radiusPx * Math.sin(a),
      });
    }
    return pts;
  }

  sideUnits() {
    return (2 * this.radiusPx * Math.sin(Math.PI / this.sides)) / PX_PER_UNIT;
  }

  radiusUnits() {
    return this.radiusPx / PX_PER_UNIT;
  }

  apothemUnits() {
    return (this.radiusPx * Math.cos(Math.PI / this.sides)) / PX_PER_UNIT;
  }

  interiorAngleDeg() {
    return ((this.sides - 2) * 180) / this.sides;
  }

  areaUnits() {
    const r = this.radiusUnits();
    return 0.5 * this.sides * r * r * Math.sin((2 * Math.PI) / this.sides);
  }

  setSideLength(units) {
    const px = Math.max(10, units * PX_PER_UNIT);
    this.radiusPx = px / (2 * Math.sin(Math.PI / this.sides));
    this.notifyChange();
  }

  setRadius(units) {
    this.radiusPx = Math.max(10, units * PX_PER_UNIT);
    this.notifyChange();
  }

  translate(dx, dy) {
    this.center = { x: this.center.x + dx, y: this.center.y + dy };
    this.notifyChange();
  }

  // Snapping / "turn into prism" both work off the outline.
  snapPoints() {
    const v = this.vertices();
    return [...v, ...v.map((p, i) => midpoint(p, v[(i + 1) % v.length]))];
  }

  outline() {
    return this.vertices();
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  // --- sidebar -----------------------------------------------------------

  getFields() {
    const val = (name, computed) => (this.overrides[name] !== undefined ? this.overrides[name] : round1(computed));
    return [
      { key: "sides", group: "Shape", label: "Sides", kind: "angle", value: this.sides },
      { key: "side", group: "Measurements", label: "Side length", kind: "length", value: val("side", this.sideUnits()) },
      { key: "radius", group: "Measurements", label: "Radius", kind: "length", value: round1(this.radiusUnits()) },
      {
        key: "interior",
        group: "Measurements",
        label: "Interior angle",
        kind: "angle",
        readOnly: true,
        value: round1(this.interiorAngleDeg()),
      },
      { key: "area", group: "Measurements", label: "Area", kind: "length", readOnly: true, value: round1(this.areaUnits()) },
      { key: "rotation", group: "Appearance", label: "Rotation", kind: "angle", value: round1(this.rotationDeg) },
      { key: "fill", group: "Appearance", label: "Fill", kind: "swatch", value: this.fillId },
      { key: "show-ticks", group: "Appearance", label: "Equal-side ticks", kind: "toggle", value: this.showTicks },
      {
        key: "show-interior",
        group: "Appearance",
        label: "Mark interior angle",
        kind: "toggle",
        value: this.showInteriorAngle,
      },
      { key: "show-labels", group: "Appearance", label: "Vertex labels", kind: "toggle", value: this.showLabels },
    ];
  }

  setField(key, value) {
    if (key === "fill") {
      this.fillId = value;
      this.notifyChange();
      return;
    }
    if (key === "show-ticks") {
      this.showTicks = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "show-labels") {
      this.showLabels = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "show-interior") {
      this.showInteriorAngle = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "sides") {
      this.sides = clamp(Math.round(Number(value) || 5), 3, 12);
      this.notifyChange();
      return;
    }
    if (key === "rotation") {
      this.rotationDeg = Number(value) || 0;
      this.notifyChange();
      return;
    }
    if (key === "interior" || key === "area") return; // derived

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
    if (key === "side") this.setSideLength(parsed.numeric);
    else if (key === "radius") this.setRadius(parsed.numeric);
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

  extentPx() {
    return this.radiusPx * 2;
  }

  render() {
    if (!this.group) return;
    clear(this.group);
    applyLabelScale(this.group, this.extentPx());
    const pts = this.vertices();

    const poly = el("polygon", {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      class: `shape-poly${this.selected ? " selected" : ""}`,
      fill: paletteEntry(this.fillId).fill,
    });
    poly.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    this.group.appendChild(poly);

    if (this.showTicks) this.renderTicks(pts);
    if (this.showInteriorAngle) this.renderInteriorAngle(pts);
    this.renderSideLabel(pts);
    if (this.showLabels) this.renderVertexLabels(pts);
    this.renderHandles(pts);
 
    spreadLabels(this.group, this.extentPx());
  }

  // One tick on every side -- the notation that says "all of these are equal".
  renderTicks(pts) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mid = midpoint(a, b);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      this.group.appendChild(
        el("line", {
          x1: mid.x + nx * 5,
          y1: mid.y + ny * 5,
          x2: mid.x - nx * 5,
          y2: mid.y - ny * 5,
          class: "equal-length-tick",
        })
      );
    }
  }

  renderInteriorAngle(pts) {
    const V = pts[0];
    const u1 = unitTo(V, pts[pts.length - 1]);
    const u2 = unitTo(V, pts[1]);
    const r = 24;
    const p1 = { x: V.x + u1.x * r, y: V.y + u1.y * r };
    const p2 = { x: V.x + u2.x * r, y: V.y + u2.y * r };
    const cross = u1.x * u2.y - u1.y * u2.x;
    this.group.appendChild(
      el("path", {
        d: `M ${p1.x} ${p1.y} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${p2.x} ${p2.y}`,
        class: "angle-arc",
      })
    );

    const override = this.overrides.angle;
    const hidden = override === "";
    const computed = `${round1(this.interiorAngleDeg())}°`;
    const displayValue = override !== undefined && override !== "" ? override : computed;
    const bx = (u1.x + u2.x) / 2;
    const by = (u1.y + u2.y) / 2;
    const blen = Math.hypot(bx, by) || 1;
    const angOff = labelOffset(displayValue, this.extentPx(), bx / blen, by / blen, 8);
    this.group.appendChild(
      renderRemovableLabel({
        x: V.x + (bx / blen) * (r + angOff),
        y: V.y + (by / blen) * (r + angOff),
        value: displayValue,
        hidden,
        cssClass: "angle-label",
        onRemove: () => this.setField("angle", ""),
        onRestore: (e) => this.startInlineEdit(e, "angle", round1(this.interiorAngleDeg())),
        onDoubleClick: (e) => this.startInlineEdit(e, "angle", displayValue),
      })
    );
  }

  // Every side is the same length, so one label on the bottom edge says it all.
  renderSideLabel(pts) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const mid = midpoint(a, b);
    const dx = mid.x - this.center.x;
    const dy = mid.y - this.center.y;
    const len = Math.hypot(dx, dy) || 1;

    const override = this.overrides.side;
    const hidden = override === "";
    const computed = round1(this.sideUnits());
    const displayValue = override !== undefined && override !== "" ? override : computed;
    const off = labelOffset(displayValue, this.extentPx(), dx / len, dy / len);
    this.group.appendChild(
      renderRemovableLabel({
        x: mid.x + (dx / len) * off,
        y: mid.y + (dy / len) * off,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField("side", ""),
        onRestore: (e) => this.startInlineEdit(e, "side", computed),
        onDoubleClick: (e) => this.startInlineEdit(e, "side", displayValue),
      })
    );
  }

  renderVertexLabels(pts) {
    pts.forEach((p, i) => {
      const dx = p.x - this.center.x;
      const dy = p.y - this.center.y;
      const len = Math.hypot(dx, dy) || 1;
      this.group.appendChild(
        text(VERTEX_NAMES[i] || `P${i + 1}`, {
          x: p.x + (dx / len) * 18,
          y: p.y + (dy / len) * 18,
          class: "vertex-label",
          "text-anchor": "middle",
          "dominant-baseline": "middle",
        })
      );
    });
  }

  renderHandles(pts) {
    // One handle on the first vertex: dragging it sizes and spins the polygon.
    const h = el("circle", { cx: pts[0].x, cy: pts[0].y, r: 6, class: "vertex-handle" });
    h.addEventListener("pointerdown", (e) => this.onVertexPointerDown(e));
    this.group.appendChild(h);
  }

  // --- interaction -------------------------------------------------------

  onBodyPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const start = toSvgPoint(svg, e.clientX, e.clientY);
    const startCenter = { ...this.center };
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      this.center = { x: startCenter.x + (cur.x - start.x), y: startCenter.y + (cur.y - start.y) };
      const nudge = this.controller?.snapNudge?.(this);
      if (nudge) this.center = { x: this.center.x + nudge.dx, y: this.center.y + nudge.dy };
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

  onVertexPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const baseAngle = 90 + 180 / this.sides;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const dx = cur.x - this.center.x;
      const dy = cur.y - this.center.y;
      this.radiusPx = Math.max(15, Math.hypot(dx, dy));
      this.rotationDeg = round1((Math.atan2(dy, dx) * 180) / Math.PI - baseAngle);
      delete this.overrides.side;
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

function unitTo(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
