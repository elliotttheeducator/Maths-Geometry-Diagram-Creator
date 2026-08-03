import { round1, nextId, PX_PER_UNIT, clamp } from "../geometry.js";
import { el, text, clear, toSvgPoint } from "../svgUtil.js";

const DEG = Math.PI / 180;

// Two parallel lines sharing one direction (`lineAngleDeg`) by construction --
// they can never go out of parallel -- crossed by a transversal at `relAngleDeg`
// (measured relative to the lines' own direction). Because both intersections use
// the exact same two directions, the corresponding/alternate/co-interior angle
// relationships are always numerically exact, not just visually close.

export class ParallelLines {
  constructor({ center, lineAngleDeg = 0, relAngleDeg = 65, gapPx = 150, id } = {}) {
    this.id = id || nextId("parallel");
    this.type = "parallel-lines";
    this.center = center || { x: 400, y: 350 };
    this.lineAngleDeg = lineAngleDeg;
    this.relAngleDeg = relAngleDeg;
    this.gapPx = gapPx;
    this.halfLineLen = 220;
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  geometry() {
    const lineDir = { x: Math.cos(this.lineAngleDeg * DEG), y: Math.sin(this.lineAngleDeg * DEG) };
    const perpDir = { x: -lineDir.y, y: lineDir.x };
    const half = this.gapPx / 2;
    const line1Center = { x: this.center.x - perpDir.x * half, y: this.center.y - perpDir.y * half };
    const line2Center = { x: this.center.x + perpDir.x * half, y: this.center.y + perpDir.y * half };

    const transAngleAbs = this.lineAngleDeg + this.relAngleDeg;
    const transDir = { x: Math.cos(transAngleAbs * DEG), y: Math.sin(transAngleAbs * DEG) };
    const denom = transDir.x * perpDir.x + transDir.y * perpDir.y;
    const t = denom !== 0 ? this.gapPx / denom : 0;

    const T1 = line1Center;
    const T2 = { x: T1.x + transDir.x * t, y: T1.y + transDir.y * t };

    return { lineDir, perpDir, line1Center, line2Center, transDir, T1, T2 };
  }

  // --- editing -----------------------------------------------------------

  setRelAngle(deg) {
    this.relAngleDeg = clamp(deg, 5, 175);
    this.notifyChange();
  }

  setLineAngle(deg) {
    this.lineAngleDeg = ((deg % 360) + 360) % 360;
    this.notifyChange();
  }

  setGap(units) {
    this.gapPx = Math.max(30, units * PX_PER_UNIT);
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

  getFields() {
    return [
      {
        key: "rel-angle",
        group: "Angles",
        label: "Transversal",
        kind: "angle",
        value: round1(this.relAngleDeg),
      },
      {
        key: "line-angle",
        group: "Angles",
        label: "Lines direction",
        kind: "angle",
        value: round1(this.lineAngleDeg),
      },
      {
        key: "gap",
        group: "Spacing",
        label: "Gap between lines",
        kind: "length",
        value: round1(this.gapPx / PX_PER_UNIT),
      },
    ];
  }

  setField(key, value) {
    if (key === "rel-angle") this.setRelAngle(Number(value));
    else if (key === "line-angle") this.setLineAngle(Number(value));
    else if (key === "gap") this.setGap(Number(value));
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

    const line1 = this.segment(geo.line1Center, geo.lineDir, this.halfLineLen);
    const line2 = this.segment(geo.line2Center, geo.lineDir, this.halfLineLen);
    const transExtra = 45;
    const transStart = { x: geo.T1.x - geo.transDir.x * transExtra, y: geo.T1.y - geo.transDir.y * transExtra };
    const transEnd = { x: geo.T2.x + geo.transDir.x * transExtra, y: geo.T2.y + geo.transDir.y * transExtra };

    this.group.appendChild(this.hitLine(line1.a, line1.b));
    this.group.appendChild(this.hitLine(line2.a, line2.b));
    this.group.appendChild(el("line", { x1: line1.a.x, y1: line1.a.y, x2: line1.b.x, y2: line1.b.y, class: cls }));
    this.group.appendChild(el("line", { x1: line2.a.x, y1: line2.a.y, x2: line2.b.x, y2: line2.b.y, class: cls }));
    this.group.appendChild(el("line", { x1: transStart.x, y1: transStart.y, x2: transEnd.x, y2: transEnd.y, class: cls }));

    this.group.appendChild(this.chevron(geo.line1Center, geo.lineDir));
    this.group.appendChild(this.chevron(geo.line2Center, geo.lineDir));

    const lineDirAngleRad = Math.atan2(geo.lineDir.y, geo.lineDir.x);
    const transDirAngleRad = Math.atan2(geo.transDir.y, geo.transDir.x);
    this.group.appendChild(this.crossingAngles(geo.T1, lineDirAngleRad, transDirAngleRad));
    this.group.appendChild(this.crossingAngles(geo.T2, lineDirAngleRad, transDirAngleRad));

    // drag handle at the far end of the transversal to steer relAngle interactively
    const handleDist = Math.hypot(geo.T2.x - geo.T1.x, geo.T2.y - geo.T1.y) + 55;
    const handlePos = {
      x: geo.T1.x + geo.transDir.x * handleDist,
      y: geo.T1.y + geo.transDir.y * handleDist,
    };
    const handle = el("circle", { cx: handlePos.x, cy: handlePos.y, r: 6, class: "drag-handle" });
    handle.addEventListener("pointerdown", (e) => this.onAnglePointerDown(e, geo.T1));
    this.group.appendChild(handle);
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

  crossingAngles(point, lineDirRad, transDirRad) {
    const raw = [lineDirRad, lineDirRad + Math.PI, transDirRad, transDirRad + Math.PI];
    const norm = raw.map((d) => (((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))).sort((a, b) => a - b);
    const g = el("g");
    const r = 18;
    for (let i = 0; i < 4; i++) {
      const a1 = norm[i];
      const a2 = i === 3 ? norm[0] + 2 * Math.PI : norm[i + 1];
      const sweepRad = a2 - a1;
      const start = { x: point.x + r * Math.cos(a1), y: point.y + r * Math.sin(a1) };
      const end = { x: point.x + r * Math.cos(a2), y: point.y + r * Math.sin(a2) };
      const largeArc = sweepRad > Math.PI ? 1 : 0;
      g.appendChild(
        el("path", { d: `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`, class: "angle-arc" })
      );
      const bis = a1 + sweepRad / 2;
      const labelR = r + 15;
      const lp = { x: point.x + labelR * Math.cos(bis), y: point.y + labelR * Math.sin(bis) };
      const deg = round1((sweepRad * 180) / Math.PI);
      g.appendChild(
        text(`${deg}°`, {
          x: lp.x,
          y: lp.y,
          class: "angle-label",
          "text-anchor": "middle",
          "dominant-baseline": "middle",
        })
      );
    }
    return g;
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

  onAnglePointerDown(e, pivot) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const absDeg = (Math.atan2(cur.y - pivot.y, cur.x - pivot.x) * 180) / Math.PI;
      let rel = absDeg - this.lineAngleDeg;
      rel = ((rel % 360) + 360) % 360;
      if (rel > 180) rel = 360 - rel;
      this.relAngleDeg = clamp(rel, 5, 175);
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
