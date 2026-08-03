import { Triangle } from "./shapes/triangle.js";
import { ParallelLines } from "./shapes/parallelLines.js";
import { renderSidebar } from "./sidebar.js";
import { exportSvg, exportPng } from "./export.js";

const svg = document.getElementById("canvas");
const layer = document.getElementById("shapes-layer");
const sidebarContent = document.getElementById("sidebar-content");
const gridBg = document.getElementById("grid-bg");

const addTriangleBtn = document.getElementById("add-triangle");
const addParallelBtn = document.getElementById("add-parallel");
const duplicateBtn = document.getElementById("duplicate-scaled");
const deleteBtn = document.getElementById("delete-shape");
const exportSvgBtn = document.getElementById("export-svg");
const exportPngBtn = document.getElementById("export-png");
const gridToggle = document.getElementById("toggle-grid");

let shapes = [];
let selectedShape = null;
let spawnOffset = 0;

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
  const o = ((spawnOffset - 1) % 4) * 30;
  const t = new Triangle({
    points: [
      { x: 150 + o, y: 480 + o },
      { x: 370 + o, y: 480 + o },
      { x: 230 + o, y: 260 + o },
    ],
  });
  addShape(t);
});

addParallelBtn.addEventListener("click", () => {
  spawnOffset += 1;
  const o = ((spawnOffset - 1) % 4) * 25;
  const p = new ParallelLines({ center: { x: 760 + o, y: 350 + o } });
  addShape(p);
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
  input.type = "number";
  input.step = "0.1";
  input.value = currentValue;
  input.className = "label-edit-input";
  input.style.left = `${evt.clientX}px`;
  input.style.top = `${evt.clientY}px`;

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const val = Number(input.value);
    if (!Number.isNaN(val)) shape.setField(fieldKey, val);
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

// seed the canvas with one example so a first-time user sees something immediately
addTriangleBtn.click();
addParallelBtn.click();
deselectAll();
