# Hydrogel Basin

A file://-friendly particle basin experiment. Open `index.html` directly in a modern browser; there are no external libraries or build steps.

## Controls

- Drag beads to grab/toss; click the basin to add a bead.
- `SPACE` splashes the bed; `R` re-deals it using the current settings.
- **Thermal sources** relax beads toward the cold upper zone and hot lower zone. **Conduction** independently sets heat transfer between nearby beads; both rates range from 0–4×.
- **Thermal size** controls how temperature changes collision and drawn radius. At full positive response, the radius at temperature 1 is twice the radius at temperature 0; negative response reverses the effect.
- **Archimedes force vs size** is a signed exponent from -10 to +10: buoyant lift scales with `(radius / typical radius)^value`. The lift multiplier is bounded to 1/8–8× so extreme settings remain usable.
- **Buoyancy strength** scales the Archimedes term from 0–2×. At 0, beads feel gravity without buoyancy; 1× preserves the default density-based balance.
- **Quick preset** applies thermal-size and Archimedes-size combinations for shrink flow, big floaters, convection-style loops, and stable layering. It leaves buoyancy, source, and conduction rates untouched for further tuning.
- **Canvas coverage** (30–70% of summed typical particle-disc area) and **typical radius** set the number and scale of beads on the next re-deal. The particle cap can limit the top end at small radii.
- **Average mass** scales inertia while the independent random density continues to determine buoyancy.
- **Temperature hue** switches from density colors to the normalized 0–1 temperature palette.

The upper part of the basin is a cold gradient source; the lower part adds heat. Cold nearby beads form distance-constraint bonds that soften as the pair warms.

## Development checks

Run `node experiments/bench.js` for physics sanity and throughput checks. Run `node experiments/thermal.js` and `node experiments/smoke.js` for focused thermal and UI checks. The engine is DOM-free and can be required directly by Node.
