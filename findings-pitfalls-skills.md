# findings, pitfalls, skills

## physics

- PBD position projection re-injects its corrections as separation
  velocity (perfectly elastic micro-contacts). a pile under sustained
  load (mixed densities: buoyancy compresses the springs) shimmers
  forever — positions static, velocities ~10 px/s. more iterations or
  stiffer projection do not help. fix: damp normal relative velocity of
  touching pairs after velocity derivation (inelastic contacts). granular
  piles then settle to exact rest.
- never feed a local wave height back into a floating body's buoyancy.
  the meniscus under a bobbing bead resonates at the bead's own natural
  frequency (1-D surface columns are stiff and short-period) and pumps
  the oscillation without limit. archimedes acts on the undisturbed
  level: use the flat tank level for buoyancy, keep the wave field
  visual, and let the bead pay the reaction impulse for the ripples it
  kicks (radiation damping).
- exact submerged fraction of a disc is cheap (one asin per bead per
  substep) — no reason to use smoothstep approximations:
  `f = 0.5 + (q·sqrt(1−q²) + asin q)/π`, q = depth/r.

## canvas

- create gradients once per resize, draw beads from pre-rendered sprite
  canvases (drawImage with per-bead alpha). gradients + hsla strings per
  bead per frame are the typical hot-path allocation killers in these
  prototypes.
- static tank outlines and rim ticks belong in cached `Path2D` objects made
  on resize; only the wave surface path changes each frame.

## tooling

- classic `<script>` files share one global lexical scope in the
  browser (top-level `const` from engine.js is visible in render.js),
  but node `require()` isolates each file. to smoke-test a page bundle
  under node, concatenate the sources into one compile unit.
- the sim engine stays DOM-free and guarded by `module.exports`, so
  experiments/ can require it directly — bench and sanity checks run in
  milliseconds without a browser.

## simulation state

- persistent pair constraints need an explicit death path. a hash that only
  deduplicates new bonds accumulates every warm or separated pair forever;
  the solver then still scans dead links and may pull distant beads together.
  rebuild the cold-bond set from the broadphase each substep, carry rest
  distances in a double-buffered key table, and partition effective links to
  the front for solver/render.
- cache what broadphase already computed: grid cell indices and summed pair
  radii. contact relaxation otherwise repeats divisions and radius loads in
  every particle iteration.
- a pointer `active` flag set on first hover is not the same as `down`. use
  pointer-down state for forces; otherwise an idle cursor keeps stirring.
- advance auxiliary fixed-rate fields (waves) inside the fixed substep loop,
  not once per rendered frame, or waves run at the display refresh rate.
