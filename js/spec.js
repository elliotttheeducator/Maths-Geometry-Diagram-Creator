import { Triangle } from "./shapes/triangle.js";
import { ParallelLines } from "./shapes/parallelLines.js";
import { LineGraph } from "./shapes/lineGraph.js";
import { Circle } from "./shapes/circle.js";
import { Quadrilateral } from "./shapes/quadrilateral.js";
import { Prism } from "./shapes/prism.js";
import { RegularPolygon } from "./shapes/polygon.js";
import { PX_PER_UNIT, round1 } from "./geometry.js";

// A tiny written format for diagrams, so a diagram can be asked for in one line
// instead of built by hand:
//
//   triangle a=80 b=80 ab=6 fill=cream
//   ---
//   prism base=poly n=6 side=2 depth=5 hidden
//
// Every key maps onto a real sidebar field, and the shape is driven through the same
// setField() calls the sidebar makes -- so a spec'd diagram goes through exactly the
// same solver, locks and honesty checks as a hand-built one, and can be picked up and
// edited afterwards. `---` on its own line starts a new diagram.

const ORIGIN = { x: 300, y: 480 }; // where path coordinates put (0,0)

export function parseSpec(text) {
  const diagrams = [[]];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (/^-{3,}$/.test(line)) {
      diagrams.push([]);
      continue;
    }
    diagrams[diagrams.length - 1].push(parseLine(line));
  }
  return diagrams.filter((d) => d.length > 0);
}

function parseLine(line) {
  const tokens = line.split(/\s+/);
  const type = tokens.shift().toLowerCase();
  const args = [];
  const points = [];
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq > 0) {
      args.push([tok.slice(0, eq).toLowerCase(), tok.slice(eq + 1)]);
    } else if (/^-?[\d.]+,-?[\d.]+$/.test(tok)) {
      const [x, y] = tok.split(",").map(Number);
      points.push({ x, y });
    } else {
      args.push([tok.toLowerCase(), true]); // bare word = flag
    }
  }
  return { type, args, points, raw: line };
}

// Builds one diagram's shapes. Unknown keys are collected rather than thrown, so a
// nearly-right spec still draws something and says what it ignored.
export function buildDiagram(items) {
  const shapes = [];
  const warnings = [];
  for (const item of items) {
    try {
      const shape = buildShape(item, warnings);
      if (shape) shapes.push(shape);
      else warnings.push(`Unknown shape "${item.type}" -- ${SHAPE_LIST}`);
    } catch (err) {
      warnings.push(`${item.raw} -- ${err.message}`);
    }
  }
  return { shapes, warnings };
}

const SHAPE_LIST = "try triangle, rect, para, polygon, circle, sector, prism, parallel or path";

// Every measurement a shape can print next to itself. A spec'd diagram labels only
// the ones the spec actually mentions and stays silent about the rest -- because a
// diagram that labels everything answers its own question, and only the person
// writing the question knows which number is the given and which is the answer.
// (Everything stays there to be switched back on: a hidden label leaves a small plus.)
const LABEL_KEYS = {
  triangle: ["angle-0", "angle-1", "angle-2", "side-0", "side-1", "side-2"],
  quadrilateral: ["base", "side", "angle", "height"],
  polygon: ["side"],
  circle: ["radius", "angle", "arc"],
  prism: ["width", "height", "depth", "side"],
};

