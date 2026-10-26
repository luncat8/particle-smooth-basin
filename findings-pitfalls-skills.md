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

- a frame-budget verdict belongs to the browser. The sandbox runs the page through
  `vm.runInContext`, which leaves V8 unable to optimize it, so the same scene costs
  ~10x; a hard-coded 16.7 ms assertion in a node check flakes the moment the renderer
  grows. Give the page a `?budget=` override and let the node harness pass a number
  it can actually hold while the human run keeps 16.7.

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
- a fake DOM that boots the renderer needs `createImageData` (and a plain
  `Uint8ClampedArray` behind it) as soon as anything uploads pixels; returning
  `undefined` from a proxy stand-in fails late, inside the draw call.
- when a fake slider fires `input`, set `element.value` first: a handler that
  closes over its element reads the element, while a real browser has already
  moved it. Firing with only an event target silently tests a stale value
  (`Number("")` → NaN → the slider snaps to `min`).

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
- a solved *target* field with a neutral middle is a thermostat, not a source: if
  every bead relaxes toward the field, the clear gap between the bands pulls the bed
  back to 0.5 as fast as the cold band chills it (temperature at 300 px sat at 0.48,
  19 of 648 beads cold, 9 links). Weight the relaxation rate by the field's distance
  from neutral and the gap does nothing, leaving conduction in charge - the same scene
  then reads 133 cold beads and 19 links, matching the pre-heat-map build. A wash
  drawn with alpha proportional to `|target - 0.5|` is already the honest picture of
  that model.
- a heat-source map must encode *signed coupling strength* to the cold/hot reservoirs
  (`0..0.20` and `1.0`), not an intermediate target temperature. Putting the hot band's
  spatial ramp `w(u)` into the cell target `0.5 + 0.5*w(u)` and *also* weighting the
  relaxation rate by `|field - 0.5|` squared the heating rate (`w(u)²`), capped floor
  beads around `0.85` (since the tank floor is at `0.935*H`), and made the upper half of
  the hot band (`field ~ 0.60`) actively cool rising `0.85` plumes back down — killing
  convection across `thermal` and `thermalGrow` (0/s overturning vs 20/s and 16/s).
  Treat `signed = (field - 0.5)*2` as coupling strength toward `1` (hot) or the cold
  floor (only when warmer), and the wash's `|field - 0.5|` alpha stays linear with the
  true drive.
- band edges are the worst step in a solved field (0.2 of the range at a 0.6 cold
  band with a 0.5 gap); a smoothness assertion has to allow one band edge per
  sweep, not demand a flat grid.

- a two-way heat field is not a symmetric exchange in this model. The field is a
  *source strength*: a warm cell drives beads toward 1 further, it does not drive them
  toward the cell. Writing a bead's raw temperature in (`target = band + feed·(T − 0.5)`)
  therefore amplifies instead of equalizing — a dense hot bed heats its own water and
  then itself, and the shipped scene went from a cold crust to a fully hot tank at
  `feed ≥ 0.75`. Blending the cell toward the bead instead
  (`target = band + feed·m·(T − band)`, `m` the covered share of the cell) writes nothing
  for a bead that already sits at its cell's temperature, which is what keeps the
  coupling near the scenes' own balance. Measure drift and crust counts, not the look.
- the field a bead reads is diffused and clipped, so a single bead's write can never be
  read back at full strength: at 400×300 one bead fills its 8×8 px cell six times over
  and still moved the interpolated read at its centre by a quarter of the cell value.
  Assert on the cell (`field[cy·gx + cx]`), or on a feed-0 baseline of the same world,
  and sample where the bead actually is — a bead that fell 0.4 px crossed the row edge
  and the test read the neighbouring, cold cell.
- a scene check that deals an unseeded bed flakes: one seed in three laid a bed that
  never reached the cold band, and the failure looks exactly like a regression. Seed the
  harness check (`withSeed`) the way the experiments already do, and keep the seed in
  the log so two runs can be compared.

## scene balance

- live coupling presets (`size`, `arch`) also have to carry a matching `buoyancy`. A
  scene tuned for `arch = -10` runs `buoyancy = 0.2`; retuning only `size` and `arch`
  to `[-1, -4]` or `[0, 4]` leaves `buoyancy` at `0.2`, sinking the whole bed to the
  floor with zero links and zero overturning.
- when a convecting bed sends `T ~ 0.95` plumes through its surface crust, the
  arithmetic mean temperature of the top slice spikes whenever a plume crests at the
  sampling frame (~1 in 15 random seeds). Judge the crust with the top slice's median
  temperature plus total cold-bead count, not the slice mean.

- heat has to change a bead's density, not only its size. A size/Archimedes
  coupling alone (`arch-only`, `flat`, `size-only`, `shrink` variants) left the
  bed at `flux ~ 0` for 16-20 s: neighbours shift radii, nothing overturns. The
  mechanism that works is an effective density `dens * (1 - 2*lift*(T - 0.5))`,
  and it only shows up when the heated band is thick enough to touch the bed -
  `hotStart` 0.84 gave 4 hot beads rising per second, 0.78 gave 7.
- judge convection by overturning, not by mean vertical velocity. Net flux
  `mean((T-0.5)*(-vy))` sat between -0.6 and +0.5 (noise) for every candidate,
  while counting hot beads carried above the bed mid-line and cold ones below it
  separated a still bed (0/s) from a circulating one (5-7/s).
- a spawn lattice must be as wide as the widest bead it places. The old fixed
  `2.4 * rBar` checkerboard is narrower than `2 * SIZE_FACTOR_MAX * rBar`, so
  every bed started interpenetrating and blew itself 200-350 px upward in the
  first second (one bead flung at the ceiling then passed for "the bed top").
  Pack rows from each bead's own radius, and measure the bed surface with a
  quantile, not the single highest bead.
- half the beads are buoyant by design (`rollDensity`), so "the bed" always ends
  up with a raft sitting on the waterline and a few beads bobbing above it.
  A free-water metric based on the bed's top quantile flickers across zero for
  that reason; count the beads above the waterline instead (1 of 340 is fine,
  20 of 340 is a bed standing out of the water).
- `setFillFraction`'s old `0.3` minimum silently defeated every sparse candidate
  in a sweep - the sweep looked like "coverage has no effect". Check the setter's
  clamp before concluding anything about a slider.

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
