import { Triangle } from "./shapes/triangle.js";
import { ParallelLines } from "./shapes/parallelLines.js";
import { LineGraph } from "./shapes/lineGraph.js";
import { Circle } from "./shapes/circle.js";
import { Quadrilateral } from "./shapes/quadrilateral.js";
import { Prism } from "./shapes/prism.js";
import { RegularPolygon } from "./shapes/polygon.js";
import { renderSidebar } from "./sidebar.js";
import { exportSvg, exportPng, exportSheet } from "./export.js";
import { parseSpec, buildDiagram } from "./spec.js";
import { openSpecPanel, renderDiagramToSvg, disposeRenderedSvgs } from "./specPanel.js";

const svg = document.getElementById("canvas");
const layer = document.getElementById("shapes-layer");
const sidebarContent = document.getElementById("sidebar-content");
const gridBg = document.getElementById("grid-bg");

const addTriangleBtn = document.getElementById("add-triangle");
const addParallelBtn = document.getElementById("add-parallel");
const addLineBtn = document.getElementById("add-line");
const addQuadBtn = document.getElementById("add-quad");
const addCircleBtn = document.getElementById("add-circle");
const addPrismBtn = document.getElementById("add-prism");
const addPolygonBtn = document.getElementById("add-polygon");
const toPrismBtn = document.getElementById("to-prism");
const duplicateBtn = document.getElementById("duplicate-scaled");
const deleteBtn = document.getElementById("delete-shape");
const exportSvgBtn = document.getElementById("export-svg");
const exportPngBtn = document.getElementById("export-png");
const gridToggle = document.getElementById("toggle-grid");
const snapToggle = document.getElementById("toggle-snap");
const specBtn = document.getElementById("open-spec");

let shapes = [];
let selectedShape = null;
let spawnOffset = 0;

// --- keep the canvas framed around whatever's actually drawn -------------
//
// The SVG viewBox starts at a fixed 1000x700, but shapes can be dragged, rotated,
// or scaled well outside that box -- without this, they'd simply clip off the
// edge. Instead the viewBox is continuously refit to the union of every shape's
// rendered content (via a MutationObserver, so it reacts to renders regardless
// of which shape or which kind of edit caused them).
//
// Refitting is skipped while a pointer is actively held down inside the SVG and
// runs once immediately on release. Both readings inside a single drag always
// go through toSvgPoint's live CTM, so per-frame math stays correct either way --
// this pause is purely to avoid a live-zoom feedback loop (dragging a shape
// outward grows the box, which changes the zoom, which changes where the same
// mouse pixel maps to in user-space, which could nudge the shape again).
const FIT_PADDING = 40;
const FIT_MIN_W = 500;
const FIT_MIN_H = 400;
const DEFAULT_VIEWBOX = [0, 0, 1000, 700];
let isPointerDown = false;
let fitScheduled = false;

function scheduleFit() {
  if (isPointerDown || fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => {
    fitScheduled = false;
    fitViewToContent();
  });
}

function fitViewToContent() {
  let box = null;
  if (layer.childNodes.length) {
    try {
      box = layer.getBBox();
    } catch {
      box = null;
    }
  }

  let [vbX, vbY, vbW, vbH] = DEFAULT_VIEWBOX;
  if (box && box.width > 0 && box.height > 0) {
    vbX = box.x - FIT_PADDING;
    vbY = box.y - FIT_PADDING;
    vbW = box.width + FIT_PADDING * 2;
    vbH = box.height + FIT_PADDING * 2;
    if (vbW < FIT_MIN_W) {
      vbX -= (FIT_MIN_W - vbW) / 2;
      vbW = FIT_MIN_W;
    }
    if (vbH < FIT_MIN_H) {
      vbY -= (FIT_MIN_H - vbH) / 2;
      vbH = FIT_MIN_H;
    }
  }

  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  gridBg.setAttribute("x", vbX);
  gridBg.setAttribute("y", vbY);
  gridBg.setAttribute("width", vbW);
  gridBg.setAttribute("height", vbH);
}

new MutationObserver(scheduleFit).observe(layer, { childList: true, subtree: true, attributes: true });
svg.addEventListener("pointerdown", () => { isPointerDown = true; }, { capture: true });
window.addEventListener("pointerup", () => {
  isPointerDown = false;
  scheduleFit();
});

