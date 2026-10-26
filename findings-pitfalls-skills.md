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

## profiling

- a one-shot profile summary written to a periodically refreshed
  stats element is erased within a second. gate the refresh once the
  profile is done, or the measurement scrolls away before it is read.
- `Float64Array.prototype.sort()` sorts numerically (unlike `Array`
  string sort), so p50/p95 over preallocated samples needs no
  comparator closure or scratch array beyond one `slice()` at report.

## browser harness

- serve the harness instead of using `file://`: with `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, the page is
  cross-origin isolated and `performance.now()` steps at ~5 us; without it the
  clock is coarsened to 100 us, which is coarse against sub-millisecond stages.
  `Cache-Control: no-store` keeps a reload from profiling a stale script.
- measure the `requestAnimationFrame` interval next to the callback work. Callback
  timing says how long your JS ran; the interval is where a slow compositor,
  raster or an over-budget draw shows up as missed vsync. Both belong in the log.
- a matrix harness needs a fixed scene, not the live page: rebuild the world per
  case, set fill/radius before `spawnBed`, attach `buildSprites()` output to
  `makeAssets()` (it leaves `sprites` null for app.js to fill), and time only
  `stepWorld` + `render`, never scene setup.
- `makeAssets()` is geometry-bound; call it after every backing-store resize or
  gradients and `Path2D` outlines keep the old viewport.
- beads legitimately leave the visible tank: the bed stacks from the floor upward
  and its top row spawns above the rim of an open-topped basin, and a splash
  throws beads above it. Invariants should bound the side walls, the floor and a
  generous ceiling, not the tank outline.
- a browser harness is still mostly testable in node: extract the page's inline
  script, compile it with `vm.Script` for syntax, check every requested element id
  exists in the markup, then run the script in the fake DOM and drive
  `window.Harness`. That catches broken selectors, wrong engine calls and bad
  assertions without a browser. Pixels and frame times remain browser-only.
- have the page POST its log to the runner (`POST /__log`) so one run is one file:
  the node half is already in the file, and the page appends its own section with
  the environment line, every check, every perf row and a single `RESULT` line.
  Keep a download fallback for `file://` where there is no server.
- an appending save needs two independent walls against the same numbers landing
  twice: the page keeps the exact text it last saved and disables the button
  ("Saved", highlighted) until any new line appears, and the server compares the
  posted body with the previous one and answers `duplicate: true` instead of
  appending. The client check alone fails when two tabs or a stale page save the
  same run; the server check alone still lets the user click into an invisible
  no-op. Note the trap in the client half: the "already saved" feedback must not
  itself append a log line, or the log text changes and the next click saves again.
- name run logs `<version>-tests-<date-time>.log` and read the version from one
  `VERSION` file at the repo root, passed to the page as `?version=` so a
  downloaded fallback carries the same prefix. A directory of runs then sorts and
  greps by plan number, which is how these logs get compared.
- write run logs with `newline='\n'`. Python's text mode turns every `\n` into
  `\r\n` on Windows, which mixed with the node half of the same file.
- print clock resolution in the unit it was measured in. `performance.now()` steps
  by ~5 us when cross-origin isolated and 100 us otherwise; dividing microseconds
  by 1000 and printing two decimals reported "0.00 us" on every platform.

## tooling

- classic `<script>` files share one global lexical scope in the
  browser (top-level `const` from engine.js is visible in render.js),
  but node `require()` isolates each file. to smoke-test a page bundle
  under node, concatenate the sources into one compile unit.
- the sim engine stays DOM-free and guarded by `module.exports`, so
  experiments/ can require it directly — bench and sanity checks run in
  milliseconds without a browser.

## thermal tuning

- a relaxation zone that ends above the settled bed produces a thermal model that
  looks dead at its default rates: 810 beads, 1x source, band ending at 0.24 of the
  view — 23 cold beads and 60 links. The band has to overlap the bed, and the
  metric to judge it by is bond count plus the band temperatures on either side,
  not the slider range. Retune geometry before rates; the rates only widen the
  gradient once some of the bed is inside the band.
- keep a drawn gradient and its physics band on the same variable. Two hard-coded
  0.24/0.76 pairs in engine and render meant the picture and the measurement could
  disagree, and the number could not be swept.
- sweep geometry against a seeded bed and report frame cost next to the look. Here
  every band from 0.36 to 0.48 costs 0.78-0.87 ms/frame, so the choice was purely
  visual and could be made without a budget argument.

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