function buildShape(item, warnings) {
  const { type, args, points } = item;
  const note = (key) => warnings.push(`Ignored "${key}" on ${type}`);
  const mentioned = new Set();
  const mark = (...keys) => keys.forEach((k) => mentioned.add(k));

  const warn = (message) => warnings.push(message);

  let shape = null;
  if (type === "triangle") shape = buildTriangle(args, note, mark, warn);
  else if (type === "rect" || type === "rectangle" || type === "square")
    shape = buildQuad(args, note, mark, "rectangle", type === "square");
  else if (type === "para" || type === "parallelogram") shape = buildQuad(args, note, mark, "parallelogram", false);
  else if (type === "polygon" || type === "pentagon" || type === "hexagon" || type === "octagon")
    shape = buildPolygon(type, args, note, mark);
  else if (type === "circle" || type === "sector" || type === "arc") shape = buildCircle(type, args, note, mark);
  else if (type === "prism") shape = buildPrism(args, note, mark);
  else if (type === "parallel" || type === "lines") shape = buildParallel(args, note);
  else if (type === "path" || type === "shape") shape = buildPath(points, args, note);
  if (!shape) return null;

  const labelKeys = LABEL_KEYS[shape.type];
  if (labelKeys) for (const key of labelKeys) if (!mentioned.has(key)) shape.setField(key, "");
  return shape;
}

// --- per-shape builders ---------------------------------------------------
//
// Args are applied in written order, because order is meaningful: "a=80 b=80 ab=6"
// locks two angles and then scales to the side, which is a different (and correct)
// construction from doing it the other way round.

function buildTriangle(args, note, mark, warn) {
  const t = new Triangle({});
  t.showVertexLabels = false; // letters only when the spec asks for them
  const ANGLES = { a: 0, b: 1, c: 2 };
  const SIDES = { ab: 0, bc: 1, ca: 2 };
  for (const [key, value] of args) {
    // A value the triangle refused (no such triangle exists) is reported rather than
    // quietly fudged into one that does.
    if (t.lastRefusal) {
      warn(t.lastRefusal);
      t.lastRefusal = null;
    }
    if (key in ANGLES) {
      t.setField(`angle-${ANGLES[key]}`, value);
      mark(`angle-${ANGLES[key]}`);
    } else if (key in SIDES) {
      t.setField(`side-${SIDES[key]}`, value);
      mark(`side-${SIDES[key]}`);
    } else if (key === "labels") {
      t.showVertexLabels = value !== "off";
      if (value !== true && value !== "off") splitList(value).forEach((l, i) => t.setField(`label-${i}`, l));
    } else if (key === "ext") {
      for (const which of splitList(value)) t.setField(`ext-toggle-${vertexIndex(which, t.labels)}`, true);
    } else if (key === "ticks") t.setField("show-ticks", value !== "off");
    else if (key === "seg") {
      t.setField("cevian-toggle", true);
      if (value !== true) t.setField("cevian-t", value);
    } else if (key === "fill") t.setField("fill", value);
    else note(key);
  }
  if (t.lastRefusal) {
    warn(t.lastRefusal);
    t.lastRefusal = null;
  }
  return t;
}

function buildQuad(args, note, mark, mode, isSquare) {
  const q = new Quadrilateral({ mode });
  // A labelled rectangle's opposite sides are equal by definition -- ticks saying so
  // are just more ink, so they're opt-in here.
  q.showTicks = false;
  if (mode === "parallelogram") q.setField("mode-parallelogram", true);
  for (const [key, value] of args) {
    if (key === "w" || key === "width" || key === "base") {
      q.setField("base", value);
      mark("base");
    } else if (key === "h" || key === "height" || key === "side") {
      // On a parallelogram a bare `height` flag shows the perpendicular height, while
      // `height=4` sets it; on a rectangle the two are the same measurement.
      if (value === true) {
        q.setField("show-height", true);
        mark("height");
      } else if (key === "height" && mode === "parallelogram") {
        q.setField("show-height", true);
        q.setField("height", value);
        mark("height");
      } else {
        q.setField("side", value);
        mark("side");
      }
    } else if (key === "angle") {
      q.setField("angle", value);
      mark("angle");
    }
    else if (key === "rot" || key === "rotation") q.setField("rotation", value);
    else if (key === "ticks") q.setField("show-ticks", value !== "off");
    else if (key === "labels") q.setField("show-labels", value !== "off");
    else if (key === "arrows") q.setField("dimension-style", value !== "off");
    else if (key === "fill") q.setField("fill", value);
    else note(key);
  }
  if (isSquare) q.setField("side", round1(q.baseUnits()));
  return q;
}

