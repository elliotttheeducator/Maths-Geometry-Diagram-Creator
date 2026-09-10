import { Triangle } from "./shapes/triangle.js";
import { ParallelLines } from "./shapes/parallelLines.js";
import { LineGraph } from "./shapes/lineGraph.js";
import { Circle } from "./shapes/circle.js";
import { Quadrilateral } from "./shapes/quadrilateral.js";
import { Prism } from "./shapes/prism.js";
import { RegularPolygon } from "./shapes/polygon.js";
import { PX_PER_UNIT, round1 } from "./geometry.js";
import { setLengthUnit, lengthUnit, UNIT_CHOICES } from "./units.js";
import { PALETTE } from "./palette.js";

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
  const globals = []; // directives (units) apply to every diagram, wherever they appear
  lastInlineUnit = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (/^-{3,}$/.test(line)) {
      diagrams.push([]);
      continue;
    }
    const item = parseLine(line);
    if (item.type === "units") globals.push(item);
    else diagrams[diagrams.length - 1].push(item);
  }
  // Writing "12cm" anywhere states the unit for the whole spec, unless a `units` line
  // already did. Saying nothing leaves whatever the page is set to, so a spec never
  // silently strips the unit a teacher chose from the toolbar.
  if (!globals.length && lastInlineUnit) {
    globals.push({ type: "units", args: [["unit", lastInlineUnit]], points: [], raw: "" });
  }
  return diagrams.filter((d) => d.length > 0).map((d) => [...globals, ...d]);
}

function parseLine(line) {
  const tokens = line.split(/\s+/);
  const type = tokens.shift().toLowerCase();
  const args = [];
  const points = [];
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq > 0) {
      args.push([tok.slice(0, eq).toLowerCase(), stripUnitSuffix(tok.slice(eq + 1))]);
    } else if (/^-?[\d.]+,-?[\d.]+$/.test(tok)) {
      const [x, y] = tok.split(",").map(Number);
      points.push({ x, y });
    } else {
      args.push([tok.toLowerCase(), true]); // bare word = flag
    }
  }
  // `units cm` reads more naturally than `units=cm`, so accept the bare form.
  if (type === "units" && args.length && args[0][1] === true) return { type, args: [["unit", args[0][0]]], points, raw: line };
  return { type, args, points, raw: line };
}

// "12cm" both means 12 and says what unit the diagram is in -- writing the unit next
// to a measurement is what somebody transcribing a question naturally does, so it's
// taken as the answer to both questions rather than treated as an error.
function stripUnitSuffix(value) {
  const m = /^(-?\d*\.?\d+)\s*(mm|cm|m|km|in|ft)$/i.exec(String(value));
  if (!m) return value;
  lastInlineUnit = m[2].toLowerCase();
  return m[1];
}

let lastInlineUnit = null;

function isTruthyWord(value) {
  return !["off", "no", "false", "0", ""].includes(String(value).toLowerCase());
}

// Builds one diagram's shapes. Unknown keys are collected rather than thrown, so a
// nearly-right spec still draws something and says what it ignored.
export function buildDiagram(items) {
  const shapes = [];
  const warnings = [];
  for (const item of items) {
    try {
      if (item.type === "units") {
        const unit = item.args.find(([k]) => k === "unit");
        setLengthUnit(unit ? String(unit[1]) : "");
        if (unit && lengthUnit() !== String(unit[1])) {
          warnings.push(`Unknown unit "${unit[1]}" -- use ${UNIT_CHOICES.filter(Boolean).join(", ")}`);
        }
        continue;
      }
      // `set` is the way past this vocabulary: it addresses any field the sidebar has,
      // on the shape written above it, so an unusual diagram never needs new syntax.
      if (item.type === "set") {
        const target = shapes[shapes.length - 1];
        if (!target) {
          warnings.push("set has no shape above it to apply to");
          continue;
        }
        for (const [key, value] of item.args) {
          const field = target.getFields().find((f) => f.key === key);
          if (!field) {
            warnings.push(`"${key}" isn't a field of this ${target.type} -- ask for ?fields to list them`);
            continue;
          }
          // On a switch, "off"/"no"/"false"/"0" has to mean off: Boolean("off") is true,
          // which would turn on exactly what was being turned off.
          if (field.kind === "toggle") target.setField(key, value === true ? true : isTruthyWord(value));
          else target.setField(key, value);
        }
        continue;
      }
      const shape = buildShape(item, warnings);
      if (shape) shapes.push(shape);
      else warnings.push(`Unknown shape "${item.type}" -- ${SHAPE_LIST}`);
    } catch (err) {
      warnings.push(`${item.raw} -- ${err.message}`);
    }
  }
  return { shapes, warnings };
}

