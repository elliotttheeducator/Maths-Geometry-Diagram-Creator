import { round1, nextId, PX_PER_UNIT, clamp, rayIntersection } from "../geometry.js";
import { el, clear, toSvgPoint, renderRemovableLabel } from "../svgUtil.js";

const DEG = Math.PI / 180;
const MAX_LINES = 3;
const MAX_TRANSVERSALS = 2;

// A stack of 2-3 parallel lines (sharing one direction, `lineAngleDeg`, so they can
// never go out of parallel) crossed by 1-2 transversals, each at its own angle and
// position. Every crossing gets the same stable 4-slot angle labeling used for a
// simple pair, so corresponding/alternate/co-interior relationships stay numerically
// exact everywhere, however many lines and transversals are on the canvas.

export class ParallelLines {
  constructor({
    center,
    lineAngleDeg = 0,
    gapPx = 150,
    lineCount = 2,
    transversals,
    id,
  } = {}) {
    this.id = id || nextId("parallel");
    this.type = "parallel-lines";
    this.center = center || { x: 400, y: 350 };
    this.lineAngleDeg = lineAngleDeg;
    this.gapPx = gapPx;
    this.lineCount = lineCount;
    this.transversals = transversals || [{ relAngleDeg: 65, along: 0 }];
    this.halfLineLen = 220;
    // Keyed "T0-L1-0".."T0-L1-3" (transversal index - line index - slot 0-3).
    this.angleOverrides = {};
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  geometry() {
    const lineDir = { x: Math.cos(this.lineAngleDeg * DEG), y: Math.sin(this.lineAngleDeg * DEG) };
    const perpDir = { x: -lineDir.y, y: lineDir.x };
    const n = this.lineCount;
    const lineCenters = [];
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * this.gapPx;
      lineCenters.push({ x: this.center.x + perpDir.x * off, y: this.center.y + perpDir.y * off });
    }
    const lineDirRad = Math.atan2(lineDir.y, lineDir.x);

    const transversals = this.transversals.map((tr) => {
      const transDirAbs = this.lineAngleDeg + tr.relAngleDeg;
      const transDir = { x: Math.cos(transDirAbs * DEG), y: Math.sin(transDirAbs * DEG) };
      const transDirRad = Math.atan2(transDir.y, transDir.x);
      const T0 = { x: this.center.x + lineDir.x * tr.along, y: this.center.y + lineDir.y * tr.along };
      const intersections = lineCenters.map((lc) => rayIntersection(T0, transDirRad, lc, lineDirRad));
      return { relAngleDeg: tr.relAngleDeg, along: tr.along, transDir, transDirRad, T0, intersections };
    });

    return { lineDir, perpDir, lineDirRad, lineCenters, transversals };
  }

  // --- editing -----------------------------------------------------------

  setLineAngle(deg) {
    this.lineAngleDeg = (((deg % 360) + 360) % 360);
    this.notifyChange();
  }

  setGap(units) {
    this.gapPx = Math.max(30, units * PX_PER_UNIT);
    this.notifyChange();
  }

  setLineCount(n) {
    this.lineCount = clamp(n, 2, MAX_LINES);
    this.notifyChange();
  }

  setTransversalCount(n) {
    n = clamp(n, 1, MAX_TRANSVERSALS);
    while (this.transversals.length < n) {
      const idx = this.transversals.length;
      this.transversals.push({ relAngleDeg: 115, along: idx * 90 });
    }
    while (this.transversals.length > n) this.transversals.pop();
    this.notifyChange();
  }

  setTransversalAngle(idx, deg) {
    this.transversals[idx].relAngleDeg = clamp(deg, 5, 175);
    this.notifyChange();
  }

  setTransversalAlong(idx, units) {
    this.transversals[idx].along = units * PX_PER_UNIT;
    this.notifyChange();
  }

