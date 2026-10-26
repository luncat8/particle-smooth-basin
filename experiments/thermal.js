"use strict";

const assert = require("node:assert/strict");
const eng = require("../js/engine.js");

function placePair(world, y, distance) {
	world.n = 2;
	world.rMax = 24;
	for (let i = 0; i < 2; i++) {
		world.x[i] = 180 + i * distance;
		world.y[i] = y;
		world.px[i] = world.x[i];
		world.py[i] = y;
		world.vx[i] = 0;
		world.vy[i] = 0;
		world.r[i] = 10;
		world.baseSize[i] = 10 / world.rBar;
		world.dens[i] = 1;
		world.invM[i] = 1 / 100;
		world.temp[i] = 0.5;
	}
}

const world = eng.createWorld(640, 480);
assert.equal(world.sourceRate, 1, "thermal source rate defaults to 1x");
assert.equal(world.conductionRate, 1, "conduction rate defaults to 1x");
eng.setSourceRate(world, 0);
eng.setConductionRate(world, 0);
placePair(world, 70, 25);
world.temp[0] = 0.7;
world.temp[1] = 0.3;
eng.substep(world, eng.SUBSTEP);
assert.ok(Math.abs(world.temp[0] - 0.7) < 1e-6, "zero source and conduction rates leave temperature unchanged");
assert.ok(Math.abs(world.temp[1] - 0.3) < 1e-6, "zero source and conduction rates leave temperature unchanged");

eng.setSourceRate(world, 4);
placePair(world, 18, 25);
eng.substep(world, eng.SUBSTEP);
assert.ok(world.temp[0] < 0.5, "top zone cools beads with source rate alone");
placePair(world, 470, 25);
eng.substep(world, eng.SUBSTEP);
assert.ok(world.temp[0] > 0.5, "bottom zone heats beads with source rate alone");
assert.ok(world.temp[0] >= 0 && world.temp[0] <= 1, "temperature remains normalized");

eng.setSourceRate(world, 0);
eng.setConductionRate(world, 4);
placePair(world, 220, 24);
world.temp[0] = 0.8;
world.temp[1] = 0.2;
eng.substep(world, eng.SUBSTEP);
assert.ok(world.temp[0] < 0.8 && world.temp[1] > 0.2, "conduction equalizes nearby beads with source rate zero");
assert.ok(Math.abs(world.temp[0] + world.temp[1] - 1) < 1e-6, "pairwise conduction conserves normalized temperature sum");
eng.setConductionRate(world, 0);
placePair(world, 220, 24);
world.temp[0] = 0.8;
world.temp[1] = 0.2;
eng.substep(world, eng.SUBSTEP);
assert.ok(Math.abs(world.temp[0] - 0.8) < 1e-6, "zero conduction leaves bead temperatures unchanged");
assert.ok(Math.abs(world.temp[1] - 0.2) < 1e-6, "zero conduction leaves bead temperatures unchanged");

eng.setSizeResponse(world, 1);
placePair(world, 220, 30);
world.temp[0] = 0;
world.temp[1] = 1;
eng.substep(world, eng.SUBSTEP);
assert.ok(Math.abs(world.r[1] / world.r[0] - 2) < 1e-6, "full positive thermal response produces a 2x endpoint radius ratio");
eng.setSizeResponse(world, -1);
eng.substep(world, eng.SUBSTEP);
assert.ok(Math.abs(world.r[0] / world.r[1] - 2) < 1e-6, "negative thermal response reverses the endpoint size ratio");

// Buoyancy strength and Archimedes-size coupling are independent live controls.
const arch = eng.createWorld(640, 480);
assert.equal(arch.archSize, eng.SETTINGS.arch, "the settings table carries the world's shipped coupling");
eng.setArchSize(arch, 0);	// the checks below want the coupling out of the way
assert.equal(arch.buoyancy, 1, "buoyancy strength defaults to 1x");
eng.setSourceRate(arch, 0);
eng.setConductionRate(arch, 0);
eng.setSizeResponse(arch, 0);
placePair(arch, 300, 100);
arch.r[0] = arch.rBar; arch.baseSize[0] = 1; arch.invM[0] = 1 / (arch.rBar * arch.rBar);
arch.r[1] = arch.rBar * 2; arch.baseSize[1] = 2; arch.invM[1] = 1 / (4 * arch.rBar * arch.rBar);
eng.substep(arch, eng.SUBSTEP);
assert.ok(Math.abs(arch.vy[0]) < 1e-9 && Math.abs(arch.vy[1]) < 1e-9, "default buoyancy preserves neutral hover at any size when coupling is zero");

