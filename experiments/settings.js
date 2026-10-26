"use strict";

/* Settings layer: the JSON line the page's Copy button produces must be exactly
   what Paste applies, and a paste must never leave the world in a state the
   sliders cannot describe.
   run: node experiments/settings.js */

const assert = require("node:assert/strict");
const eng = require("../js/engine.js");

const world = () => eng.createWorld(1280, 800);

/* 1) the shipped table survives a copy/paste round trip unchanged */
const shipped = eng.readSettings(world());
assert.deepEqual(shipped, eng.SETTINGS, "readSettings reports the shipped defaults");
const pasted = world();
eng.applySettings(pasted, JSON.parse(JSON.stringify(shipped)));
assert.deepEqual(eng.readSettings(pasted), shipped, "read -> apply -> read is a fixed point");

/* 2) a partial paste only moves the keys it names */
const partial = world();
const ignored = eng.applySettings(partial, { coldEnd: 0.5 });
const after = eng.readSettings(partial);
assert.deepEqual(ignored, [], "a known key is not reported as ignored");
assert.equal(after.coldEnd, 0.5, "the named key is applied");
assert.equal(after.fill, shipped.fill, "unnamed keys keep their value");
assert.equal(after.water, shipped.water, "unnamed keys keep their value");

/* 3) junk keys are named and dropped, not swallowed silently */
assert.deepEqual(eng.applySettings(world(), { nope: 1, fill: 0.2 }), ["nope"], "unknown keys are reported");
assert.deepEqual(eng.applySettings(world(), { __proto__: null, nope: 1 }), ["nope"], "unknown keys are reported");

/* 4) a paste cannot drive the world outside the slider ranges */
const clamped = world();
eng.applySettings(clamped, { fill: 0.001, water: 0.9, coldEnd: 0.99, hotStart: 0.1, lift: 5, bondTemp: 99, radius: 1 });
const limits = eng.readSettings(clamped);
assert.ok(limits.fill >= 0.08, "coverage stays above the spawn floor, got " + limits.fill);
assert.ok(limits.water <= 0.75, "water level stays inside the slider range, got " + limits.water);
assert.ok(limits.coldEnd <= 0.80, "cold band stays inside the slider range, got " + limits.coldEnd);
assert.ok(limits.hotStart >= 0.40, "hot band stays inside the slider range, got " + limits.hotStart);
assert.ok(limits.lift <= 1, "thermal lift stays bounded, got " + limits.lift);
assert.ok(limits.bondTemp <= 6, "bond exponent stays bounded, got " + limits.bondTemp);
assert.ok(limits.radius >= 6, "typical radius stays bounded, got " + limits.radius);

/* 5) applying settings really reaches the physics, and a copy reads it back */
const live = world();
eng.applySettings(live, { coldEnd: 0.44, hotStart: 0.86, coldPower: 3.25, hotPower: 0.5, lift: 0.15, water: 0.36, bonds: 0.9 });
assert.equal(live.coldZoneEnd, 0.44, "the cold band field follows the paste");
assert.equal(live.hotZoneStart, 0.86, "the hot band field follows the paste");
assert.equal(live.coldPower, 3.25, "the cold power field follows the paste");
assert.equal(live.hotPower, 0.5, "the hot power field follows the paste");
assert.equal(live.thermalLift, 0.15, "the thermal lift field follows the paste");
assert.equal(live.waterY, Math.round(800 * 0.36 * 1e6) / 1e6, "the waterline follows the paste");
assert.equal(live.linkStrength, 0.9, "the bond strength field follows the paste");
const echoed = eng.readSettings(live);
assert.equal(echoed.coldEnd, 0.44, "a copy after a paste reports the pasted band");
assert.equal(echoed.lift, 0.15, "a copy after a paste reports the pasted lift");

/* 6) the temperature view toggle survives too, so a copied scene restores the view */
const view = world();
eng.applySettings(view, { tempView: true });
assert.equal(view.temperatureView, true, "the paste can turn the temperature view on");
assert.equal(eng.readSettings(view).tempView, true, "the copy reports the temperature view");

/* 7) a scene pasted from a copy is stable: no NaN, no runaway */
const scene = world();
eng.applySettings(scene, shipped);
eng.spawnBed(scene);
for (let f = 0; f < 600; f++) eng.stepWorld(scene, 1 / 60);
let nan = 0, maxV = 0;
for (let i = 0; i < scene.n; i++) {
	if (!isFinite(scene.x[i]) || !isFinite(scene.y[i]) || !isFinite(scene.temp[i])) nan++;
	maxV = Math.max(maxV, Math.hypot(scene.vx[i], scene.vy[i]));
}
assert.equal(nan, 0, "the shipped scene stays finite for 10 s");
assert.ok(maxV < 1000, "no bead runs away, max|v| " + Math.round(maxV) + " px/s");
assert.ok(scene.linkActiveN > 0, "the shipped crust forms bonds, " + scene.linkActiveN + " active links");

console.log("settings checks: round trip, partial paste, unknown keys, clamping, live fields, temperature view and 10 s stability passed");
