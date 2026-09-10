import { makeZip } from "./zip.js";

const EXPORT_SCALE = 2; // render at 2x for crisp pasting into a Word doc / slide

// The live page's shape styling lives in style.css, which is NOT included when an
// SVG subtree is serialized standalone -- without this, browsers fall back to SVG's
// default fill (solid black) for every polygon/path, which visibly breaks the export.
// This mirrors the relevant rules from style.css so exported files render identically.
const EXPORT_STYLE = `
text { font-family: Georgia, "Times New Roman", "Nimbus Roman", serif; }
.shape-poly { stroke: #1a1a1a; stroke-width: 1.6; stroke-linejoin: round; }
.shape-line { stroke: #1a1a1a; stroke-width: 1.6; fill: none; stroke-linecap: round; }
.construction-line { stroke: #1a1a1a; stroke-width: 1.3; stroke-dasharray: 5 4; fill: none; }
.hidden-edge { stroke: #1a1a1a; stroke-width: 1.2; stroke-dasharray: 6 5; fill: none; opacity: 0.75; }
.dimension-shaft { stroke: #1a1a1a; stroke-width: 1.3; }
.dimension-head { fill: #1a1a1a; stroke: none; }
.vertex-label, .side-label, .angle-label { paint-order: stroke; stroke: #ffffff; stroke-width: calc(4px * var(--label-scale, 1)); stroke-linejoin: round; }
.vertex-label { font-size: calc(16px * var(--label-scale, 1)); font-style: italic; fill: #1a1a1a; }
.side-label, .angle-label { font-size: calc(15px * var(--label-scale, 1)); fill: #1a1a1a; }
.angle-arc { fill: none; stroke: #1a1a1a; stroke-width: 1.3; }
.right-angle-mark { fill: none; stroke: #1a1a1a; stroke-width: 1.3; }
.parallel-chevron { stroke: #1a1a1a; stroke-width: 1.5; fill: none; }
.equal-length-tick { stroke: #1a1a1a; stroke-width: 1.5; }
`;

const CROP_PADDING = 24;
const INTERACTIVE_ONLY_SELECTOR =
  ".vertex-handle, .drag-handle, .rotate-handle, .rotate-handle-line, .label-remove, .label-plus, .segment-delete-group, .new-vertex-handle";

// Measure the actual drawn content (not the fixed 1000x700 workspace) so the export
// isn't full of blank canvas. Must run on an SVG still attached to the document --
// getBBox() on a fully detached node throws/returns garbage in most browsers -- so
// this temporarily mounts an offscreen copy purely to read geometry, then discards it.
function measureContentBBox(svgEl) {
  const probe = svgEl.cloneNode(true);
  probe.style.position = "fixed";
  probe.style.left = "-99999px";
  probe.style.top = "0";
  document.body.appendChild(probe);
  const layer = probe.querySelector("#shapes-layer, .shapes-layer");
  let box = null;
  if (layer && layer.childNodes.length) {
    const b = layer.getBBox();
    if (b.width > 0 && b.height > 0) box = b;
  }
  document.body.removeChild(probe);
  return box;
}

function prepareCleanSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.querySelectorAll(INTERACTIVE_ONLY_SELECTOR).forEach((n) => n.remove());
  clone.querySelectorAll(".selected").forEach((n) => n.classList.remove("selected"));
  const gridBg = clone.querySelector("#grid-bg");
  if (gridBg) gridBg.remove();

  const box = measureContentBBox(clone);
  const [origX, origY, origW, origH] = clone.getAttribute("viewBox").split(" ").map(Number);
  const vbX = box ? box.x - CROP_PADDING : origX;
  const vbY = box ? box.y - CROP_PADDING : origY;
  const vbW = box ? box.width + CROP_PADDING * 2 : origW;
  const vbH = box ? box.height + CROP_PADDING * 2 : origH;

  clone.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  clone.setAttribute("width", vbW);
  clone.setAttribute("height", vbH);

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = EXPORT_STYLE;
  clone.insertBefore(style, clone.firstChild);

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", vbX);
  bg.setAttribute("y", vbY);
  bg.setAttribute("width", vbW);
  bg.setAttribute("height", vbH);
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

function serialize(svgEl) {
  return new XMLSerializer().serializeToString(svgEl);
}