eng.setBuoyancy(arch, 0);
eng.substep(arch, eng.SUBSTEP);
assert.ok(arch.vy[0] > 0 && arch.vy[1] > 0, "zero buoyancy leaves gravity only");
arch.vx[0] = arch.vy[0] = arch.vx[1] = arch.vy[1] = 0;
eng.setBuoyancy(arch, 2);
eng.substep(arch, eng.SUBSTEP);
assert.ok(arch.vy[0] < 0 && arch.vy[1] < 0, "2x buoyancy lifts neutral submerged beads");
arch.vx[0] = arch.vy[0] = arch.vx[1] = arch.vy[1] = 0;
eng.setBuoyancy(arch, 1);

eng.setArchSize(arch, 1);
eng.substep(arch, eng.SUBSTEP);
assert.ok(Math.abs(arch.vy[0]) < 1e-9 && arch.vy[1] < -4, "positive coupling lifts the double-radius neutral bead only");
arch.vx[0] = arch.vy[0] = arch.vx[1] = arch.vy[1] = 0;
eng.setArchSize(arch, -1);
eng.substep(arch, eng.SUBSTEP);
assert.ok(arch.vy[1] > 2, "negative coupling makes the double-radius bead sink");
arch.vx[0] = arch.vy[0] = arch.vx[1] = arch.vy[1] = 0;
eng.setArchSize(arch, 10);
eng.substep(arch, eng.SUBSTEP);
assert.ok(arch.vy[1] < -70 && Number.isFinite(arch.vy[1]), "maximum coupling gives strong but bounded lift");
assert.equal(arch.archSize, 10, "positive archimedes-size range reaches +10");
arch.vx[0] = arch.vy[0] = arch.vx[1] = arch.vy[1] = 0;
eng.setArchSize(arch, -10);
eng.substep(arch, eng.SUBSTEP);
assert.ok(arch.vy[1] > 8 && Number.isFinite(arch.vy[1]), "minimum coupling gives strong but bounded sinking");
assert.equal(arch.archSize, -10, "negative archimedes-size range reaches -10");
eng.setArchSize(arch, 20);
assert.equal(arch.archSize, 10, "archimedes-size coupling clamps to +10");
eng.setArchSize(arch, -20);
assert.equal(arch.archSize, -10, "archimedes-size coupling clamps to -10");
eng.setBuoyancy(arch, -1);
assert.equal(arch.buoyancy, 0, "buoyancy strength clamps to 0x");
eng.setBuoyancy(arch, 3);
assert.equal(arch.buoyancy, 2, "buoyancy strength clamps to 2x");

const bonded = eng.createWorld(640, 480);
eng.setSourceRate(bonded, 0);
eng.setConductionRate(bonded, 0);
placePair(bonded, 220, 20.8);
bonded.temp[0] = 0.1;
bonded.temp[1] = 0.1;
eng.substep(bonded, eng.SUBSTEP);
assert.equal(bonded.linkN, 1, "cold near-contact pair creates one bond");
assert.ok(bonded.linkK[0] > 0, "cold bond has positive stiffness");
const rest = bonded.linkRest[0];
eng.substep(bonded, eng.SUBSTEP);
assert.equal(bonded.linkN, 1, "cold bond persists across substeps");
assert.equal(bonded.linkRest[0], rest, "persistent bond keeps its rest distance");
bonded.temp[0] = 1;
bonded.temp[1] = 1;
eng.substep(bonded, eng.SUBSTEP);
assert.equal(bonded.linkN, 0, "warm bond thaws and leaves the solver");
assert.equal(bonded.linkK[0], 0, "thawed bond has zero stiffness");
placePair(bonded, 220, 200);
bonded.temp[0] = 0.1;
bonded.temp[1] = 0.1;
eng.substep(bonded, eng.SUBSTEP);
assert.equal(bonded.linkN, 0, "separated cold beads do not retain a long-range bond");