const controller = {
  onSelect(shape) {
    selectShape(shape);
  },
  onChange() {
    updateToolbarState();
    const draggingRange = document.activeElement && document.activeElement.type === "range";
    if (!draggingRange) refreshSidebar();
  },
  onInlineEdit(shape, fieldKey, currentValue, evt) {
    openInlineEditor(shape, fieldKey, currentValue, evt);
  },
  snapNudge(shape) {
    return snapNudge(shape);
  },
};

// --- snapping, so shapes can be butted together into a composite ----------
//
// While a shape is being dragged it offers a list of snap points (corners, edge
// midpoints, a circle's centre and cardinal points). If any of them comes within
// SNAP_RADIUS of a snap point on another shape, the drag is nudged so the two
// coincide exactly -- which is what makes a composite shape hold together when it's
// later resized or exported, rather than being aligned by eye to within a pixel.
const SNAP_RADIUS = 12;

function snapNudge(shape) {
  if (snapToggle && !snapToggle.checked) return null;
  if (typeof shape.snapPoints !== "function") return null;
  const mine = shape.snapPoints();
  let best = null;
  for (const other of shapes) {
    if (other === shape || typeof other.snapPoints !== "function") continue;
    for (const t of other.snapPoints()) {
      for (const m of mine) {
        const dx = t.x - m.x;
        const dy = t.y - m.y;
        const d = Math.hypot(dx, dy);
        if (d < SNAP_RADIUS && (!best || d < best.d)) best = { d, dx, dy };
      }
    }
  }
  return best && best.d > 0.001 ? { dx: best.dx, dy: best.dy } : null;
}

function selectShape(shape) {
  if (selectedShape && selectedShape !== shape) selectedShape.setSelected(false);
  selectedShape = shape;
  if (selectedShape) selectedShape.setSelected(true);
  updateToolbarState();
  refreshSidebar();
}

function refreshSidebar() {
  renderSidebar(sidebarContent, selectedShape);
}

function updateToolbarState() {
  const hasSelection = !!selectedShape;
  deleteBtn.disabled = !hasSelection;
  duplicateBtn.disabled = !(hasSelection && selectedShape.type === "triangle");
  toPrismBtn.disabled = !(hasSelection && typeof selectedShape.outline === "function");
}

function addShape(shape) {
  shapes.push(shape);
  shape.mount(layer, controller);
  selectShape(shape);
}

function deselectAll() {
  if (selectedShape) selectedShape.setSelected(false);
  selectedShape = null;
  updateToolbarState();
  refreshSidebar();
}

svg.addEventListener("pointerdown", (e) => {
  if (e.target === svg || e.target === gridBg) deselectAll();
});

addTriangleBtn.addEventListener("click", () => {
  spawnOffset += 1;
  const o = ((spawnOffset - 1) % 4) * 30 - 45;
  const t = new Triangle({
    points: [
      { x: 360 + o, y: 430 + o },
      { x: 640 + o, y: 430 + o },
      { x: 500 + o, y: 190 + o },
    ],
  });
  addShape(t);
});

addParallelBtn.addEventListener("click", () => {
  spawnOffset += 1;
  const o = ((spawnOffset - 1) % 4) * 25 - 37;
  const p = new ParallelLines({ center: { x: 500 + o, y: 350 + o } });
  addShape(p);
});

addQuadBtn.addEventListener("click", () => {
  spawnOffset += 1;
  const o = ((spawnOffset - 1) % 4) * 28 - 40;
  addShape(new Quadrilateral({ origin: { x: 380 + o, y: 430 + o } }));
});

addCircleBtn.addEventListener("click", () => {
  spawnOffset += 1;
  const o = ((spawnOffset - 1) % 4) * 28 - 40;
  addShape(new Circle({ center: { x: 500 + o, y: 350 + o } }));
});

addPrismBtn.addEventListener("click", () => {
  spawnOffset += 1;
  const o = ((spawnOffset - 1) % 4) * 28 - 40;
  addShape(new Prism({ origin: { x: 380 + o, y: 450 + o } }));
});

addPolygonBtn.addEventListener("click", () => {
  spawnOffset += 1;
  const o = ((spawnOffset - 1) % 4) * 28 - 40;
  addShape(new RegularPolygon({ center: { x: 500 + o, y: 350 + o } }));
});