// Artifact viewers block any download a page triggers on itself (a.download
// links, script-driven saves are inert) -- so instead of auto-downloading, this
// shows the rendered image in a modal. "Copy Image" uses the Clipboard API
// (works in most hosts and pastes directly into Docs/Word/Slides); right-click
// or long-press "Save Image As" on the preview is the guaranteed fallback
// everywhere, including inside a sandboxed artifact.
let currentExportOverlay = null;

function closeExportModal() {
  if (currentExportOverlay) {
    currentExportOverlay.remove();
    currentExportOverlay = null;
  }
}

function showExportModal({ kind, imgSrc, blob, svgText }) {
  closeExportModal();
  const overlay = document.createElement("div");
  overlay.className = "export-modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeExportModal();
  });

  const panel = document.createElement("div");
  panel.className = "export-modal";

  const title = document.createElement("h3");
  title.textContent = kind === "png" ? "Export as PNG" : "Export as SVG";
  panel.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "export-hint";
  hint.textContent =
    kind === "png"
      ? 'Right-click (or long-press) the image and choose "Copy Image" or "Save Image As", or use the button below.'
      : 'Right-click (or long-press) the image and choose "Save Image As" to get an .svg file, or copy the raw markup below to paste into vector tools.';
  panel.appendChild(hint);

  const imgWrap = document.createElement("div");
  imgWrap.className = "export-img-wrap";
  const img = document.createElement("img");
  img.src = imgSrc;
  img.alt = "Diagram export preview";
  imgWrap.appendChild(img);
  panel.appendChild(imgWrap);

  const actions = document.createElement("div");
  actions.className = "export-actions";
  const statusEl = document.createElement("span");
  statusEl.className = "export-status";

  const flashStatus = (msg) => {
    statusEl.textContent = msg;
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  };

  if (kind === "png") {
    const copyImgBtn = document.createElement("button");
    copyImgBtn.textContent = "Copy Image";
    copyImgBtn.className = "primary";
    copyImgBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        flashStatus("Copied! Paste into your document.");
      } catch {
        flashStatus("Copy not available here -- right-click the image instead.");
      }
    });
    actions.appendChild(copyImgBtn);
  } else {
    const copyCodeBtn = document.createElement("button");
    copyCodeBtn.textContent = "Copy SVG Code";
    copyCodeBtn.className = "primary";
    copyCodeBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(svgText);
        flashStatus("Copied!");
      } catch {
        flashStatus("Copy failed -- select the code manually.");
      }
    });
    actions.appendChild(copyCodeBtn);
  }

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save file";
  saveBtn.hidden = true;
  saveBtn.addEventListener("click", () => saveFile(blob, `diagram.${kind}`, flashStatus));
  actions.appendChild(saveBtn);
  canDownload().then((ok) => {
    saveBtn.hidden = !ok;
  });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeExportModal);
  actions.appendChild(closeBtn);
  actions.appendChild(statusEl);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  currentExportOverlay = overlay;
}

function buildPngBlob(svgEl) {
  return new Promise((resolve) => {
    const clean = prepareCleanSvg(svgEl);
    const [, , vbWidth, vbHeight] = clean.getAttribute("viewBox").split(" ").map(Number);
    const str = serialize(clean);
    const svgBlob = new Blob([str], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = vbWidth * EXPORT_SCALE;
      canvas.height = vbHeight * EXPORT_SCALE;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob), "image/png");
    };
    img.src = url;
  });
}

export function exportSvg(svgEl) {
  const clean = prepareCleanSvg(svgEl);
  const str = serialize(clean);
  const blob = new Blob([str], { type: "image/svg+xml" });
  const dataUrl = URL.createObjectURL(blob);
  showExportModal({ kind: "svg", imgSrc: dataUrl, blob, svgText: str });
}

export async function exportPng(svgEl) {
  const blob = await buildPngBlob(svgEl);
  const dataUrl = URL.createObjectURL(blob);
  showExportModal({ kind: "png", imgSrc: dataUrl, blob, svgText: null });
}

// --- saving files ---------------------------------------------------------
//
// Two different hosts, two different rules. Served as an ordinary page (GitHub Pages,
// or a local server) a link with `download` just works. Inside a Claude artifact the
// viewer's sandbox makes that inert, and the way to hand over a file is the platform's
// `downloads` capability, which shows the viewer a confirmation. Resolution is started
// at load because it can take a moment to answer, and returns null wherever the
// capability isn't granted -- in which case the save affordance is hidden entirely and
// copy-to-clipboard is the route.
const downloadsReady = (async () => {
  try {
    return window.claude?.use ? await window.claude.use("downloads") : null;
  } catch {
    return null;
  }
})();

