"use strict";

/* Settings layer: the JSON line the page's Copy button produces must be exactly
   what Paste applies, a paste must never leave the world in a state the sliders
   cannot describe, and the heat map must be the field the bands name.
   run: node experiments/settings.js */

const assert = require("node:assert/strict");
const eng = require("../js/engine.js");

const world = () => eng.createWorld(1280, 800);

/* 1) the shipped scene survives a copy/paste round trip unchanged */
const shipped = eng.readSettings(world());
assert.deepEqual(shipped, eng.SETTINGS, "readSettings reports the shipped scene");
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

/* 4) a paste cannot drive the world outside the shared ranges */
const clamped = world();
eng.applySettings(clamped, { fill: 0.001, water: 0.99, coldEnd: 0.99, hotStart: 0.01, lift: 5, bondTemp: 99, radius: 1, conduction: 9 });
const limits = eng.readSettings(clamped);
for (const key of Object.keys(eng.RANGES)) {
	if (key === "coldEnd" || key === "hotStart") continue;	// checked below, they depend on each other
	const range = eng.RANGES[key];
	assert.ok(limits[key] >= range.min && limits[key] <= range.max,
		key + " stays inside " + range.min + ".." + range.max + ", got " + limits[key]);
}
assert.ok(limits.coldEnd <= limits.hotStart - 0.05, "the cold band keeps its gap below the hot band, got "
	+ limits.coldEnd + " / " + limits.hotStart);

/* 5) applying settings really reaches the physics, and a copy reads it back */
const live = world();
eng.applySettings(live, { coldEnd: 0.44, hotStart: 0.86, coldPower: 3.25, hotPower: 0.5, lift: 0.15, water: 0.36, bonds: 0.9 });
assert.equal(live.coldZoneEnd, 0.44, "the cold band field follows the paste");
assert.equal(live.hotZoneStart, 0.86, "the hot band field follows the paste");
assert.equal(live.coldPower, 3.25, "the cold power field follows the paste");
assert.equal(live.hotPower, 0.5, "the hot power field follows the paste");
assert.equal(live.thermalLift, 0.15, "the thermal lift field follows the paste");
assert.equal(live.waterY, 800 * 0.36, "the waterline follows the paste");
assert.equal(live.linkStrength, 0.9, "the bond strength field follows the paste");
const echoed = eng.readSettings(live);
assert.equal(echoed.coldEnd, 0.44, "a copy after a paste reports the pasted band");
assert.equal(echoed.lift, 0.15, "a copy after a paste reports the pasted lift");

/* 6) the view mode travels with the scene, and junk views fall back to temperature */
const view = world();
eng.applySettings(view, { view: "heat" });
assert.equal(view.view, "heat", "the paste can switch to the heat map");
assert.equal(eng.readSettings(view).view, "heat", "the copy reports the view");
eng.applySettings(view, { view: "sideways" });
assert.equal(view.view, "temp", "an unknown view falls back to temperature");
eng.applySettings(view, { view: "density" });
assert.equal(eng.readSettings(view).view, "density", "density view survives a round trip");

/* 7) every preset is a complete, pasteable scene; couplings touch only their force keys */
for (const preset of eng.PRESETS) {
	const target = world();
	eng.applyPreset(target, preset);
	if (preset.kind === "coupling") {
		const read = eng.readSettings(target);
		assert.equal(read.size, preset.settings.size, preset.id + " sets thermal size");
		assert.equal(read.arch, preset.settings.arch, preset.id + " sets the size coupling");
		assert.equal(read.buoyancy, preset.settings.buoyancy, preset.id + " sets buoyancy for the coupling");
		assert.equal(read.fill, shipped.fill, preset.id + " leaves the scene alone");
		assert.equal(read.coldEnd, shipped.coldEnd, preset.id + " leaves the bands alone");
		continue;
	}
	assert.deepEqual(eng.readSettings(target), preset.settings, preset.id + " applies every scene key");
	const ignoredKeys = eng.applySettings(world(), preset.settings);
	assert.deepEqual(ignoredKeys, [], preset.id + " only names known keys");
}

