# Hydrogel Basin

A file://-friendly particle basin experiment. Open `index.html` directly in a modern browser; there are no external libraries or build steps.

## Controls

- Drag beads to grab/toss; click the basin to add a bead. Hovering changes the cursor but does not stir; hold/drag to apply the brush force.
- `SPACE` splashes the bed; `R` re-deals it using the current settings.
- **Thermal zones** relax beads toward a cold band at the top and a hot band at the floor. **Cold zone depth** (20–80% of the window) and **hot zone top** (50–95%) place the bands; **cold power** and **hot power** (0–4×) set how fast each band pulls a bead toward its target. **Conduction** independently sets heat transfer between nearby beads.
- **Heat lifts** (0–1) makes a hot bead lighter than a cold one: the effective density is scaled by `1 - lift·2·(T - 0.5)`. That is what lets a heated floor overturn the bed instead of only nudging neighbours through the size coupling.
- **Bond strength** (0–1.2) is the stiffness of a cold contact bond and **bond vs temperature** (0.5–6) is how sharply that stiffness falls as the pair warms.
- **Thermal size** controls how temperature changes collision and drawn radius. At full positive response, the radius at temperature 1 is twice the radius at temperature 0; negative response reverses the effect.
- **Archimedes force vs size** is a signed exponent from -10 to +10: buoyant lift scales with `(radius / typical radius)^value`. The lift multiplier is bounded to 1/8–8× so extreme settings remain usable.
- **Buoyancy strength** scales the Archimedes term from 0–2×. At 0, beads feel gravity without buoyancy; 1× preserves the default density-based balance.
- **Quick preset** applies thermal-size and Archimedes-size combinations for shrink flow, big floaters, convection-style loops, and stable layering. It leaves buoyancy, source, and conduction rates untouched for further tuning.
- **Water level** (30–60% of the window height) moves the waterline without a re-deal; the bed re-floats around it.
- **Canvas coverage** (8–60% of summed typical particle-disc area) and **typical radius** set the number and scale of beads on the next re-deal. The particle cap can limit the top end at small radii.
- **Average mass** scales inertia while the independent random density continues to determine buoyancy.
- **Temperature hue** switches from density colors to the normalized 0–1 temperature palette.
- **Copy settings** writes every control as one JSON line to the clipboard; **Paste settings** takes that line back (a pasted scene is re-dealt and the panel re-synced), and **Defaults** restores the shipped scene. Paste ignores unknown keys and reports them, and it clamps everything through the same setters the sliders use, so a hand-edited line can never leave the world in a state the panel cannot describe.

The shipped scene is a sparse bed: 21% coverage, waterline at 30%, the cold band from the top down to 56% and heat from 78% to the floor. Half of the beads are buoyant, so the bed floats a raft of light beads at the surface; the cold band starts right there, which is why the raft bonds within a couple of seconds, while the heated floor keeps the bottom of the bed moving. Cold nearby beads form distance-constraint bonds that soften as the pair warms and thaw once warm or stretched beyond neighbor range.

## Development checks

Double-click `run_tests.py` (or `python3 run_tests.py` — no arguments needed). It runs the node checks, then serves this directory and opens `tests.html` in your browser, and both halves land in one log named `<version>-tests-<date-time>.log` under `experiments/logs/`, with the version read from `VERSION`. The server's root redirects to the tests page; the app itself stays at `/index.html`.

- **Node checks** — `experiments/smoke.js` (classic-script boot, presets, controls, settings copy/paste/reset, DPR change, `?profile=1`), `experiments/thermal.js` (thermal, pointer, wave-step, bond lifetime), `experiments/bench.js` (seeded throughput and link-capacity baseline), `experiments/thermal-zone.js` (zone geometry and source-rate sweep: bond count, band temperatures, link churn, stir recovery), `experiments/settings.js` (copy/paste round trip, partial pastes, unknown keys, clamping, 10 s stability of the pasted scene), `experiments/harness.js` (lint and sandbox run of the browser harness).
- **Browser tests** — `tests.html` runs its checks (boot, canvas pixels, invariants, pointer/splash, resize, thermal bounds, shipped-scene geometry and bond visibility, profiler) and a frame-profile matrix that always starts with the shipped scene, then ≈300/810/1500 beads × DPR 1/2 × temperature view, then a cold/high-link preset and a stirred near-cap scene. Every case reports p50/p95 for the frame callback, `stepWorld`, `render`, and the `requestAnimationFrame` interval.
- **GPU** — the environment line classifies the renderer (hardware versus SwiftShader/llvmpipe), and the `rAF p95` column is where raster and compositor cost shows up; there is no WebGPU path yet, so no GPU-versus-CPU parity case exists.
- **Results** — the page appends its section to the run log automatically when a run finishes and then shows `Saved ✓` on a disabled, highlighted button: the same log is never written twice (the server also rejects a repeated section, so two tabs cannot duplicate it). The button comes back as soon as a new line exists. `Copy log` copies the log. Opening `tests.html` directly (`file://`) works too — Save then downloads the file.

The server sends `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`, so the page is cross-origin isolated and `performance.now()` keeps microsecond resolution instead of being coarsened to 0.1 ms. That is the only reason the runner is a server; `file://` timings still work but are coarser.

`index.html?profile=1` measures the real page (HUD included) on its own: after 300 frames the stats line and console show p50/p95 for frame, simulation, and render. The recorder lives in `js/profile.js` and is shared with `tests.html`; profiling is off unless requested and adds no per-frame allocation.

The engine is DOM-free and can be required directly by Node; `experiments/fake-dom.js` boots a page bundle in a VM for the node checks, which validates logic but never canvas pixels or real frame times.
