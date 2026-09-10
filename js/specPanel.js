import { parseSpec, buildDiagram, diagramToSpec, describeGrammar, describeFields } from "./spec.js";
import { exportSheet } from "./export.js";
import { AI_CARD } from "./aiCard.js";

const NS = "http://www.w3.org/2000/svg";
const SHEET_PADDING = 24;

// Nothing in a spec-rendered diagram is interactive, so the shapes get a controller
// that satisfies the interface and does nothing -- except report the diagram's overall
// size, which is what keeps every shape's notation scaled to the same drawing.
function staticController(shapes) {
  return {
    onSelect() {},
    onChange() {},
    onInlineEdit() {},
    snapNudge() {
      return null;
    },
    diagramExtent() {
      let biggest = 0;
      for (const shape of shapes) {
        if (typeof shape.ownExtentPx === "function") biggest = Math.max(biggest, shape.ownExtentPx());
      }
      return biggest;
    },
  };
}

let offscreenHost = null;

function host() {
  if (!offscreenHost) {
    offscreenHost = document.createElement("div");
    offscreenHost.style.cssText = "position:fixed;left:-99999px;top:0;width:1200px;height:900px;";
    document.body.appendChild(offscreenHost);
  }
  return offscreenHost;
}

// Renders one diagram's spec into its own standalone SVG, cropped to its content.
// It has to be in the document (offscreen) because getBBox() needs a live layout.
export function renderDiagramToSvg(items) {
  const svgEl = document.createElementNS(NS, "svg");
  svgEl.setAttribute("xmlns", NS);
  svgEl.setAttribute("viewBox", "0 0 1000 700");
  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", "shapes-layer");
  svgEl.appendChild(layer);
  host().appendChild(svgEl);

  const { shapes, warnings } = buildDiagram(items);
  const controller = staticController(shapes);
  for (const shape of shapes) shape.mount(layer, controller);

  let box = null;
  try {
    box = layer.getBBox();
  } catch {
    box = null;
  }
  if (box && box.width > 0 && box.height > 0) {
    svgEl.setAttribute(
      "viewBox",
      `${box.x - SHEET_PADDING} ${box.y - SHEET_PADDING} ${box.width + SHEET_PADDING * 2} ${
        box.height + SHEET_PADDING * 2
      }`
    );
  }
  return { svgEl, shapes, warnings };
}

export function disposeRenderedSvgs(entries) {
  for (const e of entries) e.svgEl.remove();
}

// --- the Spec dialog ------------------------------------------------------

let overlayEl = null;

export function closeSpecPanel() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