  translate(dx, dy) {
    this.center = { x: this.center.x + dx, y: this.center.y + dy };
    this.notifyChange();
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  // The 4 angle values at one crossing, in the fixed, stable slot order used by
  // both renderCrossing() and here (sidebar fields) -- see renderCrossing() for why
  // slot index is stable regardless of the transversal's angle.
  slotAngles(relAngleDeg) {
    const rel = relAngleDeg;
    return [rel, 180 - rel, rel, 180 - rel];
  }

  getFields() {
    const fields = [
      { key: "line-angle", group: "Lines", label: "Direction", kind: "angle", value: round1(this.lineAngleDeg) },
      { key: "gap", group: "Lines", label: "Gap between lines", kind: "length", value: round1(this.gapPx / PX_PER_UNIT) },
      { key: "add-line", group: "Lines", label: "3rd parallel line", kind: "toggle", value: this.lineCount >= 3 },
      { key: "add-transversal", group: "Lines", label: "2nd transversal", kind: "toggle", value: this.transversals.length >= 2 },
    ];

    this.transversals.forEach((tr, j) => {
      const label = this.transversals.length > 1 ? `Transversal ${j + 1}` : "Transversal";
      fields.push({ key: `trans-angle-${j}`, group: label, label: "Angle", kind: "angle", value: round1(tr.relAngleDeg) });
      fields.push({
        key: `trans-along-${j}`,
        group: label,
        label: "Position",
        kind: "length",
        value: round1(tr.along / PX_PER_UNIT),
      });

      const slots = this.slotAngles(tr.relAngleDeg);
      for (let k = 0; k < this.lineCount; k++) {
        for (let s = 0; s < 4; s++) {
          const key = `disp-T${j}-L${k}-${s}`;
          const override = this.angleOverrides[key];
          fields.push({
            key,
            group: `${label} × Line ${k + 1}`,
            label: `Angle ${s + 1}`,
            kind: "angle",
            value: override !== undefined ? override : round1(slots[s]),
          });
        }
      }
    });

    return fields;
  }

  setField(key, value) {
    if (key === "line-angle") return this.setLineAngle(Number(value));
    if (key === "gap") return this.setGap(Number(value));
    if (key === "add-line") return this.setLineCount(value ? 3 : 2);
    if (key === "add-transversal") return this.setTransversalCount(value ? 2 : 1);
    if (key.startsWith("trans-angle-")) return this.setTransversalAngle(Number(key.slice(12)), Number(value));
    if (key.startsWith("trans-along-")) return this.setTransversalAlong(Number(key.slice(12)), Number(value));
    if (key.startsWith("disp-")) {
      // Display-only: every crossing angle is derived from the shared line/transversal
      // angles, so typed text here only changes what's shown, never the geometry.
      const str = String(value).trim();
      this.angleOverrides[key] = str === "" ? "" : str;
      this.notifyChange();
    }
  }

  // --- rendering -----------------------------------------------------------

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
    const geo = this.geometry();
    const cls = this.selected ? "shape-line selected" : "shape-line";

    for (const lc of geo.lineCenters) {
      const seg = this.segment(lc, geo.lineDir, this.halfLineLen);
      this.group.appendChild(this.hitLine(seg.a, seg.b));
      this.group.appendChild(el("line", { x1: seg.a.x, y1: seg.a.y, x2: seg.b.x, y2: seg.b.y, class: cls }));
      this.group.appendChild(this.chevron(lc, geo.lineDir));
    }

    geo.transversals.forEach((tr, j) => {
      const valid = tr.intersections.filter(Boolean);
      if (valid.length === 0) return;
      const projections = valid.map((p) => (p.x - tr.T0.x) * tr.transDir.x + (p.y - tr.T0.y) * tr.transDir.y);
      const minT = Math.min(...projections) - 45;
      const maxT = Math.max(...projections) + 45;
      const start = { x: tr.T0.x + tr.transDir.x * minT, y: tr.T0.y + tr.transDir.y * minT };
      const end = { x: tr.T0.x + tr.transDir.x * maxT, y: tr.T0.y + tr.transDir.y * maxT };
      this.group.appendChild(this.hitLine(start, end));
      this.group.appendChild(el("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: cls }));

      tr.intersections.forEach((pt, k) => {
        if (!pt) return;
        this.group.appendChild(this.renderCrossing(pt, geo.lineDirRad, tr.transDirRad, tr.relAngleDeg, j, k));
      });

      // drag handle at the far end of the transversal to steer its angle interactively
      const handleDist = maxT + 40;
      const handlePos = { x: tr.T0.x + tr.transDir.x * handleDist, y: tr.T0.y + tr.transDir.y * handleDist };
      const handle = el("circle", { cx: handlePos.x, cy: handlePos.y, r: 6, class: "drag-handle" });
      handle.addEventListener("pointerdown", (e) => this.onAnglePointerDown(e, j));
      this.group.appendChild(handle);
    });

    // rotate handle: drag to spin every line (and every transversal with them)
    const rotDist = this.halfLineLen + 30;
    const rotPos = { x: this.center.x + geo.lineDir.x * rotDist, y: this.center.y + geo.lineDir.y * rotDist };
    this.group.appendChild(
      el("line", { x1: this.center.x, y1: this.center.y, x2: rotPos.x, y2: rotPos.y, class: "rotate-handle-line" })
    );
    const rotHandle = el("circle", { cx: rotPos.x, cy: rotPos.y, r: 6, class: "rotate-handle" });
    rotHandle.addEventListener("pointerdown", (e) => this.onRotatePointerDown(e));
    this.group.appendChild(rotHandle);
  }

  segment(center, dir, half) {
    return {
      a: { x: center.x - dir.x * half, y: center.y - dir.y * half },
      b: { x: center.x + dir.x * half, y: center.y + dir.y * half },
    };
  }

  hitLine(a, b) {
    const hit = el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "transparent", "stroke-width": 16 });
    hit.style.cursor = "grab";
    hit.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    return hit;
  }