// Hovering must not stir; only a held pointer applies the brush force.
const hover = eng.createWorld(640, 480);
eng.setSourceRate(hover, 0);
eng.setConductionRate(hover, 0);
hover.n = 1;
hover.x[0] = 200; hover.y[0] = hover.waterY;
hover.px[0] = hover.x[0]; hover.py[0] = hover.y[0];
hover.vx[0] = hover.vy[0] = 0;
hover.r[0] = 10; hover.baseSize[0] = 10 / hover.rBar;
hover.dens[0] = 0.5; hover.invM[0] = 1 / (0.5 * 100);
hover.temp[0] = 0.5;
eng.pointerMove(hover, 230, hover.waterY);
eng.substep(hover, eng.SUBSTEP);
assert.ok(Math.abs(hover.vx[0]) < 1e-9, "hover does not stir beads");
eng.pointerDown(hover, 230, hover.waterY, 0);
eng.substep(hover, eng.SUBSTEP);
assert.ok(hover.vx[0] < -1, "held pointer stirs nearby beads");
eng.pointerUp(hover, 1000);
assert.equal(hover.pointer.vx, 0, "pointer release clears stale brush velocity");
eng.pointerMove(hover, 230, hover.waterY);
hover.x[0] = 200; hover.y[0] = hover.waterY;
hover.vx[0] = hover.vy[0] = 0;
eng.substep(hover, eng.SUBSTEP);
assert.ok(Math.abs(hover.vx[0]) < 1e-9 && hover.n === 1, "released pointer stops stirring without adding a bead");

// Source-only updates keep temperature normalized even above the canvas.
const sourceOnly = eng.createWorld(640, 480);
eng.setConductionRate(sourceOnly, 0);
eng.setSourceRate(sourceOnly, 4);
sourceOnly.n = 1;
sourceOnly.x[0] = 100; sourceOnly.y[0] = -50;
sourceOnly.vx[0] = sourceOnly.vy[0] = 0;
sourceOnly.temp[0] = 0.5;
for (let i = 0; i < 120; i++) {
	sourceOnly.y[0] = -50;
	sourceOnly.vx[0] = sourceOnly.vy[0] = 0;
	eng.substep(sourceOnly, eng.SUBSTEP);
}
assert.ok(sourceOnly.temp[0] >= 0 && sourceOnly.temp[0] <= 1, "source-only temperature stays normalized above the canvas");

// The visual wave field must not advance faster on high-refresh displays.
const wave60 = eng.createWorld(640, 480), wave120 = eng.createWorld(640, 480);
for (const w of [wave60, wave120]) {
	w.n = 0;
	eng.disturb(w, 320, 1);
}
const frame60 = 2 * eng.SUBSTEP;
for (let f = 0; f < 120; f++) eng.stepWorld(wave60, frame60);
for (let f = 0; f < 240; f++) eng.stepWorld(wave120, eng.SUBSTEP);
let waveDiff = 0;
for (let i = 0; i < wave60.wave.n; i++) {
	waveDiff = Math.max(waveDiff, Math.abs(wave60.wave.h[i] - wave120.wave.h[i]));
}
assert.ok(waveDiff < 1e-5, "wave state is identical at 60 Hz and 120 Hz frame rates");

const coverage = eng.createWorld(1280, 800);
eng.setFillFraction(coverage, 0.3);
eng.setTypicalRadius(coverage, 14);
eng.spawnBed(coverage);
const area = coverage.W * coverage.H;
const represented = coverage.n * Math.PI * 1.027 * coverage.rBar * coverage.rBar / area;
assert.ok(Math.abs(represented - 0.3) < 0.004, "bed count matches requested coverage within count quantization");
assert.ok(coverage.n <= eng.SPAWN_CAP, "spawn respects the particle cap");

console.log("thermal checks: rates, sizing, buoyancy, size coupling, thawing links, pointer, wave steps and coverage passed");