function buildPolygon(type, args, note, mark) {
  const preset = { pentagon: 5, hexagon: 6, octagon: 8 }[type];
  const p = new RegularPolygon({});
  if (preset) p.setField("sides", preset);
  for (const [key, value] of args) {
    if (key === "n" || key === "sides") p.setField("sides", value);
    else if (key === "side") {
      p.setField("side", value);
      mark("side");
    } else if (key === "r" || key === "radius") p.setField("radius", value);
    else if (key === "rot" || key === "rotation") p.setField("rotation", value);
    else if (key === "labels") p.setField("show-labels", value !== "off");
    else if (key === "mark" || key === "angle") p.setField("show-interior", value !== "off");
    else if (key === "ticks") p.setField("show-ticks", value !== "off");
    else if (key === "fill") p.setField("fill", value);
    else note(key);
  }
  return p;
}

function buildCircle(type, args, note, mark) {
  const c = new Circle({});
  if (type === "sector") c.setField("mode-sector", true);
  if (type === "arc") c.setField("mode-arc", true);
  for (const [key, value] of args) {
    if (key === "r" || key === "radius") {
      if (value === true) c.setField("show-radius", true);
      else c.setField("radius", value);
      mark("radius");
    } else if (key === "d" || key === "diameter") {
      c.setField("as-diameter", value !== "off");
      mark("radius");
    } else if (key === "angle") {
      c.setField("angle", value);
      mark("angle");
    } else if (key === "arc") {
      if (value !== true) c.setField("arc", value);
      mark("arc");
    } else if (key === "fill") c.setField("fill", value);
    else note(key);
  }
  return c;
}

const PRISM_BASES = { rect: "rectangle", rectangle: "rectangle", tri: "triangle", triangle: "triangle", para: "parallelogram", parallelogram: "parallelogram", poly: "polygon", polygon: "polygon" };

function buildPrism(args, note, mark) {
  const p = new Prism({});
  // The base has to be settled first: which measurements even exist depends on it.
  const baseArg = args.find(([k]) => k === "base");
  if (baseArg) {
    const kind = PRISM_BASES[String(baseArg[1]).toLowerCase()];
    if (!kind) throw new Error(`unknown base "${baseArg[1]}" -- use rect, tri, para or poly`);
    p.setField(`base-${kind}`, true);
  }
  for (const [key, value] of args) {
    if (key === "base") continue;
    else if (key === "w" || key === "width") {
      p.setField("width", value);
      mark("width");
    } else if (key === "h") {
      p.setField("height", value);
      mark("height");
    } else if (key === "height") {
      if (value === true) p.setField("show-apex-height", true);
      else p.setField("height", value);
      mark("height");
    } else if (key === "depth" || key === "d") {
      p.setField("depth", value);
      mark("depth");
    } else if (key === "angle") p.setField("slant", value);
    else if (key === "n" || key === "sides") p.setField("sides", value);
    else if (key === "side") {
      p.setField("side", value);
      mark("side");
    } else if (key === "r" || key === "radius") p.setField("radius", value);
    else if (key === "da" || key === "view") p.setField("depth-angle", value);
    else if (key === "hidden") p.setField("hidden-edges", value !== "off");
    else if (key === "fill") p.setField("fill", value);
    else note(key);
  }
  return p;
}

// Crossing angles are addressed as L<line><slot>, or T<transversal>L<line><slot> when
// there's more than one transversal. Slots run anticlockwise from below-right:
// a = below-right, b = below-left, c = above-left, d = above-right.
function parseAngleAddress(token) {
  const m = /^(?:t(\d+))?l(\d+)([a-d])$/i.exec(String(token).trim());
  if (!m) return null;
  const j = m[1] ? Number(m[1]) - 1 : 0;
  const k = Number(m[2]) - 1;
  const s = "abcd".indexOf(m[3].toLowerCase());
  return j >= 0 && k >= 0 ? `disp-T${j}-L${k}-${s}` : null;
}