  chevron(center, dir) {
    const perp = { x: -dir.y, y: dir.x };
    const size = 8;
    const gap = 5;
    const g = el("g");
    for (const off of [-gap, gap]) {
      const base = { x: center.x + dir.x * off, y: center.y + dir.y * off };
      const p1 = { x: base.x - dir.x * size + perp.x * size, y: base.y - dir.y * size + perp.y * size };
      const p2 = { x: base.x + dir.x * size, y: base.y + dir.y * size };
      const p3 = { x: base.x - dir.x * size - perp.x * size, y: base.y - dir.y * size - perp.y * size };
      g.appendChild(
        el("path", { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y}`, class: "parallel-chevron" })
      );
    }
    return g;
  }

  // dirs[i] is always strictly increasing (lineDir < transDir < lineDir+pi < transDir+pi)
  // because relAngleDeg is clamped to (5, 175), so slot index -> physical angle is stable
  // across every geometry change -- no re-sorting, so a label override never jumps position.
  renderCrossing(point, lineDirRad, transDirRad, relAngleDeg, transIdx, lineIdx) {
    const dirs = [lineDirRad, transDirRad, lineDirRad + Math.PI, transDirRad + Math.PI];
    const g = el("g");
    const r = 18;
    for (let i = 0; i < 4; i++) {
      const a1 = dirs[i];
      const a2 = dirs[(i + 1) % 4] + (i === 3 ? 2 * Math.PI : 0);
      const sweepRad = a2 - a1;
      const start = { x: point.x + r * Math.cos(a1), y: point.y + r * Math.sin(a1) };
      const end = { x: point.x + r * Math.cos(a2), y: point.y + r * Math.sin(a2) };
      const largeArc = sweepRad > Math.PI ? 1 : 0;
      const deg = round1((sweepRad * 180) / Math.PI);
      const key = `disp-T${transIdx}-L${lineIdx}-${i}`;
      const hidden = this.angleOverrides[key] === "";

      if (!hidden) {
        g.appendChild(
          el("path", { d: `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`, class: "angle-arc" })
        );
      }

      const bis = a1 + sweepRad / 2;
      const labelR = r + 15;
      const lp = { x: point.x + labelR * Math.cos(bis), y: point.y + labelR * Math.sin(bis) };
      const override = this.angleOverrides[key];
      const displayValue = override !== undefined && override !== "" ? override : `${deg}°`;

      g.appendChild(
        renderRemovableLabel({
          x: lp.x,
          y: lp.y,
          value: displayValue,
          hidden,
          cssClass: "angle-label",
          onRemove: () => this.setField(key, ""),
          onRestore: (e) => this.startInlineEdit(e, key, deg),
          onDoubleClick: (e) => this.startInlineEdit(e, key, displayValue),
        })
      );
    }
    return g;
  }

  startInlineEdit(e, fieldKey, currentValue) {
    e.stopPropagation();
    if (this.controller?.onInlineEdit) this.controller.onInlineEdit(this, fieldKey, currentValue, e);
  }

  // --- interaction -----------------------------------------------------------

  onBodyPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const start = toSvgPoint(svg, e.clientX, e.clientY);
    const startCenter = { ...this.center };
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      this.center = { x: startCenter.x + (cur.x - start.x), y: startCenter.y + (cur.y - start.y) };
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

  onAnglePointerDown(e, transIdx) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const pivot = this.geometry().transversals[transIdx].T0;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const absDeg = (Math.atan2(cur.y - pivot.y, cur.x - pivot.x) * 180) / Math.PI;
      let rel = absDeg - this.lineAngleDeg;
      rel = ((rel % 360) + 360) % 360;
      if (rel > 180) rel = 360 - rel;
      this.transversals[transIdx].relAngleDeg = clamp(rel, 5, 175);
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

  onRotatePointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const center = this.center;
    const startMouse = toSvgPoint(svg, e.clientX, e.clientY);
    const startDeg = (Math.atan2(startMouse.y - center.y, startMouse.x - center.x) * 180) / Math.PI;
    const startLineAngle = this.lineAngleDeg;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const curDeg = (Math.atan2(cur.y - center.y, cur.x - center.x) * 180) / Math.PI;
      this.lineAngleDeg = (((startLineAngle + (curDeg - startDeg)) % 360) + 360) % 360;
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
}
