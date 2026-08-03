import {
  dist,
  rotatePoint,
  pointOnRay,
  midpoint,
  round1,
  nextId,
  PX_PER_UNIT,
  clamp,
  segmentIntersection,
} from "../geometry.js";
import { el, clear, toSvgPoint, renderRemovableLabel } from "../svgUtil.js";
import { parseFieldInput } from "../fieldInput.js";

const SNAP_DIST = 18;
const RIGHT_ANGLE_TOLERANCE = 0.5;
const MAX_CYCLE_LEN = 8;
const MAX_CYCLES = 40;
const DEFAULT_COLOR = "#1f2430";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// A freeform diagram: a graph of vertices connected by line segments. Segments can
// share endpoints (drag one vertex onto another to merge/connect them) or simply
// cross each other geometrically -- either way, wherever 2+ segment-rays meet at a
// point, the angles between them are auto-computed and shown. Segments with the
// same direction get matching chevron marks; segments with the same length get
// matching tick marks; any simple closed loop of segments can be filled.
export class LineGraph {
  constructor({ id } = {}) {
    this.id = id || nextId("linegraph");
    this.type = "line-graph";
    this.vertices = []; // {id, x, y, labelOverride}
    this.segments = []; // {id, aId, bId, color, lengthLocked, lengthLockUnits, lengthOverride}
    this.angleLocks = {}; // vertex-junction pairKey -> locked degree value
    this.angleOverrides = {}; // any-junction pairKey -> display override ("" = hidden)
    this.fillColors = {}; // cycleKey -> pastel hex or "none"
    this._spawnCount = 0;
    this._vertexCount = 0;
    this._idCount = 0;
    this.selected = false;
    this.group = null;
    this.controller = null;
  }

  // --- graph mutation -----------------------------------------------------

  nextVertexId() {
    this._idCount += 1;
    return `v${this._idCount}`;
  }

  nextSegmentId() {
    this._idCount += 1;
    return `s${this._idCount}`;
  }

  nextLetter() {
    const letter = LETTERS[this._vertexCount % LETTERS.length];
    this._vertexCount += 1;
    return this._vertexCount > LETTERS.length ? `${letter}${this._vertexCount}` : letter;
  }

  addVertex(x, y) {
    const v = { id: this.nextVertexId(), x, y, labelOverride: undefined, label: this.nextLetter() };
    this.vertices.push(v);
    return v;
  }

  getVertex(id) {
    return this.vertices.find((v) => v.id === id);
  }

  touchingSegments(vertexId) {
    return this.segments.filter((s) => s.aId === vertexId || s.bId === vertexId);
  }

  // Adds a brand new, disconnected 2-point segment. If `fromVertexId` is given,
  // it "sprouts" a new connected segment from that existing vertex instead.
  addSegment(fromVertexId) {
    this._spawnCount += 1;
    const o = (this._spawnCount - 1) * 26;
    let a;
    if (fromVertexId) {
      a = this.getVertex(fromVertexId);
    } else {
      a = this.addVertex(420 + o, 330 + o);
    }
    const b = this.addVertex(a.x + 160, a.y + o * 0 - 10);
    const seg = {
      id: this.nextSegmentId(),
      aId: a.id,
      bId: b.id,
      color: DEFAULT_COLOR,
      lengthLocked: false,
      lengthLockUnits: null,
      lengthOverride: undefined,
    };
    this.segments.push(seg);
    this.notifyChange();
    return seg;
  }

  removeSegment(segId) {
    this.segments = this.segments.filter((s) => s.id !== segId);
    this.pruneOrphanVertices();
    this.notifyChange();
  }

  pruneOrphanVertices() {
    this.vertices = this.vertices.filter((v) => this.touchingSegments(v.id).length > 0);
  }

  // Repoints every segment referencing `removeId` to `keepId`, then drops removeId.
  mergeVertices(keepId, removeId) {
    if (keepId === removeId) return;
    for (const s of this.segments) {
      if (s.aId === removeId) s.aId = keepId;
      if (s.bId === removeId) s.bId = keepId;
    }
    // drop now-degenerate zero-length segments created by the merge
    this.segments = this.segments.filter((s) => s.aId !== s.bId);
    this.vertices = this.vertices.filter((v) => v.id !== removeId);
  }