function buildParallel(args, note) {
  const pl = new ParallelLines({});
  let show = null;
  const unknowns = [];
  for (const [key, value] of args) {
    if (key === "angle") pl.setField("trans-angle-0", value);
    else if (key === "angle2") pl.setField("trans-angle-1", value);
    else if (key === "dir" || key === "direction") pl.setField("line-angle", value);
    else if (key === "gap") pl.setField("gap", value);
    else if (key === "lines") pl.setField("add-line", Number(value) >= 3);
    else if (key === "transversals" || key === "trans") pl.setField("add-transversal", Number(value) >= 2);
    else if (key === "show") show = String(value);
    else if (key === "x" || key === "unknown") unknowns.push(...splitList(value));
    else note(key);
  }

  // Four angles at every crossing means up to 24 numbers on one diagram, which turns
  // a question into its own answer key. Only the given angle is labelled unless the
  // spec asks for more.
  const everyKey = [];
  for (let j = 0; j < pl.transversals.length; j++) {
    for (let k = 0; k < pl.lineCount; k++) {
      for (let s = 0; s < 4; s++) everyKey.push(`disp-T${j}-L${k}-${s}`);
    }
  }

  const showKeys = new Set();
  if (show === "all") everyKey.forEach((key) => showKeys.add(key));
  else if (show) {
    for (const token of splitList(show)) {
      const key = parseAngleAddress(token);
      if (key) showKeys.add(key);
      else note(`show=${token}`);
    }
  } else {
    showKeys.add("disp-T0-L0-0"); // slot a of the first crossing IS the given angle
  }

  const labelled = new Map();
  for (const token of unknowns) {
    const [addr, text] = String(token).split(":");
    const key = parseAngleAddress(addr);
    if (key) labelled.set(key, text || "x");
    else note(`x=${token}`);
  }

  for (const key of everyKey) {
    if (labelled.has(key)) pl.setField(key, labelled.get(key));
    else if (!showKeys.has(key)) pl.setField(key, "");
  }
  return pl;
}

// `path 0,0 6,0 6,3 3,3 3,5 0,5 close fill=cream` -- the irregular composite outlines
// that area questions are built from. Coordinates are in units with y pointing up,
// which is how they'd be read off a question, not screen-down.
function buildPath(points, args, note) {
  if (points.length < 2) throw new Error("path needs at least two x,y points");
  const g = new LineGraph({});
  let closed = false;
  let fill = null;
  let showAngles = false;
  let showMarks = false;
  for (const [key, value] of args) {
    if (key === "close" || key === "closed") closed = value !== "off";
    else if (key === "fill") fill = value;
    else if (key === "angles") showAngles = value !== "off";
    else if (key === "marks") showMarks = value !== "off";
    else note(key);
  }
  // On an outline every horizontal side is parallel to every other one, so the
  // chevron/tick notation fires everywhere and buries the measurements.
  g.showParallelMarks = showMarks;
  g.showEqualMarks = showMarks;
  g.buildPath(
    points.map((p) => ({ x: ORIGIN.x + p.x * PX_PER_UNIT, y: ORIGIN.y - p.y * PX_PER_UNIT })),
    { closed: closed || fill !== null }
  );
  if (fill) g.fillAllCycles(fill);
  // An outline's corners are nearly always right angles; labelling all of them buries
  // the side lengths, so they start hidden unless the spec asks for them.
  if (!showAngles) g.hideAllAngles();
  return g;
}

function splitList(value) {
  return String(value).split(/[,/]/).map((s) => s.trim()).filter(Boolean);
}

function vertexIndex(which, labels) {
  const asNumber = Number(which);
  if (Number.isFinite(asNumber)) return Math.max(0, Math.min(2, asNumber - 1));
  const found = labels.findIndex((l) => l.toLowerCase() === String(which).toLowerCase());
  return found >= 0 ? found : 0;
}

