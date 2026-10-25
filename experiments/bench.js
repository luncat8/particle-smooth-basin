"use strict";

/* bench + sanity checks for js/engine.js; not loaded by the page.
   run: node experiments/bench.js */

const eng = require("../js/engine.js");

const W = 1280, H = 800;
const world = eng.createWorld(W, H);

function scanNaN(w) {
	let bad = 0;
	for (let i = 0; i < w.n; i++) {
		if (!isFinite(w.x[i]) || !isFinite(w.y[i]) || !isFinite(w.vx[i]) || !isFinite(w.vy[i])) bad++;
	}
	return bad;
}

function settleStats(w) {
	let maxV = 0, sumV = 0, above = 0, deep = 0, sumF = 0;
	for (let i = 0; i < w.n; i++) {
		const sp = Math.hypot(w.vx[i], w.vy[i]);
		if (sp > maxV) maxV = sp;
		sumV += sp;
		sumF += w.frac[i];
		if (w.y[i] + w.r[i] < w.waterY) above++;
		if (w.frac[i] > 0.99) deep++;
	}
	return { maxV, meanV: sumV / w.n, above, deep, meanF: sumF / w.n };
}

// --- throughput: 60 s of sim time in 1/60 frames ---
const FRAMES = 3600;
const t0 = process.hrtime.bigint();
let pairMax = 0;
for (let f = 0; f < FRAMES; f++) {
	eng.stepWorld(world, 1 / 60);
	if (world.pairN > pairMax) pairMax = world.pairN;
}
const msPerFrame = Number(process.hrtime.bigint() - t0) / 1e6 / FRAMES;

const s = settleStats(world);
console.log("0.1.0 bench  node=" + process.version + "  " + W + "x" + H);
console.log("n=" + world.n + "  rBar=" + world.rBar.toFixed(1));
console.log("throughput: " + msPerFrame.toFixed(2) + " ms/frame (" + (1000 / msPerFrame).toFixed(0) + " fps headroom) at " + FRAMES + " frames / 60 s sim");
console.log("after settle: NaN=" + scanNaN(world) + "  max|v|=" + s.maxV.toFixed(0) + "  mean|v|=" + s.meanV.toFixed(1));
console.log("distribution: above line=" + s.above + "  fully submerged=" + s.deep + "  mean sub. frac=" + s.meanF.toFixed(2));
console.log("pairs: max per substep=" + pairMax + "  (buffer cap=" + world.pairA.length + ")");

// --- physics sanity: exact submerged fraction ---
const eps = 1e-9;
const f0 = eng.submergedFrac(0, 10);
const fFull = eng.submergedFrac(50, 10);
const fNone = eng.submergedFrac(-50, 10);
const fQuarterish = eng.submergedFrac(-10 * Math.sin(Math.PI / 6), 10); // q=-0.5
const ok = Math.abs(f0 - 0.5) < eps && fFull === 1 && fNone === 0 && fQuarterish > 0 && fQuarterish < 0.5;
console.log("submergedFrac: f(0)=" + f0 + " f(full)=" + fFull + " f(none)=" + fNone + " f(q=-.5)=" + fQuarterish.toFixed(4) + "  ok=" + ok);

// --- stir stress: no NaN after violent splash ---
eng.splash(world);
for (let f = 0; f < 300; f++) eng.stepWorld(world, 1 / 60);
console.log("after splash: NaN=" + scanNaN(world) + "  max|v|=" + settleStats(world).maxV.toFixed(0));

// --- archimedes equilibrium: a free bead settles at submerged frac = rho ---
// one bead per world, dropped into still water, 20 s to settle
function singleBead(dens) {
	const w = eng.createWorld(W, H);
	w.n = 1; w.rMax = 20;
	w.x[0] = W / 2; w.y[0] = H * 0.3; w.px[0] = w.x[0]; w.py[0] = w.y[0];
	w.vx[0] = 0; w.vy[0] = 0;
	w.r[0] = 20; w.dens[0] = dens; w.invM[0] = 1 / (dens * 400);
	for (let f = 0; f < 1200; f++) eng.stepWorld(w, 1 / 60);
	return w;
}
const wLight = singleBead(0.5);
const wHeavy = singleBead(2.0);
console.log("equilibrium: dens=0.5 -> frac=" + wLight.frac[0].toFixed(3) + " (want ~0.500)"
	+ "   dens=2.0 -> frac=" + wHeavy.frac[0].toFixed(3) + " (want 1.000, on floor)");
