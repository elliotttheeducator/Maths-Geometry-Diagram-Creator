import { round1, nextId, PX_PER_UNIT, clamp, rotatePoint, midpoint } from "../geometry.js";
import { el, text, clear, toSvgPoint, renderRemovableLabel, dimensionLine } from "../svgUtil.js";
import { parseFieldInput } from "../fieldInput.js";
import { paletteEntry } from "../palette.js";
import { applyLabelScale, gap, extentOf, labelOffset, spreadLabels } from "../labelScale.js";

const DEG = Math.PI / 180;

// Rectangle or parallelogram, held as an anchor corner plus two side vectors rather
// than four free points -- that way "rectangle" simply means the slant is 90 deg and
// stays exactly 90 through every edit, and a parallelogram's opposite sides stay
// exactly equal and parallel by construction rather than by luck.
export class Quadrilateral {
  constructor({ origin, widthPx = 240, heightPx = 150, slantDeg = 90, mode = "rectangle", rotationDeg = 0, id } = {}) {
    this.id = id || nextId("quad");
    this.type = "quadrilateral";
    this.origin = origin || { x: 380, y: 420 };
    this.widthPx = widthPx;
    this.heightPx = heightPx;
    this.slantDeg = slantDeg; // angle of the second side away from the base
    this.rotationDeg = rotationDeg;
    this.mode = mode; // "rectangle" | "parallelogram"
    this.fillId = "cream";
    this.labels = ["A", "B", "C", "D"];
    this.showLabels = false;
    this.showHeight = false; // perpendicular height, the parallelogram-area cue
    // Equal-opposite-side ticks: true information, but on a plain labelled rectangle
    // it's information the shape already carries, so it can be switched off.
    this.showTicks = true;
    this.heightOutside = false; // draw the height outside the shape, off the extended base
    this.dimensionStyle = true; // arrows outside the shape rather than plain edge text
    this.overrides = {}; // base | side | height | angle -> "" hidden, or custom text
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  effectiveSlant() {
    return this.mode === "rectangle" ? 90 : this.slantDeg;
  }

  // Corners in order, with the whole shape rotated about its anchor.
  corners() {
    const slant = this.effectiveSlant() * DEG;
    const base = { x: this.widthPx, y: 0 };
    const side = { x: this.heightPx * Math.cos(-slant), y: this.heightPx * Math.sin(-slant) };
    const raw = [
      { x: 0, y: 0 },
      { x: base.x, y: base.y },
      { x: base.x + side.x, y: base.y + side.y },
      { x: side.x, y: side.y },
    ];
    return raw.map((p) => {
      const abs = { x: this.origin.x + p.x, y: this.origin.y + p.y };
      return this.rotationDeg ? rotatePoint(abs, this.origin, this.rotationDeg) : abs;
    });
  }

  baseUnits() {
    return this.widthPx / PX_PER_UNIT;
  }

  sideUnits() {
    return this.heightPx / PX_PER_UNIT;
  }

  // For a parallelogram the area uses the perpendicular height, not the slanted side.
  perpHeightUnits() {
    return this.sideUnits() * Math.sin(this.effectiveSlant() * DEG);
  }

  areaUnits() {
    return this.baseUnits() * this.perpHeightUnits();
  }

  // --- editing -----------------------------------------------------------

  setBase(units) {
    this.widthPx = Math.max(20, units * PX_PER_UNIT);
    this.notifyChange();
  }

  setSide(units) {
    this.heightPx = Math.max(20, units * PX_PER_UNIT);
    this.notifyChange();
  }

  setSlant(deg) {
    this.slantDeg = clamp(deg, 15, 165);
    this.notifyChange();
  }

  translate(dx, dy) {
    this.origin = { x: this.origin.x + dx, y: this.origin.y + dy };
    this.notifyChange();
  }

  // Corners and edge midpoints are what other shapes snap to when building a
  // composite; the outline is what "Turn into prism" extrudes.
  snapPoints() {
    const c = this.corners();
    return [...c, ...c.map((p, i) => midpoint(p, c[(i + 1) % c.length]))];
  }

  outline() {
    return this.corners();
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  // --- sidebar -----------------------------------------------------------

  getFields() {
    const fields = [
      { key: "mode-rectangle", group: "Shape", label: "Rectangle", kind: "toggle", value: this.mode === "rectangle" },
      {
        key: "mode-parallelogram",
        group: "Shape",
        label: "Parallelogram",
        kind: "toggle",
        value: this.mode === "parallelogram",
      },
    ];

    const val = (name, computed) =>
      this.overrides[name] !== undefined ? this.overrides[name] : round1(computed);

    fields.push({ key: "base", group: "Measurements", label: "Base", kind: "length", value: val("base", this.baseUnits()) });
    fields.push({
      key: "side",
      group: "Measurements",
      label: this.mode === "rectangle" ? "Height" : "Slant side",
      kind: "length",
      value: val("side", this.sideUnits()),
    });
    if (this.mode === "parallelogram") {
      fields.push({ key: "angle", group: "Measurements", label: "Angle", kind: "angle", value: val("angle", this.slantDeg) });
      fields.push({
        key: "show-height",
        group: "Measurements",
        label: "Show perp. height",
        kind: "toggle",
        value: this.showHeight,
      });
      if (this.showHeight) {
        fields.push({
          key: "height-outside",
          group: "Measurements",
          label: "Height outside",
          kind: "toggle",
          value: this.heightOutside,
        });
      }
      if (this.showHeight) {
        fields.push({
          key: "height",
          group: "Measurements",
          label: "Perp. height",
          kind: "length",
          value: val("height", this.perpHeightUnits()),
        });
      }
    }
    fields.push({
      key: "area",
      group: "Measurements",
      label: "Area",
      kind: "length",
      readOnly: true,
      value: round1(this.areaUnits()),
    });

    fields.push({ key: "rotation", group: "Appearance", label: "Rotation", kind: "angle", value: round1(this.rotationDeg) });
    fields.push({ key: "fill", group: "Appearance", label: "Fill", kind: "swatch", value: this.fillId });
    fields.push({
      key: "dimension-style",
      group: "Appearance",
      label: "Dimension arrows",
      kind: "toggle",
      value: this.dimensionStyle,
    });
    fields.push({ key: "show-labels", group: "Appearance", label: "Corner labels", kind: "toggle", value: this.showLabels });
    fields.push({ key: "show-ticks", group: "Appearance", label: "Equal-side ticks", kind: "toggle", value: this.showTicks });
    return fields;
  }

  setField(key, value) {
    if (key === "mode-rectangle") {
      if (value) this.mode = "rectangle";
      this.notifyChange();
      return;
    }
    if (key === "mode-parallelogram") {
      if (value) {
        this.mode = "parallelogram";
        if (this.slantDeg === 90) this.slantDeg = 65;
      }
      this.notifyChange();
      return;
    }
    if (key === "fill") {
      this.fillId = value;
      this.notifyChange();
      return;
    }
    if (key === "show-labels") {
      this.showLabels = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "show-ticks") {
      this.showTicks = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "height-outside") {
      this.heightOutside = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "show-height") {
      this.showHeight = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "dimension-style") {
      this.dimensionStyle = Boolean(value);
      this.notifyChange();
      return;
    }
    if (key === "rotation") {
      this.rotationDeg = Number(value) || 0;
      this.notifyChange();
      return;
    }
    if (key === "area") return; // derived

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
    if (key === "base") this.setBase(parsed.numeric);
    else if (key === "side") this.setSide(parsed.numeric);
    else if (key === "angle") this.setSlant(parsed.numeric);
    else if (key === "height") {
      // Hold the base angle and solve the slant side that gives this perpendicular height.
      const s = Math.sin(this.effectiveSlant() * DEG);
      if (s > 0.01) this.setSide(parsed.numeric / s);
    }
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
    return extentOf(this.corners());
  }

  render() {
    if (!this.group) return;
    clear(this.group);
    applyLabelScale(this.group, this.extentPx());
    const pts = this.corners();
    const fill = paletteEntry(this.fillId).fill;

    const poly = el("polygon", {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      class: `shape-poly${this.selected ? " selected" : ""}`,
      fill,
    });
    poly.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    this.group.appendChild(poly);

    if (this.mode === "rectangle") this.renderRightAngles(pts);
    if (this.mode === "parallelogram" && this.showHeight) this.renderPerpHeight(pts);
    if (this.mode === "parallelogram") this.renderSlantAngle(pts);

    this.renderEdgeMeasure("base", pts[0], pts[1], this.baseUnits(), pts);
    this.renderEdgeMeasure("side", pts[1], pts[2], this.sideUnits(), pts);
    if (this.showTicks) this.renderEqualTicks(pts);

    if (this.showLabels) this.renderCornerLabels(pts);
    this.renderHandles(pts);
 
    spreadLabels(this.group, this.extentPx());
  }

  centroid() {
    const pts = this.corners();
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / 4,
      y: pts.reduce((s, p) => s + p.y, 0) / 4,
    };
  }

  // Ticks marking the two pairs of equal opposite sides -- single on one pair,
  // double on the other, the standard textbook notation.
  renderEqualTicks(pts) {
    const g = el("g");
    const pairs = [
      [pts[0], pts[1], 1],
      [pts[2], pts[3], 1],
      [pts[1], pts[2], 2],
      [pts[3], pts[0], 2],
    ];
    for (const [a, b, count] of pairs) {
      const mid = midpoint(a, b);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * 5;
        const c = { x: mid.x + ux * off, y: mid.y + uy * off };
        g.appendChild(
          el("line", {
            x1: c.x + nx * 5,
            y1: c.y + ny * 5,
            x2: c.x - nx * 5,
            y2: c.y - ny * 5,
            class: "equal-length-tick",
          })
        );
      }
    }
    this.group.appendChild(g);
  }

