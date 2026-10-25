# Hydrogel Basin

A file://-friendly particle basin experiment. Open `index.html` directly in a modern browser; there are no external libraries or build steps.

## Controls

- Drag beads to grab/toss; click the basin to add a bead.
- `SPACE` splashes the bed; `R` re-deals it using the current settings.
- **Heat exchange** controls cold/hot zone relaxation and heat transfer between nearby beads.
- **Thermal size** controls how temperature changes collision and drawn radius. At full positive response, the radius at temperature 1 is twice the radius at temperature 0; negative response reverses the effect.
- **Canvas coverage** (30–70% of summed typical particle-disc area) and **typical radius** set the number and scale of beads on the next re-deal. The particle cap can limit the top end at small radii.
- **Average mass** scales inertia while the independent random density continues to determine buoyancy.
- **Temperature hue** switches from density colors to the normalized 0–1 temperature palette.

The upper part of the basin is a cold gradient source; the lower part adds heat. Cold nearby beads form distance-constraint bonds that soften as the pair warms.

## Development checks

Run `node experiments/bench.js` for physics sanity and throughput checks. The engine is DOM-free and can be required directly by Node.