export function openSpecPanel({ currentShapes, onLoadDiagram, initialText }) {
  closeSpecPanel();
  const overlay = document.createElement("div");
  overlay.className = "export-modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSpecPanel();
  });

  const panel = document.createElement("div");
  panel.className = "export-modal spec-modal";

  const title = document.createElement("h3");
  title.textContent = "Diagram spec";
  panel.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "export-hint";
  hint.textContent =
    'One shape per line, "---" between diagrams. Type ? for the full grammar, or ?fields for everything the selected shape can be asked for. "For AI" below is the page to hand a chat.';
  panel.appendChild(hint);

  const textarea = document.createElement("textarea");
  textarea.className = "spec-input";
  textarea.spellcheck = false;
  textarea.rows = 10;
  textarea.placeholder = "triangle a=80 b=80 ab=6 fill=cream\n---\nprism base=poly n=6 side=3 depth=10 hidden";
  textarea.value = initialText || (currentShapes.length ? diagramToSpec(currentShapes) : "");
  panel.appendChild(textarea);

  const messages = document.createElement("p");
  messages.className = "spec-messages";
  panel.appendChild(messages);

  const actions = document.createElement("div");
  actions.className = "export-actions";
  const statusEl = document.createElement("span");
  statusEl.className = "export-status";
  const flash = (msg) => {
    statusEl.textContent = msg;
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  };

  const drawBtn = document.createElement("button");
  drawBtn.className = "primary";
  drawBtn.textContent = "Draw";
  drawBtn.addEventListener("click", () => {
    // "?" answers with the whole vocabulary and "?fields" with everything the selected
    // shape can be asked for -- so a writer who doesn't have the reference to hand can
    // get it from the tool and paste it back, instead of guessing or reading the code.
    const asked = textarea.value.trim().toLowerCase();
    if (asked === "?" || asked === "help") {
      textarea.value = describeGrammar();
      messages.textContent = "Grammar above -- Copy spec puts it on the clipboard.";
      return;
    }
    if (asked === "?fields" || asked === "fields") {
      const target = currentShapes[currentShapes.length - 1];
      textarea.value = target
        ? describeFields(target)
        : "# nothing on the canvas -- draw a shape first, then ask for ?fields";
      messages.textContent = target ? "Fields above -- any of them works as `set key=value`." : "";
      return;
    }

    const diagrams = parseSpec(textarea.value);
    if (!diagrams.length) {
      messages.textContent = "Nothing to draw yet.";
      return;
    }
    if (diagrams.length === 1) {
      const warnings = onLoadDiagram(diagrams[0]);
      messages.textContent = warnings.join("  ·  ");
      if (!warnings.length) closeSpecPanel();
      return;
    }
    // More than one diagram: render them all and go straight to the export sheet.
    const entries = diagrams.map((d, i) => ({ ...renderDiagramToSvg(d), name: `diagram-${i + 1}` }));
    const allWarnings = entries.flatMap((e) => e.warnings);
    messages.textContent = allWarnings.join("  ·  ");
    closeSpecPanel();
    exportSheet(entries, {
      onOpen: (index) => {
        disposeRenderedSvgs(entries);
        onLoadDiagram(diagrams[index]);
      },
    });
  });
  actions.appendChild(drawBtn);

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy spec";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      flash("Copied.");
    } catch {
      flash("Copy failed -- select the text instead.");
    }
  });
  actions.appendChild(copyBtn);

  const linkBtn = document.createElement("button");
  linkBtn.textContent = "Copy link";
  linkBtn.title = "A link that opens this spec already drawn";
  linkBtn.addEventListener("click", async () => {
    const base = location.href.split("#")[0];
    try {
      await navigator.clipboard.writeText(`${base}#spec=${encodeURIComponent(textarea.value)}`);
      flash("Link copied.");
    } catch {
      flash("Copy failed.");
    }
  });
  actions.appendChild(linkBtn);

  const aiBtn = document.createElement("button");
  aiBtn.textContent = "For AI";
  aiBtn.title = "The page to paste into a Claude Project so chats can write specs";
  aiBtn.addEventListener("click", () => openAiCard());
  actions.appendChild(aiBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeSpecPanel);
  actions.appendChild(closeBtn);
  actions.appendChild(statusEl);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  overlayEl = overlay;
  textarea.focus();
}

function openAiCard() {
  closeSpecPanel();
  const overlay = document.createElement("div");
  overlay.className = "export-modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSpecPanel();
  });

  const panel = document.createElement("div");
  panel.className = "export-modal spec-modal";

  const title = document.createElement("h3");
  title.textContent = "Instructions for AI";
  panel.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "export-hint";
  hint.textContent =
    "Paste this into a Claude Project's custom instructions (or upload it as a Skill). Chats then write one-line specs instead of rebuilding the tool -- far faster and far cheaper.";
  panel.appendChild(hint);

  const pre = document.createElement("textarea");
  pre.className = "spec-input ai-card";
  pre.readOnly = true;
  pre.rows = 18;
  pre.value = AI_CARD;
  panel.appendChild(pre);

  const actions = document.createElement("div");
  actions.className = "export-actions";
  const statusEl = document.createElement("span");
  statusEl.className = "export-status";
  const copyBtn = document.createElement("button");
  copyBtn.className = "primary";
  copyBtn.textContent = "Copy instructions";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(AI_CARD);
      statusEl.textContent = "Copied.";
    } catch {
      pre.select();
      statusEl.textContent = "Selected -- press Ctrl/Cmd+C.";
    }
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  });
  actions.appendChild(copyBtn);
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeSpecPanel);
  actions.appendChild(closeBtn);
  actions.appendChild(statusEl);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  overlayEl = overlay;
}
