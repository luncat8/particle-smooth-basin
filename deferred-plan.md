# Deferred directions

These are design options, not scheduled work. Do not treat them as requirements for the current release.

## Paintable heat source layer (from `0.5-draft.md` B)

In the heat view, a mode switch could make a drag paint a local heat source or sink rather than move a band edge. The field would combine the two band reservoirs with a painted layer before the solve; beads would still read and feed the same field.

- Store stamps or a coarse layer in the settings JSON so Copy/Paste reproduces the scene. Define coordinates relative to the window so resize preserves placement, and cap strengths to keep the field bounded.
- Keep band-line dragging available and make the active mode visible in the panel and cursor. Decide how erasing, clearing, and repeated strokes work before adding controls.
- Compare a painted hot/cold spot before and after `HEAT_PULL`, with and without bead feed, across resize and settings round trips. Measure solve cost while painting, since changing targets may require a full settle rather than the six live sweeps.
- Revisit only if local sources are needed beyond the band-and-bead model; do not add a second source layer as part of the renderer/DPR review.