// Extrude the selected 2D shape's outline into a prism, keeping its colour -- so a
// parallelogram prism is just "draw the parallelogram, then turn it into a prism".
toPrismBtn.addEventListener("click", () => {
  if (!selectedShape || typeof selectedShape.outline !== "function") return;
  const prism = Prism.fromOutline(selectedShape.outline());
  if (selectedShape.fillId) prism.fillId = selectedShape.fillId;
  selectedShape.destroy();
  shapes = shapes.filter((s) => s !== selectedShape);
  selectedShape = null;
  addShape(prism);
});

// "+Line" adds a segment to the currently-selected line graph (so repeated
// clicks build up one connected diagram); if nothing suitable is selected, it
// starts a new one. Deselect first (click empty canvas) to start a separate graph.
addLineBtn.addEventListener("click", () => {
  if (selectedShape && selectedShape.type === "line-graph") {
    selectedShape.addSegment();
    return;
  }
  const g = new LineGraph();
  addShape(g);
  g.addSegment();
});

duplicateBtn.addEventListener("click", () => {
  if (!selectedShape || selectedShape.type !== "triangle") return;
  const clone = selectedShape.cloneScaled(1, { x: 120, y: 0 });
  addShape(clone);
});

deleteBtn.addEventListener("click", () => {
  if (!selectedShape) return;
  selectedShape.destroy();
  shapes = shapes.filter((s) => s !== selectedShape);
  deselectAll();
});

gridToggle.addEventListener("change", () => {
  gridBg.style.display = gridToggle.checked ? "" : "none";
});

exportSvgBtn.addEventListener("click", () => exportSvg(svg));
exportPngBtn.addEventListener("click", () => exportPng(svg));

// --- written specs --------------------------------------------------------
//
// The whole diagram can be written down as a few words per shape and rebuilt from
// them, which is what lets an AI assistant produce worksheets for this tool without
// reading (or regenerating) the application itself.

function clearCanvas() {
  for (const shape of shapes) shape.destroy();
  shapes = [];
  deselectAll();
}

// Loads one diagram into the live canvas, replacing what's there, and returns any
// warnings so the caller can show what it couldn't make sense of.
function loadDiagram(items) {
  const { shapes: built, warnings } = buildDiagram(items);
  if (!built.length) return warnings.length ? warnings : ["Nothing recognisable in that spec."];
  clearCanvas();
  for (const shape of built) {
    shapes.push(shape);
    shape.mount(layer, controller);
  }
  selectShape(built[built.length - 1]);
  return warnings;
}

specBtn.addEventListener("click", () =>
  openSpecPanel({ currentShapes: shapes, onLoadDiagram: loadDiagram })
);

// `#spec=...` draws a spec on load, so a chat can hand over a link that opens the
// finished diagram rather than instructions for building it.
function loadSpecFromHash() {
  const match = /[#&]spec=([^&]*)/.exec(location.hash);
  if (!match) return;
  let text;
  try {
    text = decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return;
  }
  const diagrams = parseSpec(text);
  if (!diagrams.length) return;
  if (diagrams.length === 1) {
    loadDiagram(diagrams[0]);
    return;
  }
  const entries = diagrams.map((d, i) => ({ ...renderDiagramToSvg(d), name: `diagram-${i + 1}` }));
  exportSheet(entries, {
    onOpen: (index) => {
      disposeRenderedSvgs(entries);
      loadDiagram(diagrams[index]);
    },
  });
}

window.addEventListener("hashchange", loadSpecFromHash);

document.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && selectedShape) {
    const active = document.activeElement;
    const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    if (!typing) {
      e.preventDefault();
      deleteBtn.click();
    }
  }
});

// --- inline edit popup for double-clicking labels directly on the canvas ---

let inlineEditorEl = null;

function closeInlineEditor() {
  if (inlineEditorEl && inlineEditorEl.isConnected) {
    inlineEditorEl.remove();
  }
  inlineEditorEl = null;
}

function openInlineEditor(shape, fieldKey, currentValue, evt) {
  closeInlineEditor();
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentValue;
  input.className = "label-edit-input";
  input.style.left = `${evt.clientX}px`;
  input.style.top = `${evt.clientY}px`;
  input.placeholder = "value, label, or blank to hide";

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    shape.setField(fieldKey, input.value);
    closeInlineEditor();
    refreshSidebar();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      committed = true;
      closeInlineEditor();
    }
  });
  input.addEventListener("blur", commit);

  document.body.appendChild(input);
  inlineEditorEl = input;
  input.focus();
  input.select();
}

refreshSidebar();
loadSpecFromHash();