function isTopLevel() {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export async function canDownload() {
  return isTopLevel() || Boolean(await downloadsReady);
}

async function saveFile(blob, filename, flash = () => {}) {
  const downloads = await downloadsReady;
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      flash(`Saved ${filename}.`);
    } catch (err) {
      const code = err && err.code;
      if (code === "declined") return; // the viewer said no; nothing to report
      flash(
        code === "rate_limited"
          ? "One save at a time -- try that again in a moment."
          : `Couldn't save ${filename} here -- use Copy instead.`
      );
    }
    return;
  }
  if (isTopLevel()) {
    downloadBlob(blob, filename);
    return;
  }
  flash("Saving isn't available here -- use Copy instead.");
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportSheet(entries, { onOpen } = {}) {
  closeExportModal();
  const overlay = document.createElement("div");
  overlay.className = "export-modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeExportModal();
  });

  const panel = document.createElement("div");
  panel.className = "export-modal export-sheet";

  const title = document.createElement("h3");
  title.textContent = `${entries.length} diagram${entries.length === 1 ? "" : "s"}`;
  panel.appendChild(title);

  const savingAvailable = await canDownload();

  const hint = document.createElement("p");
  hint.className = "export-hint";
  hint.textContent = savingAvailable
    ? 'Copy any diagram straight into your document, save one on its own, or "Save all" for a zip of every PNG.'
    : 'Copy any diagram straight into your document, or right-click (long-press) it and choose "Save Image As".';
  panel.appendChild(hint);

  const statusEl = document.createElement("span");
  statusEl.className = "export-status";
  const flashStatus = (msg) => {
    statusEl.textContent = msg;
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  };

  const grid = document.createElement("div");
  grid.className = "export-grid";
  panel.appendChild(grid);

  const built = [];
  for (let i = 0; i < entries.length; i++) {
    const { svgEl, name } = entries[i];
    const blob = await buildPngBlob(svgEl);
    const url = URL.createObjectURL(blob);
    built.push({ blob, url, name: name || `diagram-${i + 1}` });

    const card = document.createElement("figure");
    card.className = "export-card";
    const img = document.createElement("img");
    img.src = url;
    img.alt = `Diagram ${i + 1}`;
    card.appendChild(img);

    const caption = document.createElement("figcaption");
    caption.textContent = `${i + 1}`;
    card.appendChild(caption);

    const row = document.createElement("div");
    row.className = "export-card-actions";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        flashStatus(`Diagram ${i + 1} copied.`);
      } catch {
        flashStatus("Copy not available here -- right-click the image instead.");
      }
    });
    row.appendChild(copyBtn);

    if (savingAvailable) {
      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", () => saveFile(blob, `${built[i].name}.png`, flashStatus));
      row.appendChild(saveBtn);
    }
    if (onOpen) {
      const openBtn = document.createElement("button");
      openBtn.textContent = "Edit";
      openBtn.title = "Load this one into the canvas to adjust it";
      openBtn.addEventListener("click", () => {
        closeExportModal();
        onOpen(i);
      });
      row.appendChild(openBtn);
    }
    card.appendChild(row);
    grid.appendChild(card);
  }

  const actions = document.createElement("div");
  actions.className = "export-actions";
  if (savingAvailable && built.length > 1) {
    // One zip rather than one save per diagram: a dozen separate saves means a dozen
    // confirmations in the artifact viewer, and a dozen files loose in Downloads.
    const allBtn = document.createElement("button");
    allBtn.textContent = "Save all";
    allBtn.className = "primary";
    allBtn.addEventListener("click", async () => {
      allBtn.disabled = true;
      try {
        const files = [];
        for (const item of built) files.push({ name: `${item.name}.png`, data: await blobBytes(item.blob) });
        await saveFile(makeZip(files), "diagrams.zip", flashStatus);
      } finally {
        allBtn.disabled = false;
      }
    });
    actions.appendChild(allBtn);
  }
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeExportModal);
  actions.appendChild(closeBtn);
  actions.appendChild(statusEl);
  panel.appendChild(actions);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  currentExportOverlay = overlay;
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