// What a shape can be asked for right now, straight from the shape itself -- so a
// writer wanting something unusual can see the real field keys instead of reading the
// source, and the list can never drift from what the sidebar actually offers.
export function describeFields(shape) {
  const groups = new Map();
  for (const field of shape.getFields()) {
    if (field.kind === "info") continue;
    if (!groups.has(field.group)) groups.set(field.group, []);
    const kind = field.readOnly ? "read-only" : field.kind;
    groups.get(field.group).push(`${field.key} (${kind})`);
  }
  const lines = [`# fields of this ${shape.type} -- use them as: set <key>=<value>`];
  for (const [group, keys] of groups) lines.push(`${group}: ${keys.join(", ")}`);
  return lines.join("\n");
}

// The whole vocabulary, generated from the registry rather than written out twice.
export function describeGrammar() {
  const lines = [
    "# Diagram spec -- one shape per line, --- between diagrams, # for comments",
    "# Only what you write is labelled; everything else is drawn but left silent.",
    "",
    "units cm            set the unit every length is quoted in",
    "set <key>=<value>   change any field of the shape on the line above",
    "",
  ];
  for (const [name, entry] of Object.entries(SHAPE_KEYS)) {
    lines.push(`${name} (${entry.words.join(", ")})`);
    lines.push(`    ${entry.about}`);
    lines.push(`    keys: ${entry.keys.split(" ").join(", ")}`);
  }
  lines.push("", "fill: " + PALETTE.map((p) => p.id).join(", "));
  return lines.join("\n");
}

const SHAPE_LIST = "try triangle, rect, para, polygon, circle, sector, prism, parallel or path";

// Which words each shape understands. This is the single registry behind three things:
// suggesting a correction for a near-miss, generating the built-in "?" help, and
// telling a writer what exists -- so nobody has to read the source to find out.
export const SHAPE_KEYS = {
  triangle: {
    words: ["triangle", "tri"],
    keys: "a b c ab bc ca right isosceles equilateral legs hyp base side sides labels ext ticks seg fill",
    about: "angles a/b/c at each vertex, sides ab/bc/ca; or say right, isosceles, equilateral with legs=/hyp=/base=/side=",
  },
  rect: {
    words: ["rect", "rectangle", "square"],
    keys: "w h width height base side rot rotation ticks labels arrows fill",
    about: "w= and h=",
  },
  para: {
    words: ["para", "parallelogram"],
    keys: "w h width height base side angle rot rotation ticks labels arrows fill",
    about: "w= h= angle=, plus height to draw the perpendicular height",
  },
  polygon: {
    words: ["polygon", "pentagon", "hexagon", "octagon"],
    keys: "n sides side r radius rot rotation labels mark angle ticks fill",
    about: "n= sides and side= length (pentagon/hexagon/octagon preset n)",
  },
  circle: {
    words: ["circle", "sector", "arc"],
    keys: "r radius d diameter angle arc fill",
    about: "r=, plus angle= for a sector or arc",
  },
  prism: {
    words: ["prism"],
    keys: "base w h width height depth d angle n sides side r radius da view hidden fill",
    about: "base=rect|tri|para|poly with w= h= depth=",
  },
  parallel: {
    words: ["parallel", "lines"],
    keys: "angle angle2 dir direction gap lines transversals trans show x unknown",
    about: "angle= for the transversal; show=/x= address crossings as L1a..L2d",
  },
  path: {
    words: ["path", "shape"],
    keys: "close closed fill angles marks",
    about: "x,y points (y upwards) then close",
  },
};

