---
name: geometry-diagrams
description: Write specs for the Geometry Diagram Creator to produce exact maths diagrams (triangles, polygons, circles, sectors, prisms, parallel lines, composite outlines) for worksheets and tests. Use whenever a maths diagram is asked for, instead of drawing one or building a diagram tool.
---

# Geometry diagram specs

A diagram tool for maths worksheets (triangles, polygons, circles, prisms, parallel
lines, composite outlines). You write ONE LINE per diagram; the tool solves the real
geometry and the teacher exports PNG/SVG straight into Word.

**Never rebuild this tool as an artifact and never fetch or read its HTML.** Writing a
spec line is all that is needed, and costs a fraction as much.

## Handing a diagram over

- If the teacher has the tool open: give them the spec lines to paste into "Spec...".
- Otherwise give them a link with the spec URL-encoded after `#spec=`:
  `https://elliotttheeducator.github.io/Maths-Geometry-Diagram-Creator/#spec=triangle%20a%3D80%20b%3D80%20ab%3D6`
  Opening it draws the diagram straight away. (Links only work on that hosted address;
  inside a Claude artifact preview, paste into the Spec box instead.)

## Grammar

One shape per line. `---` alone on a line starts a new diagram. `#` starts a comment.
Lengths are in units, angles in degrees. Bare words are flags; `key=value` sets a value.

| Shape | Keys |
|---|---|
| `triangle` | `a= b= c=` angles at vertices 1/2/3, `ab= bc= ca=` sides, `labels` or `labels=P,Q,R` vertex letters, `ext=A` exterior angle, `ticks=off`, `seg` or `seg=0.6` internal parallel segment |
| `rect` | `w= h=`, `labels`, `ticks` equal-side marks, `arrows=off`, `rot=` |
| `para` | `w= h= angle=`, `height` (draw perpendicular height) or `height=4` (set it), `rot=` |
| `polygon` | `n= side=` or `r=`, `mark` (interior angle), `labels`, `ticks=off`, `rot=` |
| `pentagon` `hexagon` `octagon` | same as polygon with `n` preset |
| `circle` | `r=`, `d` (label as diameter), `radius` (draw the radius line) |
| `sector` | `r= angle=`, `arc=` (set arc length), `radius` |
| `arc` | `r= angle=` |
| `prism` | `base=rect\|tri\|para\|poly`, `w= h= depth=`, `angle=` (para base), `n= side=` (poly base), `hidden` (hidden edges), `height` (perp height, tri base), `da=` (viewing angle) |
| `parallel` | `angle=` transversal angle, `dir=`, `gap=`, `lines=3`, `transversals=2`, `show=` which crossing angles to label, `x=` which to mark unknown |
| `path` | `x,y x,y x,y ...` then `close`, for composite/L-shaped outlines. y points UP. Corner angles and parallel/equal marks start hidden; add `angles` or `marks` to show them. |

Every shape also takes `fill=` one of `cream green blue rose violet amber slate none`.

## What gets labelled — the rule that matters

**Only what you write is labelled.** Everything else is drawn correctly and left
silent. A diagram that labels every side and angle hands over the answer, and only the
person writing the question knows which number is the given and which is the answer, so
that decision is yours on every line.

```
triangle a=90 b=35 ab=8       # three labels: two angles and one side
triangle a=90 ab=8            # two labels; the other angles are still exactly right
triangle a=90 b=35 ab=8 ca=x  # "find x" -- a letter labels a side without resizing it
```

So: write the givens, write the unknown as a letter, and write nothing else. If a
measurement is wanted later, the teacher clicks the small plus where it would sit.

Two things the tool marks on its own, because they are geometry rather than pedagogy:
a right angle keeps its square, and sides that are genuinely equal get matching ticks
(`ticks=off` to suppress) — which is how to show "these two are equal" without
labelling either of them.

## Things worth knowing

- Two angles plus one side fully determines a triangle, and typed values lock, so
  `triangle a=80 b=80 ab=6` really is isosceles -- the third angle follows and stays 20.
- Anything unspecified keeps a sensible default; unknown keys are reported, not fatal.
- Every quoted number is measured off the actual drawing, so a diagram is never
  labelled with something its geometry doesn't support.
- On a `parallel` diagram only the given angle is labelled. Address the others as
  `L<line><slot>` (`T<transversal>L<line><slot>` with two transversals), where the
  slots run anticlockwise from below-right: `a` below-right, `b` below-left,
  `c` above-left, `d` above-right. So `parallel angle=115 x=L2c` gives one known
  angle and one to find; `show=all` labels every one.

## Examples

```
triangle a=90 b=35 ab=8              # right-angled, 35 deg at B
triangle a=80 b=80 ab=6 fill=blue    # isosceles: equal sides get ticks, unlabelled
triangle a=90 ab=6 bc=8 ca=x         # Pythagoras: two givens and the unknown
rect w=12 h=7 fill=cream             # area / perimeter
para w=9 h=5 angle=60 height         # parallelogram with perpendicular height
polygon n=8 side=4 mark labels       # regular octagon, interior angle marked
circle r=6.5 d                       # circle labelled by its diameter
sector r=5 angle=120 arc=            # sector showing its arc length
prism base=rect w=8 h=4 depth=12 hidden
prism base=poly n=6 side=3 depth=10 hidden
parallel angle=115 x=L2c             # co-interior angles: one given, one to find
path 0,0 10,0 10,4 6,4 6,7 0,7 close fill=cream   # L-shaped composite
```

## A whole worksheet at once

Separate diagrams with `---`. The tool renders them as a grid, with Copy and Save per
diagram and "Save all" for a zip of every PNG at once:

```
rect w=10 h=6 fill=cream
---
triangle a=90 b=30 ab=7 fill=blue
---
prism base=tri w=6 h=4 depth=9 hidden
```
