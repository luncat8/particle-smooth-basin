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
assert.equal(arch.archSize, 0, "archimedes-size coupling defaults to zero");
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
bonded.temp[0] = 1;
bonded.temp[1] = 1;
eng.substep(bonded, eng.SUBSTEP);
assert.equal(bonded.linkK[0], 0, "warm bond softens to zero");

const coverage = eng.createWorld(1280, 800);
eng.setFillFraction(coverage, 0.3);
eng.setTypicalRadius(coverage, 14);
eng.spawnBed(coverage);
const area = coverage.W * coverage.H;
const represented = coverage.n * Math.PI * 1.027 * coverage.rBar * coverage.rBar / area;
assert.ok(Math.abs(represented - 0.3) < 0.004, "bed count matches requested coverage within count quantization");
assert.ok(coverage.n <= eng.SPAWN_CAP, "spawn respects the particle cap");

console.log("thermal checks: independent source/conduction rates, thermal sizing, buoyancy strength, size coupling, bonds and coverage passed");
