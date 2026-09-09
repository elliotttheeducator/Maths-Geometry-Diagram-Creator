// Fill palette modelled on Haese / Cambridge textbook diagrams: soft pastel faces
// with a thin near-black outline. Each entry carries three tints of the same hue so
// a 3D solid can shade its front / top / side faces without looking flat.
export const SHAPE_STROKE = "#1a1a1a";

export const PALETTE = [
  { id: "cream", label: "Cream", fill: "#f4eddd", top: "#e6dcc3", side: "#d8cca9" },
  { id: "green", label: "Green", fill: "#d9ebcd", top: "#bcd8a9", side: "#9cc184" },
  { id: "blue", label: "Blue", fill: "#cbe2f3", top: "#a8cde8", side: "#82b4d9" },
  { id: "rose", label: "Rose", fill: "#f7d6d6", top: "#eeb9b9", side: "#e09a9a" },
  { id: "violet", label: "Violet", fill: "#e2dbf2", top: "#cbc0e6", side: "#b3a4d8" },
  { id: "amber", label: "Amber", fill: "#fbeec5", top: "#f2dfa4", side: "#e6cd82" },
  { id: "slate", label: "Slate", fill: "#e5e8ec", top: "#d2d7dd", side: "#bcc3cb" },
  { id: "none", label: "None", fill: "none", top: "none", side: "none" },
];

const BY_ID = new Map(PALETTE.map((p) => [p.id, p]));

export function paletteEntry(id) {
  return BY_ID.get(id) || BY_ID.get("cream");
}

// Fill for a face of a 3D solid. Front faces read lightest, tops mid, sides darkest --
// the cue that makes a flat projection read as a solid.
export function faceFill(paletteId, face) {
  const entry = paletteEntry(paletteId);
  if (face === "top") return entry.top;
  if (face === "side") return entry.side;
  return entry.fill;
}
