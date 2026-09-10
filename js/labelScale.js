import { clamp } from "./geometry.js";
import { withUnit } from "./units.js";

// Label text is drawn in the same user-space as the geometry, so a diagram of a 16 cm
// wall and a diagram of a 3 cm tile come out with wildly different text-to-shape
// ratios: the same 15px label reads as a caption on one and as a shout on the other.
// Exporting can't fix it -- scaling the viewBox scales the text with the shape -- so
// the label size has to be chosen from how big the figure actually is.
//
// TARGET_EXTENT is the figure size at which the base sizes look right; everything else
// is scaled towards it, within limits that keep tiny figures readable and huge ones
// from turning into billboards.
const TARGET_EXTENT = 320;

export function labelScale(extentPx) {
  if (!extentPx || !Number.isFinite(extentPx)) return 1;
  return clamp(extentPx / TARGET_EXTENT, 0.9, 2.6);
}

// Sets the scale the label CSS reads. Every label size, halo width and tick length is
// expressed as a multiple of this, so one number keeps a diagram internally consistent.
export function applyLabelScale(group, extentPx) {
  if (group) group.style.setProperty("--label-scale", labelScale(extentPx).toFixed(2));
}

// How far a label should sit off the line it belongs to, for a figure this size.
export function gap(extentPx, base = 16) {
  return base * labelScale(extentPx);
}

// How far a label's centre has to sit from a line so the label's box clears it.
//
// A fixed offset only works for horizontal edges: "4.3 m" pushed 18px off a diagonal
// still has half its width lying across the line, which is what makes numbers look
// like they've been dropped on top of the drawing. This measures out to the edge of
// the label's own box in the direction it's being pushed, so a long label beside a
// steep line moves further than a short one beside a flat one.
export function labelOffset(value, extentPx, nx, ny, pad = 7) {
  const scale = labelScale(extentPx);
  const size = 15 * scale;
  // Measure the text that will actually be drawn, unit and all: "8.3" and "8.3 mm"
  // need very different clearances, and using the bare number leaves the unit lying
  // across the line.
  const shown = String(withUnit(value));
  const halfW = (shown.length * size * 0.52) / 2;
  const halfH = size * 0.62;
  // Distance from the label's centre to the edge of its box in the direction it's
  // pushed: for a rectangle that's halfW*|nx| + halfH*|ny|. Anything less and the box
  // still overlaps the line, which is exactly how a number ends up with an edge
  // running through it.
  return halfW * Math.abs(nx) + halfH * Math.abs(ny) + pad * scale;
}

// Last pass over a finished diagram: nudge apart any two labels whose boxes overlap.
//
// Each label is placed sensibly relative to the line it belongs to, but two of them
// can still land on top of each other -- a slant-side measurement and an external
// height, say, both wanting the same bit of space to the right of the shape. Rather
// than special-casing every such pair, overlaps are resolved after the fact: push the
// later label directly away from the earlier one, just far enough to clear, and never
// so far that it stops reading as belonging to its own line.
export function spreadLabels(group, extentPx) {
  const labels = [...group.querySelectorAll(".removable-label")];
  if (labels.length < 2) return;
  const limit = 26 * labelScale(extentPx);

  let boxes;
  try {
    boxes = labels.map((l) => l.getBBox());
  } catch {
    return; // not laid out yet (detached); nothing to resolve
  }

  const shift = labels.map(() => ({ x: 0, y: 0 }));
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = shifted(boxes[i], shift[i]);
        const b = shifted(boxes[j], shift[j]);
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;

        // Separate along whichever axis needs the least movement.
        const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
        const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        if (overlapY <= overlapX) {
          const dir = bc.y >= ac.y ? 1 : -1;
          shift[j].y += dir * (overlapY + 3);
        } else {
          const dir = bc.x >= ac.x ? 1 : -1;
          shift[j].x += dir * (overlapX + 3);
        }
        shift[j].x = clamp(shift[j].x, -limit, limit);
        shift[j].y = clamp(shift[j].y, -limit, limit);
        moved = true;
      }
    }
    if (!moved) break;
  }

  labels.forEach((label, i) => {
    if (shift[i].x || shift[i].y) label.setAttribute("transform", `translate(${shift[i].x} ${shift[i].y})`);
  });
}

function shifted(box, by) {
  return { x: box.x + by.x, y: box.y + by.y, width: box.width, height: box.height };
}

export function extentOf(points) {
  if (!points || !points.length) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}