/* 8) the heat map is the bands: top of the window cold, floor hot, neutral between */
const map = world();
const sweeps = eng.solveHeatMap(map);
assert.ok(sweeps > 0 && sweeps <= 240, "the map solves in its sweep budget, took " + sweeps);
const topHeat = eng.heatAt(map, 640, 40);
const waterHeat = eng.heatAt(map, 640, map.waterY);
const floorHeat = eng.heatAt(map, 640, map.tank.y1 - 30);
assert.ok(topHeat < 0.2, "the top of the window reads cold, got " + topHeat.toFixed(2));
assert.ok(waterHeat < 0.47, "the waterline reads colder than neutral, got " + waterHeat.toFixed(2));
assert.ok(floorHeat > 0.75, "the floor reads hot, got " + floorHeat.toFixed(2));
const gap = eng.heatAt(map, 640, 420);
assert.ok(gap > 0.45 && gap < 0.55, "the gap between the bands stays neutral, got " + gap.toFixed(2));
assert.ok(eng.heatAt(map, 20, 40) > topHeat, "outside the glass the field falls back toward the room");

/* 9) the map follows the sliders without a re-deal */
const moved = world();
eng.solveHeatMap(moved);
const before = eng.heatAt(moved, 640, 300);
eng.setColdZoneEnd(moved, 0.6);
eng.solveHeatMap(moved);
const afterBand = eng.heatAt(moved, 640, 300);
assert.ok(afterBand < before - 0.1, "a deeper cold band chills the field at 300 px: " + before.toFixed(2) + " -> " + afterBand.toFixed(2));
assert.equal(moved.heat.version > 1, true, "a solved map is versioned");

/* 10) the field is smooth: a band edge is the worst step anywhere on the grid */
let biggestStep = 0;
for (let cy = 0; cy < moved.heat.gy; cy++) {
	for (let cx = 1; cx < moved.heat.gx; cx++) {
		const i = cy * moved.heat.gx + cx;
		biggestStep = Math.max(biggestStep, Math.abs(moved.heat.field[i] - moved.heat.field[i - 1]));
	}
}
assert.ok(biggestStep < 0.25, "neighbouring cells differ by less than a quarter range, got " + biggestStep.toFixed(3));

/* 11) a scene pasted from a copy is stable: no NaN, no runaway */
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
assert.ok(scene.linkActiveN > 0, "the shipped scene forms some bonds, " + scene.linkActiveN + " active links");

/* 12) every scene preset heats its floor near 1 and overturns; live couplings work on the shipped bed */
function measurePreset(base, coupling, frames) {
	let rng = 0x9e3779b9;
	const savedRandom = Math.random;
	Math.random = () => {
		rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
		return (rng >>> 0) / 4294967296;
	};
	try {
		const w = world();
		eng.applyPreset(w, base);
		eng.spawnBed(w);
		if (coupling) eng.applyPreset(w, coupling);
		const ys = Array.prototype.slice.call(w.y, 0, w.n).sort((a, b) => a - b);
		const midY = (ys[Math.floor(w.n * 0.02)] + w.tank.y1) / 2;
		const wasUp = new Uint8Array(w.n);
		let hotRise = 0;
		for (let f = 0; f < frames; f++) {
			eng.stepWorld(w, 1 / 60);
			for (let i = 0; i < w.n; i++) {
				const up = w.y[i] < midY ? 1 : 0;
				if (up === wasUp[i]) continue;
				wasUp[i] = up;
				if (up && w.temp[i] > 0.6) hotRise++;
			}
		}
		let maxT = 0;
		for (let i = 0; i < w.n; i++) if (w.temp[i] > maxT) maxT = w.temp[i];
		return { maxT, links: w.linkActiveN, hotRise };
	} finally {
		Math.random = savedRandom;
	}
}

for (const preset of eng.PRESETS) {
	if (preset.kind !== "scene") continue;
	const m = measurePreset(preset, null, 1080);
	assert.ok(m.maxT > 0.90, preset.id + " heats floor beads above 0.90, got " + m.maxT.toFixed(2));
	assert.ok(m.links > 10, preset.id + " forms a cold crust, got " + m.links + " links");
	assert.ok(m.hotRise >= 20, preset.id + " overturns hot beads above mid-bed, got " + m.hotRise);
}
for (const id of ["shrinkConvection", "growConvection"]) {
	const m = measurePreset(eng.PRESETS[0], eng.PRESET_BY_ID[id], 720);
	assert.ok(m.links > 50 && m.hotRise >= 40, id + " convects and bonds on the shipped bed, got links=" + m.links + " rise=" + m.hotRise);
}
for (const id of ["shrinkStable", "growStable"]) {
	const m = measurePreset(eng.PRESETS[0], eng.PRESET_BY_ID[id], 720);
	assert.ok(m.links > 50 && m.hotRise < 10, id + " stays stratified on the shipped bed, got links=" + m.links + " rise=" + m.hotRise);
}

console.log("settings checks: round trip, partial paste, unknown keys, clamping, live fields, view mode, presets,"
	+ " heat map geometry, 10 s stability and preset overturning passed");
