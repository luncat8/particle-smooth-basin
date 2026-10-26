# Hydrogel Basin

A file://-friendly particle basin experiment. Open `index.html` directly in a modern browser; there are no external libraries or build steps.

## Controls

- Drag beads to grab/toss; click the basin to add a bead. Hovering changes the cursor but does not stir; hold/drag to apply the brush force.
- `SPACE` splashes the bed; `R` re-deals it using the current settings.
- **Thermal sources** relax beads toward the cold upper zone and hot lower zone. **Conduction** independently sets heat transfer between nearby beads; both rates range from 0–4×.
- **Thermal size** controls how temperature changes collision and drawn radius. At full positive response, the radius at temperature 1 is twice the radius at temperature 0; negative response reverses the effect.
- **Archimedes force vs size** is a signed exponent from -10 to +10: buoyant lift scales with `(radius / typical radius)^value`. The lift multiplier is bounded to 1/8–8× so extreme settings remain usable.
- **Buoyancy strength** scales the Archimedes term from 0–2×. At 0, beads feel gravity without buoyancy; 1× preserves the default density-based balance.
- **Quick preset** applies thermal-size and Archimedes-size combinations for shrink flow, big floaters, convection-style loops, and stable layering. It leaves buoyancy, source, and conduction rates untouched for further tuning.
- **Canvas coverage** (30–70% of summed typical particle-disc area) and **typical radius** set the number and scale of beads on the next re-deal. The particle cap can limit the top end at small radii.
- **Average mass** scales inertia while the independent random density continues to determine buoyancy.
- **Temperature hue** switches from density colors to the normalized 0–1 temperature palette.

The upper part of the basin is a cold gradient source; the lower part adds heat. Cold nearby beads form distance-constraint bonds that soften as the pair warms and thaw once warm or stretched beyond neighbor range.

## Development checks

Double-click `run_tests.py` (or `python3 run_tests.py` — no arguments needed). It runs the node checks, then serves this directory and opens `tests.html` in your browser, and both halves land in one log named `<version>-tests-<date-time>.log` under `experiments/logs/`, with the version read from `VERSION`. The server's root redirects to the tests page; the app itself stays at `/index.html`.

- **Node checks** — `experiments/smoke.js` (classic-script boot, presets, controls, DPR change, `?profile=1`), `experiments/thermal.js` (thermal, pointer, wave-step, bond lifetime), `experiments/bench.js` (seeded throughput and link-capacity baseline), `experiments/harness.js` (lint and sandbox run of the browser harness).
- **Browser tests** — `tests.html` runs its checks (boot, canvas pixels, invariants, pointer/splash, resize, thermal bounds, profiler) and the frame-profile matrix from `0.3-plan.md` — ≈300/810/1500 beads × DPR 1/2 × temperature view, then a cold/high-link preset and a stirred near-cap scene. Every case reports p50/p95 for the frame callback, `stepWorld`, `render`, and the `requestAnimationFrame` interval.
- **GPU** — the environment line classifies the renderer (hardware versus SwiftShader/llvmpipe), and the `rAF p95` column is where raster and compositor cost shows up; there is no WebGPU path yet, so no GPU-versus-CPU parity case exists.
- **Results** — the page appends its section to the run log automatically when a run finishes and then shows `Saved ✓` on a disabled, highlighted button: the same log is never written twice (the server also rejects a repeated section, so two tabs cannot duplicate it). The button comes back as soon as a new line exists. `Copy log` copies the log. Opening `tests.html` directly (`file://`) works too — Save then downloads the file.

The server sends `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`, so the page is cross-origin isolated and `performance.now()` keeps microsecond resolution instead of being coarsened to 0.1 ms. That is the only reason the runner is a server; `file://` timings still work but are coarser.

`index.html?profile=1` measures the real page (HUD included) on its own: after 300 frames the stats line and console show p50/p95 for frame, simulation, and render. The recorder lives in `js/profile.js` and is shared with `tests.html`; profiling is off unless requested and adds no per-frame allocation.

The engine is DOM-free and can be required directly by Node; `experiments/fake-dom.js` boots a page bundle in a VM for the node checks, which validates logic but never canvas pixels or real frame times.
