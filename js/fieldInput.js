// Shared parsing for every editable angle/length field across all shapes.
// A field is "numeric" (a plain number -> drives real geometry), a custom label
// string (e.g. "x" for an unknown -- geometry is left untouched), or "" (hidden --
// shows a small + to restore). Only a fully-numeric typed value ever changes
// the actual geometry; anything else is display-only.
export function parseFieldInput(raw) {
  const str = String(raw).trim();
  if (str === "") return { hidden: true };
  const isNumeric = /^-?\d*\.?\d+$/.test(str);
  return isNumeric ? { numeric: Number(str) } : { label: str };
}