const WORD_TO_SHAPE = new Map();
for (const [shape, entry] of Object.entries(SHAPE_KEYS)) {
  for (const word of entry.words) WORD_TO_SHAPE.set(word, shape);
}

// Levenshtein distance, used only to turn a near-miss into a suggestion.
function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const row = [i];
    for (let j = 1; j < cols; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[cols - 1];
}

function nearest(word, candidates) {
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const d = editDistance(word, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  // One edit for short words, two for longer ones: close enough to be a typo rather
  // than a different word entirely.
  const limit = word.length <= 4 ? 1 : 2;
  return bestDist <= limit ? best : null;
}

// The tool corrects what it can recognise and says so, instead of ignoring the line
// and leaving the writer to guess which word was wrong.
function correctArgs(shapeName, args, warn) {
  const known = SHAPE_KEYS[shapeName].keys.split(" ");
  return args.map(([key, value]) => {
    if (known.includes(key)) return [key, value];
    const guess = nearest(key, known);
    if (guess) {
      warn(`Read "${key}" as "${guess}" on ${shapeName}`);
      return [guess, value];
    }
    return [key, value];
  });
}

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
  const { points } = item;
  const warn = (message) => warnings.push(message);

  // A misspelled shape word is corrected the same way a misspelled key is.
  let type = item.type;
  let shapeName = WORD_TO_SHAPE.get(type);
  if (!shapeName) {
    const guess = nearest(type, [...WORD_TO_SHAPE.keys()]);
    if (!guess) return null;
    warn(`Read "${type}" as "${guess}"`);
    type = guess;
    shapeName = WORD_TO_SHAPE.get(guess);
  }

  const args = correctArgs(shapeName, item.args, warn);
  const note = (key) => {
    const known = SHAPE_KEYS[shapeName].keys.split(" ").join(", ");
    warnings.push(`${shapeName} doesn't have "${key}" -- it takes: ${known}`);
  };
  const mentioned = new Set();
  const mark = (...keys) => keys.forEach((k) => mentioned.add(k));

  let shape = null;
  if (type === "triangle" || type === "tri") shape = buildTriangle(args, note, mark, warn);
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
    } else if (key === "right") {
      // The words a question is actually phrased in. A right angle sits at A, so its
      // legs are the two sides meeting there and the hypotenuse is the one opposite.
      t.setField("angle-0", 90);
      mark("angle-0");
    } else if (key === "legs") {
      // Two values are the two sides meeting at the right angle; one value is the
      // isosceles reading, where both sides off the base are that long.
      const list = splitList(value);
      if (list.length >= 2) {
        t.setField("side-0", list[0]);
        t.setField("side-2", list[1]);
        mark("side-0", "side-2");
      } else if (list.length === 1) {
        t.setField("side-1", list[0]);
        t.setField("side-2", list[0]);
        mark("side-1", "side-2");
      }
    } else if (key === "hyp") {
      t.setField("side-1", value);
      mark("side-1");
    } else if (key === "base") {
      t.setField("side-0", value);
      mark("side-0");
    } else if (key === "equilateral") {
      for (const i of [0, 1, 2]) t.setField(`angle-${i}`, 60);
      mark("angle-0");
    } else if (key === "isosceles") {
      // On its own it says nothing measurable; it pairs with base= and side=/legs=.
      continue;
    } else if (key === "side" || key === "sides") {
      // `sides=3,4,5` gives all three at once; a single value makes it equilateral.
      const list = splitList(value);
      if (list.length >= 3) {
        list.slice(0, 3).forEach((len, i) => {
          t.setField(`side-${i}`, len);
          mark(`side-${i}`);
        });
      } else if (list.length === 2) {
        // base plus the two equal sides, the usual way an isosceles is quoted
        t.setField("side-0", list[0]);
        t.setField("side-1", list[1]);
        t.setField("side-2", list[1]);
        mark("side-0", "side-1", "side-2");
      } else if (list.length === 1) {
        [0, 1, 2].forEach((i) => {
          t.setField(`side-${i}`, list[0]);
          mark(`side-${i}`);
        });
      }
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