// --- the other direction: shapes back to spec text ------------------------
//
// So a diagram built by hand in the app can be copied back out as a line a chat can
// reuse or tweak, instead of being a dead end.

// Renders the flags that are switched on, so a diagram styled in the app comes back
// out looking the same rather than reset to defaults.
function flags(map) {
  const on = Object.entries(map)
    .filter(([, isOn]) => isOn)
    .map(([word]) => word);
  return on.length ? ` ${on.join(" ")}` : "";
}

export function shapeToSpecLine(shape) {
  const n = (v) => round1(v);
  if (shape.type === "triangle") {
    const a = shape.angles();
    const s = shape.sides().map((px) => px / PX_PER_UNIT);
    return `triangle a=${n(a[0])} b=${n(a[1])} ab=${n(s[0])} fill=${shape.fillId}`;
  }
  if (shape.type === "quadrilateral") {
    const kind = shape.mode === "rectangle" ? "rect" : "para";
    const angle = shape.mode === "parallelogram" ? ` angle=${n(shape.slantDeg)}` : "";
    return `${kind} w=${n(shape.baseUnits())} h=${n(shape.sideUnits())}${angle}${flags({
      height: shape.showHeight,
      labels: shape.showLabels,
      "arrows=off": !shape.dimensionStyle,
    })} fill=${shape.fillId}`;
  }
  if (shape.type === "polygon") {
    return `polygon n=${shape.sides} side=${n(shape.sideUnits())}${flags({
      mark: shape.showInteriorAngle,
      labels: shape.showLabels,
      "ticks=off": !shape.showTicks,
    })} fill=${shape.fillId}`;
  }
  if (shape.type === "circle") {
    const kind = shape.mode === "circle" ? "circle" : shape.mode;
    const sweep = shape.mode === "circle" ? "" : ` angle=${n(shape.sweepDeg)}`;
    return `${kind} r=${n(shape.radiusUnits())}${sweep} fill=${shape.fillId}`;
  }
  if (shape.type === "prism") {
    const kindWord = { rectangle: "rect", triangle: "tri", parallelogram: "para", polygon: "poly", custom: "custom" }[shape.baseKind];
    if (shape.baseKind === "custom") return `# (custom-outline prism -- rebuild from its 2D shape, then "Turn into prism")`;
    const size =
      shape.baseKind === "polygon"
        ? `n=${shape.sides} side=${n(shape.baseSideUnits())}`
        : `w=${n(shape.widthUnits())} h=${n(shape.heightUnits())}`;
    const slant = shape.baseKind === "parallelogram" ? ` angle=${n(shape.slantDeg)}` : "";
    const hidden = shape.showHiddenEdges ? " hidden" : "";
    return `prism base=${kindWord} ${size}${slant} depth=${n(shape.depthUnits())}${hidden} fill=${shape.fillId}`;
  }
  if (shape.type === "parallel-lines") {
    return `parallel angle=${n(shape.transversals[0].relAngleDeg)} lines=${shape.lineCount} transversals=${shape.transversals.length}`;
  }
  if (shape.type === "line-graph") {
    // Only a single open or closed chain round-trips as a path; anything branchier is
    // still perfectly usable in the app, it just can't be written as one line.
    const chain = shape.asChain?.();
    if (!chain) return `# (freeform line diagram -- no single-path spec for this one)`;
    const pts = chain.points
      .map((p) => `${n((p.x - ORIGIN.x) / PX_PER_UNIT)},${n((ORIGIN.y - p.y) / PX_PER_UNIT)}`)
      .join(" ");
    return `path ${pts}${chain.closed ? " close" : ""}`;
  }
  return `# (${shape.type} has no spec form yet)`;
}

export function diagramToSpec(shapes) {
  return shapes.map(shapeToSpecLine).join("\n");
}
