import { PALETTE } from "./palette.js";

const KIND_META = {
  angle: { unit: "°", min: 1, max: 178, step: 0.5 },
  length: { unit: "u", min: 0.2, max: 40, step: 0.1 },
  scale: { unit: "×", min: 0.2, max: 3, step: 0.05, suffix: "×" },
  ratio: { unit: "", min: 0.05, max: 0.95, step: 0.02, suffix: "" },
};


export function renderSidebar(container, shape) {
  container.innerHTML = "";
  if (!shape) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent =
      "Select a shape to edit its exact angles and side lengths, or drag its points directly on the canvas.";
    container.appendChild(p);
    return;
  }

  const fields = shape.getFields();
  const groups = new Map();
  for (const f of fields) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }

  for (const [groupName, groupFields] of groups) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    const h3 = document.createElement("h3");
    h3.textContent = groupName;
    wrap.appendChild(h3);

    for (const f of groupFields) {
      wrap.appendChild(renderField(shape, f));
    }
    container.appendChild(wrap);
  }
}

function renderField(shape, field) {
  const row = document.createElement("div");
  row.className = "field-row";

  const label = document.createElement("label");
  label.textContent = field.label;
  row.appendChild(label);

  if (field.locked) {
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "lock-btn";
    lockBtn.textContent = "🔒";
    lockBtn.title = "Locked -- click to unlock (later edits elsewhere won't protect this value anymore)";
    lockBtn.addEventListener("click", () => shape.unlockField(field.key));
    row.appendChild(lockBtn);
  }

  if (field.kind === "info") {
    const out = document.createElement("span");
    out.className = "derived-value";
    out.textContent = field.value;
    row.appendChild(out);
    return row;
  }

  if (field.kind === "toggle") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(field.value);
    input.style.flex = "0";
    input.addEventListener("change", () => {
      shape.setField(field.key, input.checked);
    });
    row.appendChild(input);
    return row;
  }

  if (field.kind === "color") {
    const input = document.createElement("input");
    input.type = "color";
    input.value = field.value;
    input.className = "color-input";
    input.addEventListener("input", () => shape.setField(field.key, input.value));
    row.appendChild(input);
    return row;
  }

  if (field.kind === "swatch") {
    const wrap = document.createElement("div");
    wrap.className = "swatch-row";
    for (const entry of PALETTE) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch-btn" + (field.value === entry.id ? " selected" : "");
      btn.style.background = entry.fill === "none" ? "transparent" : entry.fill;
      btn.title = entry.label;
      btn.addEventListener("click", () => shape.setField(field.key, entry.id));
      wrap.appendChild(btn);
    }
    row.appendChild(wrap);
    return row;
  }

  if (field.kind === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = field.value;
    input.maxLength = 4;
    input.addEventListener("change", () => {
      shape.setField(field.key, input.value);
    });
    row.appendChild(input);
    return row;
  }

  const meta = KIND_META[field.kind] || { unit: "", min: 0, max: 100, step: 1 };

  // Derived values (area, volume, circumference) -- shown, never typed into, since
  // they follow from the dimensions above them.
  if (field.readOnly) {
    const out = document.createElement("span");
    out.className = "derived-value";
    out.textContent = `${field.value}${meta.unit === "u" ? "" : meta.unit}`;
    row.appendChild(out);
    return row;
  }

  if (field.kind === "scale" || field.kind === "ratio") {
    const range = document.createElement("input");
    range.type = "range";
    range.min = meta.min;
    range.max = meta.max;
    range.step = meta.step;
    range.value = field.value;
    const readout = document.createElement("span");
    readout.className = "scale-readout";
    readout.textContent = `${field.value}${meta.suffix}`;
    range.addEventListener("input", () => {
      readout.textContent = `${range.value}${meta.suffix}`;
      shape.setField(field.key, range.value);
    });
    row.appendChild(range);
    row.appendChild(readout);
    return row;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.value = field.value;
  input.placeholder = "blank to hide";
  input.title = "Type a number to set it exactly, text (e.g. x) to label it as an unknown, or leave blank to hide it.";
  input.addEventListener("change", () => {
    shape.setField(field.key, input.value);
  });
  row.appendChild(input);

  const unit = document.createElement("span");
  unit.className = "unit";
  unit.textContent = meta.unit;
  row.appendChild(unit);

  return row;
}