  findSnapTarget(vertexId) {
    const v = this.getVertex(vertexId);
    if (!v) return null;
    let best = null;
    let bestDist = SNAP_DIST;
    for (const other of this.vertices) {
      if (other.id === vertexId) continue;
      const d = dist(v, other);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  centroid() {
    if (this.vertices.length === 0) return { x: 0, y: 0 };
    const sum = this.vertices.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }), { x: 0, y: 0 });
    return { x: sum.x / this.vertices.length, y: sum.y / this.vertices.length };
  }

  translate(dx, dy) {
    for (const v of this.vertices) {
      v.x += dx;
      v.y += dy;
    }
    this.notifyChange();
  }

  // --- junctions: every point where 2+ segment-rays meet -------------------

  computeJunctions() {
    const junctions = [];
    for (const v of this.vertices) {
      const touching = this.touchingSegments(v.id);
      if (touching.length < 2) continue;
      const rays = touching.map((s) => {
        const otherId = s.aId === v.id ? s.bId : s.aId;
        const other = this.getVertex(otherId);
        return { dirRad: Math.atan2(other.y - v.y, other.x - v.x), rayId: `${s.id}:${otherId}` };
      });
      junctions.push({ point: { x: v.x, y: v.y }, rays, vertexId: v.id });
    }
    for (let i = 0; i < this.segments.length; i++) {
      for (let j = i + 1; j < this.segments.length; j++) {
        const s1 = this.segments[i];
        const s2 = this.segments[j];
        if ([s1.aId, s1.bId].some((id) => id === s2.aId || id === s2.bId)) continue;
        const A = this.getVertex(s1.aId);
        const B = this.getVertex(s1.bId);
        const C = this.getVertex(s2.aId);
        const D = this.getVertex(s2.bId);
        const pt = segmentIntersection(A, B, C, D);
        if (!pt) continue;
        const rays = [
          { dirRad: Math.atan2(A.y - pt.y, A.x - pt.x), rayId: `${s1.id}:${s1.aId}` },
          { dirRad: Math.atan2(B.y - pt.y, B.x - pt.x), rayId: `${s1.id}:${s1.bId}` },
          { dirRad: Math.atan2(C.y - pt.y, C.x - pt.x), rayId: `${s2.id}:${s2.aId}` },
          { dirRad: Math.atan2(D.y - pt.y, D.x - pt.x), rayId: `${s2.id}:${s2.bId}` },
        ];
        junctions.push({ point: pt, rays, vertexId: null });
      }
    }
    return junctions;
  }

  rayInfo(rayId) {
    const idx = rayId.indexOf(":");
    const segId = rayId.slice(0, idx);
    const farId = rayId.slice(idx + 1);
    const seg = this.segments.find((s) => s.id === segId);
    if (!seg) return null;
    const pivotId = seg.aId === farId ? seg.bId : seg.aId;
    return { seg, pivotId, farId };
  }

  // --- simple-cycle detection (for polygon fill) ---------------------------

  findCycles() {
    const adj = new Map();
    for (const v of this.vertices) adj.set(v.id, []);
    for (const s of this.segments) {
      adj.get(s.aId).push({ to: s.bId, segId: s.id });
      adj.get(s.bId).push({ to: s.aId, segId: s.id });
    }
    const cycles = [];
    const seen = new Set();

    const canonical = (cyc) => {
      let best = null;
      for (const seq of [cyc, [...cyc].reverse()]) {
        let minIdx = 0;
        for (let i = 1; i < seq.length; i++) if (seq[i] < seq[minIdx]) minIdx = i;
        const rotated = [...seq.slice(minIdx), ...seq.slice(0, minIdx)];
        const key = rotated.join(",");
        if (best === null || key < best) best = key;
      }
      return best;
    };

    const dfs = (start, current, visited, path, usedSegs) => {
      if (cycles.length >= MAX_CYCLES) return;
      for (const { to, segId } of adj.get(current) || []) {
        if (cycles.length >= MAX_CYCLES) return;
        if (usedSegs.has(segId)) continue;
        if (to === start && path.length >= 3) {
          const key = canonical(path);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push([...path]);
          }
          continue;
        }
        if (visited.has(to) || path.length >= MAX_CYCLE_LEN) continue;
        visited.add(to);
        path.push(to);
        usedSegs.add(segId);
        dfs(start, to, visited, path, usedSegs);
        path.pop();
        usedSegs.delete(segId);
        visited.delete(to);
      }
    };

    for (const v of this.vertices) {
      dfs(v.id, v.id, new Set([v.id]), [v.id], new Set());
    }
    return cycles;
  }

  // --- editing --------------------------------------------------------------

  setSegmentLength(segId, units) {
    const seg = this.segments.find((s) => s.id === segId);
    if (!seg) return;
    seg.lengthLocked = true;
    seg.lengthLockUnits = Math.max(0.2, units);
    const A = this.getVertex(seg.aId);
    const B = this.getVertex(seg.bId);
    const newB = pointOnRay(A, B, seg.lengthLockUnits * PX_PER_UNIT);
    B.x = newB.x;
    B.y = newB.y;
    this.reapplyLengthLocks();
    this.reapplyAngleLocks();
    this.verifyLocks();
    this.notifyChange();
  }

  setSegmentColor(segId, hex) {
    const seg = this.segments.find((s) => s.id === segId);
    if (seg) {
      seg.color = hex;
      this.notifyChange();
    }
  }

  setVertexLabel(vId, label) {
    const v = this.getVertex(vId);
    if (v) {
      v.label = label.slice(0, 4) || v.label;
      this.notifyChange();
    }
  }

  // Rotates the far endpoint of the second ray around the shared junction vertex
  // to hit the target angle, keeping the first ray's endpoint fixed -- only valid
  // at a real shared-vertex junction (never at a mere geometric crossing).
  setJunctionAngle(pairKey, newDeg) {
    const [ray1, ray2] = pairKey.split("|");
    const info1 = this.rayInfo(ray1);
    const info2 = this.rayInfo(ray2);
    if (!info1 || !info2 || info1.pivotId !== info2.pivotId) return;
    const pivot = this.getVertex(info1.pivotId);
    const F = this.getVertex(info1.farId);
    const R = this.getVertex(info2.farId);
    if (!pivot || !F || !R) return;

    newDeg = clamp(newDeg, 1, 178);
    const dirF = Math.atan2(F.y - pivot.y, F.x - pivot.x);
    const dirR = Math.atan2(R.y - pivot.y, R.x - pivot.x);
    let diff = ((dirR - dirF + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const sign = diff >= 0 ? 1 : -1;
    const delta = sign * newDeg * (Math.PI / 180) - diff;
    const newR = rotatePoint(R, pivot, (delta * 180) / Math.PI);
    R.x = newR.x;
    R.y = newR.y;

    this.angleLocks[pairKey] = newDeg;
    this.reapplyLengthLocks();
    this.reapplyAngleLocks();
    this.verifyLocks();
    this.notifyChange();
  }

  setFillColor(cycleKey, color) {
    this.fillColors[cycleKey] = color;
    this.notifyChange();
  }

  // A uniform scale preserves angles; a rotation preserves distances -- so applying
  // every locked length first, then every locked angle, lets both kinds of lock
  // hold simultaneously as long as they don't directly contradict each other.
  reapplyLengthLocks() {
    for (const s of this.segments) {
      if (!s.lengthLocked) continue;
      const A = this.getVertex(s.aId);
      const B = this.getVertex(s.bId);
      if (!A || !B) continue;
      const newB = pointOnRay(A, B, s.lengthLockUnits * PX_PER_UNIT);
      B.x = newB.x;
      B.y = newB.y;
    }
  }

  reapplyAngleLocks() {
    for (const [pairKey, targetDeg] of Object.entries(this.angleLocks)) {
      const [ray1, ray2] = pairKey.split("|");
      const info1 = this.rayInfo(ray1);
      const info2 = this.rayInfo(ray2);
      if (!info1 || !info2 || info1.pivotId !== info2.pivotId) continue;
      const pivot = this.getVertex(info1.pivotId);
      const F = this.getVertex(info1.farId);
      const R = this.getVertex(info2.farId);
      if (!pivot || !F || !R) continue;
      const dirF = Math.atan2(F.y - pivot.y, F.x - pivot.x);
      const dirR = Math.atan2(R.y - pivot.y, R.x - pivot.x);
      let diff = ((dirR - dirF + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const sign = diff >= 0 ? 1 : -1;
      const delta = sign * targetDeg * (Math.PI / 180) - diff;
      const newR = rotatePoint(R, pivot, (delta * 180) / Math.PI);
      R.x = newR.x;
      R.y = newR.y;
    }
  }

  // Safety net: drop any lock that's no longer actually satisfied by the
  // resulting geometry, rather than let it keep showing a lock icon while lying.
  verifyLocks() {
    for (const s of this.segments) {
      if (!s.lengthLocked) continue;
      const A = this.getVertex(s.aId);
      const B = this.getVertex(s.bId);
      if (!A || !B || Math.abs(dist(A, B) / PX_PER_UNIT - s.lengthLockUnits) > 0.05) {
        s.lengthLocked = false;
      }
    }
    for (const key of Object.keys(this.angleLocks)) {
      const [ray1, ray2] = key.split("|");
      const info1 = this.rayInfo(ray1);
      const info2 = this.rayInfo(ray2);
      if (!info1 || !info2 || info1.pivotId !== info2.pivotId) {
        delete this.angleLocks[key];
        continue;
      }
      const pivot = this.getVertex(info1.pivotId);
      const F = this.getVertex(info1.farId);
      const R = this.getVertex(info2.farId);
      if (!pivot || !F || !R) {
        delete this.angleLocks[key];
        continue;
      }
      const dirF = Math.atan2(F.y - pivot.y, F.x - pivot.x);
      const dirR = Math.atan2(R.y - pivot.y, R.x - pivot.x);
      let diff = Math.abs(((dirR - dirF + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const actualDeg = (diff * 180) / Math.PI;
      if (Math.abs(actualDeg - this.angleLocks[key]) > 0.2) delete this.angleLocks[key];
    }
  }

  // For exactly 2 rays (a plain vertex where 2 segments meet, the common case),
  // there are 2 complementary angles around the point (summing to 360) -- only the
  // non-reflex one (<=180) is ever meaningful to a teacher, so just that one is
  // returned. For 3+ rays (a fan, or 2 segments crossing), every consecutive gap
  // around the point is a real, distinct angle worth showing.
  anglePairsForJunction(junction) {
    const rays = [...junction.rays].sort((a, b) => a.dirRad - b.dirRad);
    const n = rays.length;
    if (n === 2) {
      const a1 = rays[0].dirRad;
      const a2 = rays[1].dirRad;
      const sweep = a2 - a1;
      if (sweep <= Math.PI) return [{ r1: rays[0], r2: rays[1], a1, a2, sweep }];
      return [
        {
          r1: rays[1],
          r2: rays[0],
          a1: rays[1].dirRad,
          a2: rays[0].dirRad + 2 * Math.PI,
          sweep: 2 * Math.PI - sweep,
        },
      ];
    }
    const pairs = [];
    for (let i = 0; i < n; i++) {
      const r1 = rays[i];
      const r2 = rays[(i + 1) % n];
      const a1 = r1.dirRad;
      const a2 = r2.dirRad + (i === n - 1 ? 2 * Math.PI : 0);
      pairs.push({ r1, r2, a1, a2, sweep: a2 - a1 });
    }
    return pairs;
  }

  unlockField(key) {
    if (key.startsWith("seglen:")) {
      const seg = this.segments.find((s) => s.id === key.slice(7));
      if (seg) seg.lengthLocked = false;
    } else if (key.startsWith("vangle:")) {
      delete this.angleLocks[key.slice(7)];
    }
    this.notifyChange();
  }

  notifyChange() {
    this.render();
    if (this.controller?.onChange) this.controller.onChange(this);
  }

  // --- sidebar field descriptors ---------------------------------------------

  getFields() {
    const fields = [];
    for (const v of this.vertices) {
      fields.push({
        key: `vlabel:${v.id}`,
        group: "Points",
        label: `Point (${v.label})`,
        kind: "text",
        value: v.labelOverride !== undefined ? v.labelOverride : v.label,
      });
    }
    this.segments.forEach((s, i) => {
      const A = this.getVertex(s.aId);
      const B = this.getVertex(s.bId);
      const group = `Line ${i + 1} (${A?.label ?? "?"}${B?.label ?? "?"})`;
      const lengthUnits = round1(dist(A, B) / PX_PER_UNIT);
      fields.push({
        key: `seglen:${s.id}`,
        group,
        label: "Length",
        kind: "length",
        locked: s.lengthLocked,
        value: s.lengthOverride !== undefined ? s.lengthOverride : lengthUnits,
      });
      fields.push({ key: `segcolor:${s.id}`, group, label: "Line color", kind: "color", value: s.color });
    });

    for (const junction of this.computeJunctions()) {
      const groupLabel = junction.vertexId
        ? `Angle at ${this.getVertex(junction.vertexId)?.label ?? "?"}`
        : "Angles (crossing)";
      const pairs = this.anglePairsForJunction(junction);
      const isVertexJunction = !!junction.vertexId;
      pairs.forEach(({ r1, r2, sweep }, i) => {
        const deg = round1((sweep * 180) / Math.PI);
        const pairKey = [r1.rayId, r2.rayId].sort().join("|");
        const key = isVertexJunction ? `vangle:${pairKey}` : `xangle:${pairKey}`;
        const override = this.angleOverrides[pairKey];
        fields.push({
          key,
          group: groupLabel,
          label: pairs.length > 1 ? `Angle ${i + 1}` : "Angle",
          kind: "angle",
          locked: isVertexJunction && this.angleLocks[pairKey] != null,
          value: override !== undefined ? override : deg,
        });
      });
    }

    for (const cycle of this.findCycles()) {
      const key = this.cycleKey(cycle);
      const names = cycle.map((id) => this.getVertex(id)?.label ?? "?").join("");
      fields.push({
        key: `fill:${key}`,
        group: `Fill (${names})`,
        label: "Color",
        kind: "swatch",
        value: this.fillColors[key] || "none",
      });
    }

    return fields;
  }

  cycleKey(cycle) {
    let best = null;
    for (const seq of [cycle, [...cycle].reverse()]) {
      let minIdx = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] < seq[minIdx]) minIdx = i;
      const rotated = [...seq.slice(minIdx), ...seq.slice(0, minIdx)];
      const key = rotated.join(",");
      if (best === null || key < best) best = key;
    }
    return best;
  }

  setField(key, value) {
    if (key.startsWith("vlabel:")) {
      const vId = key.slice(7);
      const parsed = parseFieldInput(value);
      const v = this.getVertex(vId);
      if (!v) return;
      if (parsed.numeric !== undefined) this.setVertexLabel(vId, String(parsed.numeric));
      else if (parsed.label !== undefined) this.setVertexLabel(vId, parsed.label);
      else {
        v.labelOverride = "";
        this.notifyChange();
      }
      return;
    }
    if (key.startsWith("seglen:")) {
      const segId = key.slice(7);
      const seg = this.segments.find((s) => s.id === segId);
      if (!seg) return;
      const parsed = parseFieldInput(value);
      if (parsed.numeric !== undefined) {
        seg.lengthOverride = undefined;
        this.setSegmentLength(segId, parsed.numeric);
      } else if (parsed.label !== undefined) {
        seg.lengthOverride = parsed.label;
        seg.lengthLocked = false;
        this.notifyChange();
      } else {
        seg.lengthOverride = "";
        seg.lengthLocked = false;
        this.notifyChange();
      }
      return;
    }
    if (key.startsWith("segcolor:")) {
      this.setSegmentColor(key.slice(9), value);
      return;
    }
    if (key.startsWith("vangle:") || key.startsWith("xangle:")) {
      const isVertexJunction = key.startsWith("vangle:");
      const pairKey = key.slice(7);
      const parsed = parseFieldInput(value);
      if (isVertexJunction && parsed.numeric !== undefined) {
        delete this.angleOverrides[pairKey];
        this.setJunctionAngle(pairKey, parsed.numeric);
      } else if (parsed.hidden) {
        this.angleOverrides[pairKey] = "";
        delete this.angleLocks[pairKey];
        this.notifyChange();
      } else {
        this.angleOverrides[pairKey] = parsed.numeric !== undefined ? String(parsed.numeric) : parsed.label;
        delete this.angleLocks[pairKey];
        this.notifyChange();
      }
      return;
    }
    if (key.startsWith("fill:")) {
      this.setFillColor(key.slice(5), value);
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

  render() {
    if (!this.group) return;
    clear(this.group);
    if (this.vertices.length === 0) return;

    const fillsLayer = el("g");
    const segLayer = el("g");
    const markLayer = el("g");
    const angleLayer = el("g");
    const handleLayer = el("g");
    this.group.appendChild(fillsLayer);
    this.group.appendChild(segLayer);
    this.group.appendChild(markLayer);
    this.group.appendChild(angleLayer);
    this.group.appendChild(handleLayer);

    for (const cycle of this.findCycles()) {
      const key = this.cycleKey(cycle);
      const color = this.fillColors[key];
      if (!color || color === "none") continue;
      const pts = cycle.map((id) => this.getVertex(id)).filter(Boolean);
      if (pts.length !== cycle.length) continue;
      fillsLayer.appendChild(
        el("polygon", { points: pts.map((p) => `${p.x},${p.y}`).join(" "), fill: color, stroke: "none" })
      );
    }

    this.renderFamilyMarks(markLayer);

    for (const s of this.segments) {
      segLayer.appendChild(this.renderSegment(s));
    }

    for (const junction of this.computeJunctions()) {
      angleLayer.appendChild(this.renderJunctionAngles(junction));
    }

    for (const v of this.vertices) {
      handleLayer.appendChild(this.renderVertexLabel(v));
      handleLayer.appendChild(this.renderSproutHandle(v));
      handleLayer.appendChild(this.renderVertexHandle(v));
    }

    handleLayer.appendChild(this.renderRotateHandle());
  }

  renderSegment(s) {
    const A = this.getVertex(s.aId);
    const B = this.getVertex(s.bId);
    const g = el("g");
    const cls = this.selected ? "selected" : "";

    const hit = el("line", { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: "transparent", "stroke-width": 16 });
    hit.style.cursor = "grab";
    hit.addEventListener("pointerdown", (e) => this.onBodyPointerDown(e));
    g.appendChild(hit);
    g.appendChild(
      el("line", { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: s.color, "stroke-width": cls ? 3 : 2 })
    );

    const mid = midpoint(A, B);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offset = 16;
    const hidden = s.lengthOverride === "";
    const lengthUnits = round1(len / PX_PER_UNIT);
    const displayValue = s.lengthOverride !== undefined ? s.lengthOverride : lengthUnits;
    g.appendChild(
      renderRemovableLabel({
        x: mid.x + nx * offset,
        y: mid.y + ny * offset,
        value: displayValue,
        hidden,
        cssClass: "side-label",
        onRemove: () => this.setField(`seglen:${s.id}`, ""),
        onRestore: (e) => this.startInlineEdit(e, `seglen:${s.id}`, lengthUnits),
        onDoubleClick: (e) => this.startInlineEdit(e, `seglen:${s.id}`, displayValue),
      })
    );

    // small delete control for the segment itself, offset to the other side
    const delPos = { x: mid.x - nx * offset, y: mid.y - ny * offset };
    const delGroup = el("g", { class: "segment-delete-group" });
    delGroup.style.cursor = "pointer";
    const circle = el("circle", { cx: delPos.x, cy: delPos.y, r: 7, class: "segment-delete" });
    const sz = 3;
    const xmark = el("path", {
      d: `M ${delPos.x - sz} ${delPos.y - sz} L ${delPos.x + sz} ${delPos.y + sz} M ${delPos.x + sz} ${delPos.y - sz} L ${delPos.x - sz} ${delPos.y + sz}`,
      class: "segment-delete-x",
    });
    delGroup.appendChild(circle);
    delGroup.appendChild(xmark);
    delGroup.addEventListener("pointerdown", (e) => e.stopPropagation());
    delGroup.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeSegment(s.id);
    });
    g.appendChild(delGroup);

    return g;
  }

  renderFamilyMarks(container) {
    const dirGroups = this.clusterSegments((s) => {
      const A = this.getVertex(s.aId);
      const B = this.getVertex(s.bId);
      const d = (((Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI) % 180 + 180) % 180;
      return d;
    }, 1.5);
    const lenGroups = this.clusterSegments((s) => {
      const A = this.getVertex(s.aId);
      const B = this.getVertex(s.bId);
      return dist(A, B) / PX_PER_UNIT;
    }, 0.05);

    this.segments.forEach((s, i) => {
      const A = this.getVertex(s.aId);
      const B = this.getVertex(s.bId);
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const dir = { x: dx / len, y: dy / len };
      const mid = midpoint(A, B);

      const dirGroup = dirGroups[i];
      if (dirGroup.size >= 2) {
        const pos = { x: mid.x - dir.x * 16, y: mid.y - dir.y * 16 };
        container.appendChild(this.drawChevronMarks(pos, dir, Math.min(dirGroup.index + 1, 3)));
      }
      const lenGroup = lenGroups[i];
      if (lenGroup.size >= 2) {
        const pos = { x: mid.x + dir.x * 16, y: mid.y + dir.y * 16 };
        container.appendChild(this.drawTickMarks(pos, dir, Math.min(lenGroup.index + 1, 3)));
      }
    });
  }

  // Groups segments by a numeric key within `tolerance`, in family-of-first-appearance
  // order. Returns one {index, size} per segment (same order as this.segments).
  clusterSegments(keyFn, tolerance) {
    const keys = this.segments.map(keyFn);
    const order = keys.map((_, i) => i).sort((a, b) => keys[a] - keys[b]);
    const groupIndexByOrder = new Array(this.segments.length);
    let groupCount = -1;
    let groupStart = null;
    for (const idx of order) {
      if (groupStart === null || keys[idx] - groupStart > tolerance) {
        groupCount += 1;
        groupStart = keys[idx];
      }
      groupIndexByOrder[idx] = groupCount;
    }
    const sizes = new Array(groupCount + 1).fill(0);
    for (const g of groupIndexByOrder) sizes[g] += 1;
    return groupIndexByOrder.map((g) => ({ index: g, size: sizes[g] }));
  }

  drawChevronMarks(pos, dir, count) {
    const g = el("g");
    const spacing = 7;
    const perp = { x: -dir.y, y: dir.x };
    const size = 7;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spacing;
      const base = { x: pos.x + dir.x * off, y: pos.y + dir.y * off };
      const p1 = { x: base.x - dir.x * size + perp.x * size, y: base.y - dir.y * size + perp.y * size };
      const p2 = { x: base.x + dir.x * size, y: base.y + dir.y * size };
      const p3 = { x: base.x - dir.x * size - perp.x * size, y: base.y - dir.y * size - perp.y * size };
      g.appendChild(
        el("path", { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y}`, class: "parallel-chevron" })
      );
    }
    return g;
  }

  drawTickMarks(pos, dir, count) {
    const g = el("g");
    const spacing = 6;
    const perp = { x: -dir.y, y: dir.x };
    const half = 4.5;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spacing;
      const base = { x: pos.x + dir.x * off, y: pos.y + dir.y * off };
      const a = { x: base.x + (perp.x + dir.x) * half, y: base.y + (perp.y + dir.y) * half };
      const b = { x: base.x - (perp.x + dir.x) * half, y: base.y - (perp.y + dir.y) * half };
      g.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "equal-length-tick" }));
    }
    return g;
  }

  renderJunctionAngles(junction) {
    const pairs = this.anglePairsForJunction(junction);
    const point = junction.point;
    const g = el("g");
    const r = 18 + (junction.rays.length > 4 ? 6 : 0);
    const isVertexJunction = !!junction.vertexId;

    for (const { r1, r2, a1, a2, sweep } of pairs) {
      const deg = round1((sweep * 180) / Math.PI);
      const pairKey = [r1.rayId, r2.rayId].sort().join("|");
      const fieldKey = isVertexJunction ? `vangle:${pairKey}` : `xangle:${pairKey}`;
      const hidden = this.angleOverrides[pairKey] === "";
      const isRight = Math.abs(deg - 90) < RIGHT_ANGLE_TOLERANCE;

      const bis = a1 + sweep / 2;
      const labelR = r + 15;
      const lp = { x: point.x + labelR * Math.cos(bis), y: point.y + labelR * Math.sin(bis) };

      if (hidden) {
        g.appendChild(
          renderRemovableLabel({
            x: lp.x,
            y: lp.y,
            hidden: true,
            onRestore: (e) => this.startInlineEdit(e, fieldKey, deg),
          })
        );
        continue;
      }

      if (isRight) {
        const size = 14;
        const uF = { x: Math.cos(a1), y: Math.sin(a1) };
        const uR = { x: Math.cos(a2), y: Math.sin(a2) };
        const p1 = { x: point.x + uF.x * size, y: point.y + uF.y * size };
        const p2 = { x: point.x + uF.x * size + uR.x * size, y: point.y + uF.y * size + uR.y * size };
        const p3 = { x: point.x + uR.x * size, y: point.y + uR.y * size };
        g.appendChild(
          el("path", { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y}`, class: "right-angle-mark" })
        );
      } else {
        const start = { x: point.x + r * Math.cos(a1), y: point.y + r * Math.sin(a1) };
        const end = { x: point.x + r * Math.cos(a2), y: point.y + r * Math.sin(a2) };
        const largeArc = sweep > Math.PI ? 1 : 0;
        g.appendChild(
          el("path", { d: `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`, class: "angle-arc" })
        );
      }

      const override = this.angleOverrides[pairKey];
      const displayValue = override !== undefined && override !== "" ? override : `${deg}°`;
      g.appendChild(
        renderRemovableLabel({
          x: lp.x,
          y: lp.y,
          value: displayValue,
          hidden: false,
          cssClass: "angle-label",
          onRemove: () => this.setField(fieldKey, ""),
          onDoubleClick: (e) => this.startInlineEdit(e, fieldKey, displayValue),
        })
      );
    }
    return g;
  }

  renderVertexLabel(v) {
    const hidden = v.labelOverride === "";
    const displayValue = v.labelOverride !== undefined && v.labelOverride !== "" ? v.labelOverride : v.label;
    const c = this.centroid();
    const dx = v.x - c.x;
    const dy = v.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const pos = { x: v.x + (dx / len) * 20, y: v.y + (dy / len) * 20 };
    return renderRemovableLabel({
      x: pos.x,
      y: pos.y,
      value: displayValue,
      hidden,
      cssClass: "vertex-label",
      onRemove: () => this.setField(`vlabel:${v.id}`, ""),
      onRestore: (e) => this.startInlineEdit(e, `vlabel:${v.id}`, v.label),
      onDoubleClick: (e) => this.startInlineEdit(e, `vlabel:${v.id}`, displayValue),
    });
  }

  renderVertexHandle(v) {
    const c = el("circle", { cx: v.x, cy: v.y, r: 6, class: "vertex-handle" });
    c.addEventListener("pointerdown", (e) => this.onVertexPointerDown(e, v.id));
    return c;
  }

  // Small dashed nub near each vertex -- drag it out to sprout a brand new
  // connected segment from that vertex.
  renderSproutHandle(v) {
    const touching = this.touchingSegments(v.id);
    let angle = -Math.PI / 2;
    if (touching.length > 0) {
      const dirs = touching.map((s) => {
        const otherId = s.aId === v.id ? s.bId : s.aId;
        const other = this.getVertex(otherId);
        return Math.atan2(other.y - v.y, other.x - v.x);
      });
      const avgX = dirs.reduce((s, d) => s + Math.cos(d), 0) / dirs.length;
      const avgY = dirs.reduce((s, d) => s + Math.sin(d), 0) / dirs.length;
      angle = Math.atan2(avgY, avgX) + Math.PI;
    }
    const pos = { x: v.x + Math.cos(angle) * 22, y: v.y + Math.sin(angle) * 22 };
    const c = el("circle", { cx: pos.x, cy: pos.y, r: 5, class: "new-vertex-handle" });
    c.addEventListener("pointerdown", (e) => this.onSproutPointerDown(e, v.id));
    return c;
  }

  renderRotateHandle() {
    const c = this.centroid();
    const maxR = Math.max(...this.vertices.map((v) => dist(v, c)), 10);
    const handleR = maxR + 32;
    const pos = { x: c.x, y: c.y - handleR };
    const g = el("g");
    g.appendChild(el("line", { x1: c.x, y1: c.y, x2: pos.x, y2: pos.y, class: "rotate-handle-line" }));
    const handle = el("circle", { cx: pos.x, cy: pos.y, r: 6, class: "rotate-handle" });
    handle.addEventListener("pointerdown", (e) => this.onRotatePointerDown(e));
    g.appendChild(handle);
    return g;
  }

  // --- interaction ---------------------------------------------------------

  onBodyPointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const start = toSvgPoint(svg, e.clientX, e.clientY);
    const startPositions = this.vertices.map((v) => ({ id: v.id, x: v.x, y: v.y }));
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      for (const sp of startPositions) {
        const v = this.getVertex(sp.id);
        v.x = sp.x + dx;
        v.y = sp.y + dy;
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

  onVertexPointerDown(e, vId) {
    e.stopPropagation();
    this.select();
    const seg = this.touchingSegments(vId);
    for (const s of seg) s.lengthLocked = false;
    for (const key of Object.keys(this.angleLocks)) {
      const [r1, r2] = key.split("|");
      const i1 = this.rayInfo(r1);
      const i2 = this.rayInfo(r2);
      if (i1?.pivotId === vId || i2?.pivotId === vId || i1?.farId === vId || i2?.farId === vId) {
        delete this.angleLocks[key];
      }
    }
    const svg = this.group.ownerSVGElement;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const v = this.getVertex(vId);
      v.x = cur.x;
      v.y = cur.y;
      this.render();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const target = this.findSnapTarget(vId);
      if (target) this.mergeVertices(target.id, vId);
      if (this.controller?.onChange) this.controller.onChange(this);
      this.render();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  onSproutPointerDown(e, fromVertexId) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const from = this.getVertex(fromVertexId);
    const start = toSvgPoint(svg, e.clientX, e.clientY);
    const newVertex = this.addVertex(start.x, start.y);
    const seg = {
      id: this.nextSegmentId(),
      aId: fromVertexId,
      bId: newVertex.id,
      color: DEFAULT_COLOR,
      lengthLocked: false,
      lengthLockUnits: null,
      lengthOverride: undefined,
    };
    this.segments.push(seg);
    this.render();
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      newVertex.x = cur.x;
      newVertex.y = cur.y;
      this.render();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const target = this.findSnapTarget(newVertex.id);
      if (target) this.mergeVertices(target.id, newVertex.id);
      if (this.controller?.onChange) this.controller.onChange(this);
      this.render();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  onRotatePointerDown(e) {
    e.stopPropagation();
    this.select();
    const svg = this.group.ownerSVGElement;
    const c = this.centroid();
    const startPositions = this.vertices.map((v) => ({ id: v.id, x: v.x, y: v.y }));
    const startMouse = toSvgPoint(svg, e.clientX, e.clientY);
    const startDeg = (Math.atan2(startMouse.y - c.y, startMouse.x - c.x) * 180) / Math.PI;
    const onMove = (ev) => {
      const cur = toSvgPoint(svg, ev.clientX, ev.clientY);
      const curDeg = (Math.atan2(cur.y - c.y, cur.x - c.x) * 180) / Math.PI;
      const delta = curDeg - startDeg;
      for (const sp of startPositions) {
        const v = this.getVertex(sp.id);
        const np = rotatePoint({ x: sp.x, y: sp.y }, c, delta);
        v.x = np.x;
        v.y = np.y;
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
