import { dist, round1, nextId, PX_PER_UNIT, clamp } from "../geometry.js";
import { el, clear, toSvgPoint, renderRemovableLabel } from "../svgUtil.js";
import { parseFieldInput } from "../fieldInput.js";
import { paletteEntry } from "../palette.js";

const DEG = Math.PI / 180;

// Circle, sector (pie wedge) or arc. Radius, angle and arc length are one related
// trio -- arc = radius x angle-in-radians -- so only two are ever independent.
// Typing any one of them solves for the geometry and the third updates to match,
// which is exactly the relationship these questions are usually testing.
export class Circle {
  constructor({ center, radiusPx = 130, mode = "circle", startAngleDeg = -60, sweepDeg = 90, id } = {}) {
    this.id = id || nextId("circle");
    this.type = "circle";
    this.center = center || { x: 500, y: 350 };
    this.radiusPx = radiusPx;
    this.mode = mode; // "circle" | "sector" | "arc"
    this.startAngleDeg = startAngleDeg;
    this.sweepDeg = clamp(sweepDeg, 1, 359);
    this.fillId = "blue";
    this.showRadius = true;
    this.radiusIsDiameter = false;
    this.overrides = {}; // radius | angle | arc -> "" (hidden) or custom label
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  radiusUnits() {
    return this.radiusPx / PX_PER_UNIT;
  }

  arcLengthUnits() {
    return this.radiusUnits() * this.sweepDeg * DEG;
  }

  circumferenceUnits() {
    return 2 * Math.PI * this.radiusUnits();
  }

  pointAt(deg) {
    return {
      x: this.center.x + this.radiusPx * Math.cos(deg * DEG),
      y: this.center.y + this.radiusPx * Math.sin(deg * DEG),
    };
  }

  // --- editing -----------------------------------------------------------

  setRadius(units) {
    this.radiusPx = Math.max(10, units * PX_PER_UNIT);
    this.notifyChange();
  }

  setSweep(deg) {
    this.sweepDeg = clamp(deg, 1, 359);
    this.notifyChange();
  }

  // Solve the trio the other way: hold the radius, and pick the angle that gives
  // this arc length.
  setArcLength(units) {
    const r = this.radiusUnits();
    if (r < 0.01) return;
    this.sweepDeg = clamp((units / r) / DEG, 1, 359);
    this.notifyChange();
  }

  translate(dx, dy) {
    this.center = { x: this.center.x + dx, y: this.center.y + dy };
    this.notifyChange();
  }

  // Centre, the four cardinal points, and (for a sector) the two arc ends -- enough
  // to butt a semicircle onto a rectangle, which is the usual composite.
  snapPoints() {
    const pts = [this.center, ...[0, 90, 180, 270].map((d) => this.pointAt(d))];
    if (this.mode !== "circle") pts.push(this.pointAt(this.startAngleDeg), this.pointAt(this.startAngleDeg + this.sweepDeg));
    return pts;
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  // --- sidebar -----------------------------------------------------------

  getFields() {
    const fields = [
      {
        key: "mode-circle",
        group: "Shape",
        label: "Full circle",
        kind: "toggle",
        value: this.mode === "circle",
      },
      { key: "mode-sector", group: "Shape", label: "Sector", kind: "toggle", value: this.mode === "sector" },
      { key: "mode-arc", group: "Shape", label: "Arc only", kind: "toggle", value: this.mode === "arc" },
    ];

    const radiusOverride = this.overrides.radius;
    fields.push({
      key: "radius",
      group: "Measurements",
      label: this.radiusIsDiameter ? "Diameter" : "Radius",
      kind: "length",
      value:
        radiusOverride !== undefined
          ? radiusOverride
          : round1(this.radiusIsDiameter ? this.radiusUnits() * 2 : this.radiusUnits()),
    });
    fields.push({
      key: "as-diameter",
      group: "Measurements",
      label: "Show as diameter",
      kind: "toggle",
      value: this.radiusIsDiameter,
    });
    fields.push({
      key: "show-radius",
      group: "Measurements",
      label: "Show radius line",
      kind: "toggle",
      value: this.showRadius,
    });

    if (this.mode === "circle") {
      fields.push({
        key: "circumference",
        group: "Measurements",
        label: "Circumference",
        kind: "length",
        readOnly: true,
        value: round1(this.circumferenceUnits()),
      });
    } else {
      const angleOverride = this.overrides.angle;
      fields.push({
        key: "angle",
        group: "Measurements",
        label: "Angle",
        kind: "angle",
        value: angleOverride !== undefined ? angleOverride : round1(this.sweepDeg),
      });
      const arcOverride = this.overrides.arc;
      fields.push({
        key: "arc",
        group: "Measurements",
        label: "Arc length",
        kind: "length",
        value: arcOverride !== undefined ? arcOverride : round1(this.arcLengthUnits()),
      });
    }

    fields.push({ key: "fill", group: "Appearance", label: "Fill", kind: "swatch", value: this.fillId });
    return fields;
  }

  setField(key, value) {
    if (key.startsWith("mode-")) {
      if (value) this.mode = key.slice(5);
      this.notifyChange();
      return;
    }
    if (key === "as-diameter") {
      this.radiusIsDiameter = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "show-radius") {
      this.showRadius = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "fill") {
      this.fillId = value;
      this.notifyChange();
      return;
    }
    if (key === "circumference") return; // derived, display only

    const parsed = parseFieldInput(value);
    const target = key === "radius" ? "radius" : key === "angle" ? "angle" : "arc";
    if (parsed.hidden) {
      this.overrides[target] = "";
      this.notifyChange();
      return;
    }
    if (parsed.label !== undefined) {
      this.overrides[target] = parsed.label;
      this.notifyChange();
      return;
    }
    delete this.overrides[target];
    if (target === "radius") this.setRadius(this.radiusIsDiameter ? parsed.numeric / 2 : parsed.numeric);
    else if (target === "angle") this.setSweep(parsed.numeric);
    else this.setArcLength(parsed.numeric);
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
    const fill = paletteEntry(this.fillId).fill;
    const cls = `shape-poly${this.selected ? " selected" : ""}`;
    const start = this.pointAt(this.startAngleDeg);
    const end = this.pointAt(this.startAngleDeg + this.sweepDeg);
    const largeArc = this.sweepDeg > 180 ? 1 : 0;

    if (this.mode === "circle") {
      const c = el("circle", { cx: this.center.x, cy: this.center.y, r: this.radiusPx, class: cls, fill });
      c.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
      this.group.appendChild(c);
    } else if (this.mode === "sector") {
      const d = `M ${this.center.x} ${this.center.y} L ${start.x} ${start.y} A ${this.radiusPx} ${this.radiusPx} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
      const p = el("path", { d, class: cls, fill });
      p.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
      this.group.appendChild(p);
    } else {
      const d = `M ${start.x} ${start.y} A ${this.radiusPx} ${this.radiusPx} 0 ${largeArc} 1 ${end.x} ${end.y}`;
      const p = el("path", { d, class: `shape-line${this.selected ? " selected" : ""}` });
      p.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
      this.group.appendChild(p);
    }

    if (this.mode !== "circle") this.renderAngleMark();
    if (this.showRadius) this.renderRadius();
    if (this.mode !== "circle") this.renderArcLabel();

    // centre dot, and handles: one to size the radius, one to sweep the angle
    this.group.appendChild(
      el("circle", { cx: this.center.x, cy: this.center.y, r: 2.5, fill: "#1a1a1a", class: "centre-dot" })
    );
    const radiusHandlePt = this.pointAt(this.mode === "circle" ? -90 : this.startAngleDeg);
    const rh = el("circle", { cx: radiusHandlePt.x, cy: radiusHandlePt.y, r: 6, class: "vertex-handle" });
    rh.addEventListener("pointerdown", (e) => this.onRadiusPointerDown(e));
    this.group.appendChild(rh);

    if (this.mode !== "circle") {
      const sweepPt = this.pointAt(this.startAngleDeg + this.sweepDeg);
      const sh = el("circle", { cx: sweepPt.x, cy: sweepPt.y, r: 6, class: "drag-handle" });
      sh.addEventListener("pointerdown", (e) => this.onSweepPointerDown(e));
      this.group.appendChild(sh);
    }
  }

  renderRadius() {
    const shownUnits = this.radiusIsDiameter ? this.radiusUnits() * 2 : this.radiusUnits();
    const override = this.overrides.radius;
    const hidden = override === "";
    const displayValue = override !== undefined && override !== "" ? override : round1(shownUnits);

    let from = this.center;
    let to = this.pointAt(this.mode === "circle" ? -90 : this.startAngleDeg);
    if (this.radiusIsDiameter) {
      const angle = this.mode === "circle" ? -90 : this.startAngleDeg;
      from = this.pointAt(angle + 180);
      to = this.pointAt(angle);
    }
    this.group.appendChild(
      el("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: "shape-line radius-line" })
    );

    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const pos = { x: mid.x - (dy / len) * 14, y: mid.y + (dx / len) * 14 };
    this.group.appendChild(
      renderRemovableLabel({
        x: pos.x,
        y: pos.y,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField("radius", ""),
        onRestore: (e) => this.startInlineEdit(e, "radius", round1(shownUnits)),
        onDoubleClick: (e) => this.startInlineEdit(e, "radius", displayValue),
      })
    );
  }

  renderAngleMark() {
    const r = Math.min(34, this.radiusPx * 0.32);
    const a1 = this.startAngleDeg * DEG;
    const a2 = (this.startAngleDeg + this.sweepDeg) * DEG;
    const p1 = { x: this.center.x + r * Math.cos(a1), y: this.center.y + r * Math.sin(a1) };
    const p2 = { x: this.center.x + r * Math.cos(a2), y: this.center.y + r * Math.sin(a2) };
    const largeArc = this.sweepDeg > 180 ? 1 : 0;
    this.group.appendChild(
      el("path", { d: `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`, class: "angle-arc" })
    );

    const override = this.overrides.angle;
    const hidden = override === "";
    const displayValue = override !== undefined && override !== "" ? override : `${round1(this.sweepDeg)}°`;
    const bis = (this.startAngleDeg + this.sweepDeg / 2) * DEG;
    const lp = { x: this.center.x + (r + 20) * Math.cos(bis), y: this.center.y + (r + 20) * Math.sin(bis) };
    this.group.appendChild(
      renderRemovableLabel({
        x: lp.x,
        y: lp.y,
        value: displayValue,
        hidden,
        cssClass: "angle-label",
        onRemove: () => this.setField("angle", ""),
        onRestore: (e) => this.startInlineEdit(e, "angle", round1(this.sweepDeg)),
        onDoubleClick: (e) => this.startInlineEdit(e, "angle", displayValue),
      })
    );
  }

  renderArcLabel() {
    const override = this.overrides.arc;
    const hidden = override === "";
    const arcUnits = round1(this.arcLengthUnits());
    const displayValue = override !== undefined && override !== "" ? override : arcUnits;
    const bis = (this.startAngleDeg + this.sweepDeg / 2) * DEG;
    const lp = {
      x: this.center.x + (this.radiusPx + 22) * Math.cos(bis),
      y: this.center.y + (this.radiusPx + 22) * Math.sin(bis),
    };
    this.group.appendChild(
      renderRemovableLabel({
        x: lp.x,
        y: lp.y,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField("arc", ""),
        onRestore: (e) => this.startInlineEdit(e, "arc", arcUnits),
        onDoubleClick: (e) => this.startInlineEdit(e, "arc", displayValue),
      })
    );
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

  onRadiusPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      this.radiusPx = Math.max(10, dist(this.center, cur));
      if (this.mode !== "circle") {
        this.startAngleDeg = (Math.atan2(cur.y - this.center.y, cur.x - this.center.x) * 180) / Math.PI;
      }
      delete this.overrides.radius;
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

  onSweepPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const abs = (Math.atan2(cur.y - this.center.y, cur.x - this.center.x) * 180) / Math.PI;
      let sweep = abs - this.startAngleDeg;
      sweep = ((sweep % 360) + 360) % 360;
      this.sweepDeg = clamp(sweep, 1, 359);
      delete this.overrides.angle;
      delete this.overrides.arc;
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
