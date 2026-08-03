import { Triangle } from "./shapes/triangle.js";
import { ParallelLines } from "./shapes/parallelLines.js";
import { LineGraph } from "./shapes/lineGraph.js";
import { renderSidebar } from "./sidebar.js";
import { exportSvg, exportPng } from "./export.js";

const svg = document.getElementById("canvas");
const layer = document.getElementById("shapes-layer");
const sidebarContent = document.getElementById("sidebar-content");
const gridBg = document.getElementById("grid-bg");

const addTriangleBtn = document.getElementById("add-triangle");
const addParallelBtn = document.getElementById("add-parallel");
const addLineBtn = document.getElementById("add-line");
const duplicateBtn = document.getElementById("duplicate-scaled");
const deleteBtn = document.getElementById("delete-shape");
const exportSvgBtn = document.getElementById("export-svg");
const exportPngBtn = document.getElementById("export-png");
const gridToggle = document.getElementById("toggle-grid");

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
};

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
