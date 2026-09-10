// The single source of truth for the instructions given to an AI assistant. The build
// script writes this out as AI-INSTRUCTIONS.md (to paste into a Claude Project) and as
// a SKILL.md (to upload as a Claude Skill), and the app shows it behind the "For AI"
// button so it can be copied without leaving the page.
//
// Keep it short on purpose: the whole point is that a chat loads ~700 tokens of this
// instead of ~55,000 tokens of application HTML.

export const AI_CARD = `# Geometry diagram specs

A diagram tool for maths worksheets (triangles, polygons, circles, prisms, parallel
lines, composite outlines). You write ONE LINE per diagram; the tool solves the real
geometry and the teacher exports PNG/SVG straight into Word.

**Never rebuild this tool as an artifact and never fetch or read its HTML.** Writing a
spec line is all that is needed, and costs a fraction as much.

## Handing a diagram over

- If the teacher has the tool open: give them the spec lines to paste into "Spec...".
- Otherwise give them a link with the spec URL-encoded after \`#spec=\`:
  \`https://elliotttheeducator.github.io/Maths-Geometry-Diagram-Creator/#spec=triangle%20a%3D80%20b%3D80%20ab%3D6\`
  Opening it draws the diagram straight away. (Links only work on that hosted address;
  inside a Claude artifact preview, paste into the Spec box instead.)

## Say it the way the question is phrased

The tool carries the geometry; you only state what the question gives. These all work
as written, and each is a complete diagram:

\`\`\`
units cm
triangle right legs=6,8 hyp=x        # Pythagoras
triangle sides=3,4,5                 # three sides -- solved exactly
triangle isosceles base=6 legs=5
triangle equilateral side=5
triangle base=9 height=4             # area: base and perpendicular height
para w=16 h=5.5 angle=65 height=5    # height drawn inside, right-angle box at the foot
parallel angle=115 x=L2c             # co-interior angles
\`\`\`

A unit written on a measurement (\`w=12cm\`) sets the unit for the whole spec, so
\`units cm\` is only needed when no measurement carries one.

If a word is close to a real one it's read as that one and the tool says so, so a
half-remembered key still draws. If it isn't close to anything, the message lists
every key that shape takes.

## Grammar

One shape per line. \`---\` alone on a line starts a new diagram. \`#\` starts a comment.
Lengths are in units, angles in degrees. Bare words are flags; \`key=value\` sets a value.

| Shape | Keys |
|---|---|
| \`triangle\` | \`a= b= c=\` angles at vertices 1/2/3, \`ab= bc= ca=\` sides, \`height\`/\`height=4\`/\`hfrom=B\` perpendicular height, \`labels\` or \`labels=P,Q,R\` vertex letters, \`ext=A\` exterior angle, \`ticks=off\`, \`seg\` or \`seg=0.6\` internal parallel segment |
| \`rect\` | \`w= h=\`, \`labels\`, \`ticks\` equal-side marks, \`arrows=off\`, \`rot=\` |
| \`para\` | \`w= h= angle=\`, \`height\` (draw perpendicular height) or \`height=4\` (set it), \`outside\` (draw it off the extended base), \`rot=\` |
| \`polygon\` | \`n= side=\` or \`r=\`, \`mark\` (interior angle), \`labels\`, \`ticks=off\`, \`rot=\` |
| \`pentagon\` \`hexagon\` \`octagon\` | same as polygon with \`n\` preset |
| \`circle\` | \`r=\`, \`d\` (label as diameter), \`radius\` (draw the radius line) |
| \`sector\` | \`r= angle=\`, \`arc=\` (set arc length), \`radius\` |
| \`arc\` | \`r= angle=\` |
| \`prism\` | \`base=rect\\|tri\\|para\\|poly\`, \`w= h= depth=\`, \`angle=\` (para base), \`n= side=\` (poly base), \`hidden\` (hidden edges), \`height\` (perp height, tri base), \`da=\` (viewing angle) |
| \`parallel\` | \`angle=\` transversal angle, \`dir=\`, \`gap=\`, \`lines=3\`, \`transversals=2\`, \`show=\` which crossing angles to label, \`x=\` which to mark unknown |
| \`path\` | \`x,y x,y x,y ...\` then \`close\`, for composite/L-shaped outlines. y points UP. Corner angles and parallel/equal marks start hidden; add \`angles\` or \`marks\` to show them. |

Every shape also takes \`fill=\` one of \`cream green blue rose violet amber slate none\`.

## When the vocabulary above isn't enough

Two lines cover everything else, so an unusual diagram never needs new syntax and you
never need to read the tool's source:

- \`units cm\` — the unit every length is quoted in (mm, cm, m, km, in, ft).
- \`set <key>=<value>\` — changes **any** field of the shape on the line above, using the
  same field names the app's own sidebar uses. For example \`set ext-toggle-1=on\` extends
  a triangle's side to show an exterior angle.

To find those field names, ask the teacher to type \`?fields\` in the Spec box with the
shape on screen: the tool lists every field that shape has, generated from the shape
itself. \`?\` on its own prints this whole grammar. Either can be pasted back to you --
that is the intended way to discover what exists, rather than reading any code.

## What gets labelled — the rule that matters

**Only what you write is labelled.** Everything else is drawn correctly and left
silent. A diagram that labels every side and angle hands over the answer, and only the
person writing the question knows which number is the given and which is the answer, so
that decision is yours on every line.

\`\`\`
triangle a=90 b=35 ab=8       # three labels: two angles and one side
triangle a=90 ab=8            # two labels; the other angles are still exactly right
triangle a=90 b=35 ab=8 ca=x  # "find x" -- a letter labels a side without resizing it
\`\`\`

So: write the givens, write the unknown as a letter, and write nothing else. If a
measurement is wanted later, the teacher clicks the small plus where it would sit.

Two things the tool marks on its own, because they are geometry rather than pedagogy:
a right angle keeps its square, and sides that are genuinely equal get matching ticks
(\`ticks=off\` to suppress) — which is how to show "these two are equal" without
labelling either of them.

## Heights

\`height\` on a triangle or parallelogram draws the perpendicular height the textbook
way: a dashed line with a right-angle box where it meets the base. \`height=4\` also sets
it. When the foot of the perpendicular falls off the end of the base -- every obtuse
triangle, and \`outside\` on a parallelogram -- the base is extended with a dashed line
to meet it, which is exactly how it's drawn in a book. \`hfrom=B\` picks which vertex of
a triangle the height drops from.

Every construction line is dashed, because none of them is an edge of the shape: heights,
base extensions, radii and diameters all read as drawn-to-explain rather than drawn-as-part-of.

## Things worth knowing

- Two angles plus one side fully determines a triangle, and typed values lock, so
  \`triangle a=80 b=80 ab=6\` really is isosceles -- the third angle follows and stays 20.
- Anything unspecified keeps a sensible default; unknown keys are reported, not fatal.
- Every quoted number is measured off the actual drawing, so a diagram is never
  labelled with something its geometry doesn't support.
- On a \`parallel\` diagram only the given angle is labelled. Address the others as
  \`L<line><slot>\` (\`T<transversal>L<line><slot>\` with two transversals), where the
  slots run anticlockwise from below-right: \`a\` below-right, \`b\` below-left,
  \`c\` above-left, \`d\` above-right. So \`parallel angle=115 x=L2c\` gives one known
  angle and one to find; \`show=all\` labels every one.

## Examples

\`\`\`
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
\`\`\`

## A whole worksheet at once

Separate diagrams with \`---\`. The tool renders them as a grid, with Copy and Save per
diagram and "Save all" for a zip of every PNG at once:

\`\`\`
rect w=10 h=6 fill=cream
---
triangle a=90 b=30 ab=7 fill=blue
---
prism base=tri w=6 h=4 depth=9 hidden
\`\`\`
`;
