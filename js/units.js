// The unit every length on a diagram is quoted in. A worksheet says "12 cm", not
// "12", and re-typing the unit onto each label by hand is exactly the drudgery this
// tool exists to remove -- so it's one setting for the whole diagram.
//
// It's deliberately display-only: the geometry is unitless, so switching cm to m
// relabels the drawing without redrawing it, and nothing downstream has to convert.
let current = "";

export const UNIT_CHOICES = ["", "mm", "cm", "m", "km", "in", "ft"];

export function setLengthUnit(unit) {
  current = UNIT_CHOICES.includes(unit) ? unit : "";
}

export function lengthUnit() {
  return current;
}

// A measured length as it should appear on the drawing. Anything that isn't a plain
// number is a label the user chose (an unknown like "x", or their own text) and is
// left exactly as typed.
export function withUnit(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return current ? `${value} ${current}` : `${value}`;
}
