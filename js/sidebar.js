const KIND_META = {
  angle: { unit: "°", min: 1, max: 178, step: 0.5 },
  length: { unit: "u", min: 0.2, max: 40, step: 0.1 },
  scale: { unit: "×", min: 0.2, max: 3, step: 0.05 },
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

  if (field.kind === "scale") {
    const range = document.createElement("input");
    range.type = "range";
    range.min = meta.min;
    range.max = meta.max;
    range.step = meta.step;
    range.value = field.value;
    const readout = document.createElement("span");
    readout.className = "scale-readout";
    readout.textContent = `${field.value}×`;
    range.addEventListener("input", () => {
      readout.textContent = `${range.value}×`;
      shape.setField(field.key, range.value);
    });
    row.appendChild(range);
    row.appendChild(readout);
    return row;
  }

  const input = document.createElement("input");
  input.type = "number";
  input.min = meta.min;
  input.max = meta.max;
  input.step = meta.step;
  input.value = field.value;
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