  renderRightAngles(pts) {
    const size = 12;
    for (let i = 0; i < 4; i++) {
      const V = pts[i];
      const prev = pts[(i + 3) % 4];
      const next = pts[(i + 1) % 4];
      const u1 = this.unit(V, prev);
      const u2 = this.unit(V, next);
      this.group.appendChild(
        el("path", {
          d: `M ${V.x + u1.x * size} ${V.y + u1.y * size} L ${V.x + (u1.x + u2.x) * size} ${
            V.y + (u1.y + u2.y) * size
          } L ${V.x + u2.x * size} ${V.y + u2.y * size}`,
          class: "right-angle-mark",
        })
      );
    }
  }

  unit(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  // Dashed perpendicular down to the base line with a right-angle box at its foot --
  // how a textbook shows a parallelogram's height. Drawn inside from the top-left
  // corner, or (heightOutside) from the top-right corner down to the base extended
  // beyond it, which is the other drawing every textbook uses. Whenever the foot lands
  // off the end of the base, the base is extended to meet it with a dashed line.
  renderPerpHeight(pts) {
    const apex = this.heightOutside ? pts[2] : pts[3];
    const baseDir = this.unit(pts[0], pts[1]);
    const baseLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const along = (apex.x - pts[0].x) * baseDir.x + (apex.y - pts[0].y) * baseDir.y;
    const foot = { x: pts[0].x + baseDir.x * along, y: pts[0].y + baseDir.y * along };

    if (along < 0 || along > baseLen) {
      const from = along < 0 ? pts[0] : pts[1];
      this.group.appendChild(
        el("line", { x1: from.x, y1: from.y, x2: foot.x, y2: foot.y, class: "construction-line base-extension" })
      );
    }

    this.group.appendChild(
      el("line", { x1: apex.x, y1: apex.y, x2: foot.x, y2: foot.y, class: "construction-line" })
    );
    const size = 11;
    const up = this.unit(foot, apex);
    // The box opens back along the base towards the shape, so it reads as the corner
    // between the height and the base rather than pointing off into space.
    const towards = along > baseLen ? -1 : 1;
    const bx = baseDir.x * towards;
    const by = baseDir.y * towards;
    this.group.appendChild(
      el("path", {
        d: `M ${foot.x + bx * size} ${foot.y + by * size} L ${foot.x + (bx + up.x) * size} ${
          foot.y + (by + up.y) * size
        } L ${foot.x + up.x * size} ${foot.y + up.y * size}`,
        class: "right-angle-mark",
      })
    );

    const override = this.overrides.height;
    const hidden = override === "";
    const computed = round1(this.perpHeightUnits());
    const displayValue = override !== undefined && override !== "" ? override : computed;
    // Beside the dashed line, on the side away from the shape's middle, so the number
    // never sits over the fill or over an edge.
    const mid = midpoint(apex, foot);
    const c = this.centroid();
    // Beside its own dashed line: pushed further out when the height is drawn outside
    // the shape, and towards the roomier half of the base when it's drawn inside.
    const outside = along < 0 || along > baseLen;
    const towardsLabel = outside ? (along < 0 ? -1 : 1) : along < baseLen / 2 ? 1 : -1;
    const nx = baseDir.x * towardsLabel;
    const ny = baseDir.y * towardsLabel;
    const heightOff = labelOffset(displayValue, this.extentPx(), nx, ny);
    this.group.appendChild(
      renderRemovableLabel({
        x: mid.x + nx * heightOff,
        y: mid.y + ny * heightOff,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField("height", ""),
        onRestore: (e) => this.startInlineEdit(e, "height", computed),
        onDoubleClick: (e) => this.startInlineEdit(e, "height", displayValue),
      })
    );
  }

  renderSlantAngle(pts) {
    const V = pts[0];
    const u1 = this.unit(V, pts[1]);
    const u2 = this.unit(V, pts[3]);
    const r = 26;
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
    const displayValue = override !== undefined && override !== "" ? override : `${round1(this.slantDeg)}°`;
    const bx = (u1.x + u2.x) / 2;
    const by = (u1.y + u2.y) / 2;
    const blen = Math.hypot(bx, by) || 1;
    const angOff = labelOffset(displayValue, this.extentPx(), bx / blen, by / blen, 8);
    const lp = { x: V.x + (bx / blen) * (r + angOff), y: V.y + (by / blen) * (r + angOff) };
    this.group.appendChild(
      renderRemovableLabel({
        x: lp.x,
        y: lp.y,
        value: displayValue,
        hidden,
        cssClass: "angle-label",
        onRemove: () => this.setField("angle", ""),
        onRestore: (e) => this.startInlineEdit(e, "angle", round1(this.slantDeg)),
        onDoubleClick: (e) => this.startInlineEdit(e, "angle", displayValue),
      })
    );
  }

  renderEdgeMeasure(key, a, b, computedUnits, pts) {
    const override = this.overrides[key];
    const hidden = override === "";
    const computed = round1(computedUnits);
    const displayValue = override !== undefined && override !== "" ? override : computed;

    const c = this.centroid();
    const mid = midpoint(a, b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (nx * (c.x - mid.x) + ny * (c.y - mid.y) > 0) {
      nx = -nx;
      ny = -ny;
    }

    const clearance = gap(this.extentPx(), this.dimensionStyle ? 20 : 15);
    if (this.dimensionStyle && !hidden) {
      const off = { x: nx * clearance, y: ny * clearance };
      this.group.appendChild(
        dimensionLine({ x: a.x + off.x, y: a.y + off.y }, { x: b.x + off.x, y: b.y + off.y }, 0)
      );
    }
    const labelGap =
      (this.dimensionStyle ? clearance : 0) + labelOffset(displayValue, this.extentPx(), nx, ny);
    this.group.appendChild(
      renderRemovableLabel({
        x: mid.x + nx * labelGap,
        y: mid.y + ny * labelGap,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField(key, ""),
        onRestore: (e) => this.startInlineEdit(e, key, computed),
        onDoubleClick: (e) => this.startInlineEdit(e, key, displayValue),
      })
    );
  }

  renderCornerLabels(pts) {
    const c = this.centroid();
    pts.forEach((p, i) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      this.group.appendChild(
        text(this.labels[i], {
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
    // corner 1 sizes the base, corner 3 sizes the side (and the slant, when a
    // parallelogram); the shape body drags the whole thing.
    const baseHandle = el("circle", { cx: pts[1].x, cy: pts[1].y, r: 6, class: "vertex-handle" });
    baseHandle.addEventListener("pointerdown", (e) => this.onCornerPointerDown(e, "base"));
    this.group.appendChild(baseHandle);

    const sideHandle = el("circle", { cx: pts[3].x, cy: pts[3].y, r: 6, class: "vertex-handle" });
    sideHandle.addEventListener("pointerdown", (e) => this.onCornerPointerDown(e, "side"));
    this.group.appendChild(sideHandle);
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

  onCornerPointerDown(e, which) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      // Work in the shape's own unrotated frame so dragging stays intuitive when rotated.
      const local = this.rotationDeg ? rotatePoint(cur, this.origin, -this.rotationDeg) : cur;
      const dx = local.x - this.origin.x;
      const dy = local.y - this.origin.y;
      if (which === "base") {
        this.widthPx = Math.max(20, dx);
        delete this.overrides.base;
      } else {
        this.heightPx = Math.max(20, Math.hypot(dx, dy));
        if (this.mode === "parallelogram") {
          const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
          this.slantDeg = clamp(deg, 15, 165);
          delete this.overrides.angle;
        }
        delete this.overrides.side;
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
