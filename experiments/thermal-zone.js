"use strict";

/* Sweep the thermal zone geometry at default rates: how many cold bonds does the
   settled bed carry, and do they survive a stir? The zone bands are the two numbers
   the page also draws (world.coldZoneEnd / world.hotZoneStart), so a candidate that
   wins here is exactly what a viewer sees. After the geometry table it sweeps the
   source rate at the chosen band, which is what the slider does.
   run: node experiments/thermal-zone.js [frames] */

const eng = require("../js/engine.js");

// Same seeded bed as bench.js, so candidates are comparable run to run.
let rng = 0x9e3779b9;
Math.random = () => {
	rng ^= rng << 13;
	rng ^= rng >>> 17;
	rng ^= rng << 5;
	return (rng >>> 0) / 4294967296;
};

const W = 1280, H = 800;
const FRAMES = Number(process.argv[2]) || 480;	// 8 s of sim at 1/60: the bed is bonded by then
/* the shipped band comes from the engine, so this table cannot drift from the page */
const SHIPPED = { coldEnd: eng.COLD_ZONE_END, hotStart: eng.HOT_ZONE_START };
const CANDIDATES = [
	{ name: "old 0.24", coldEnd: 0.24, hotStart: 0.76 },
	{ name: "cold 0.36", coldEnd: 0.36, hotStart: 0.76 },
	{ name: "shipped", coldEnd: SHIPPED.coldEnd, hotStart: SHIPPED.hotStart },
	{ name: "cold 0.44", coldEnd: 0.44, hotStart: 0.76 },
	{ name: "cold 0.48", coldEnd: 0.48, hotStart: 0.76 },
	{ name: "cold 0.44 hot 0.70", coldEnd: 0.44, hotStart: 0.70 },
	{ name: "cold 0.40 hot 0.70", coldEnd: 0.40, hotStart: 0.70 },
	{ name: "cold 0.44 hot 0.82", coldEnd: 0.44, hotStart: 0.82 },
];
const CHOSEN = { name: "shipped", coldEnd: SHIPPED.coldEnd, hotStart: SHIPPED.hotStart };
const SOURCE_RATES = [0, 0.5, 1, 2, 4];
const BOND_HEAT = 0.483;		// above this mean pair temperature a bond is too soft to solve
const COLD_TEMP = 0.30;

function makeWorld(candidate) {
	const world = eng.createWorld(W, H);
	world.coldZoneEnd = candidate.coldEnd;
	world.hotZoneStart = candidate.hotStart;
	return world;
}

function sample(world) {
	let links = 0, cold = 0, coldBonds = 0, minT = 1, maxT = 0, sumT = 0, maxV = 0, nan = 0;
	const topBand = world.tank.y0 + (world.tank.y1 - world.tank.y0) * 0.25;
	const bottomBand = world.tank.y1 - (world.tank.y1 - world.tank.y0) * 0.25;
	let topSum = 0, topN = 0, bottomSum = 0, bottomN = 0;
	for (let i = 0; i < world.n; i++) {
		const t = world.temp[i];
		if (!isFinite(t) || !isFinite(world.x[i]) || !isFinite(world.y[i])) nan++;
		minT = Math.min(minT, t); maxT = Math.max(maxT, t); sumT += t;
		if (t < BOND_HEAT) cold++;
		if (world.y[i] < topBand) { topSum += t; topN++; }
		if (world.y[i] > bottomBand) { bottomSum += t; bottomN++; }
		maxV = Math.max(maxV, Math.hypot(world.vx[i], world.vy[i]));
	}
	for (let k = 0; k < world.linkN; k++) {
		const a = world.linkA[k], b = world.linkB[k];
		if (world.linkK[k] >= 0.02) links++;
		if ((world.temp[a] + world.temp[b]) * 0.5 < COLD_TEMP) coldBonds++;
	}
	return {
		n: world.n, links, coldBonds, cold, nan,
		minT, maxT, meanT: sumT / world.n, maxV,
		topT: topN ? topSum / topN : 0,
		bottomT: bottomN ? bottomSum / bottomN : 0,
	};
}

function run(candidate, sourceRate) {
	const world = makeWorld(candidate);
	if (sourceRate !== undefined) eng.setSourceRate(world, sourceRate);
	let linkSum = 0, linkMax = 0, samples = 0, churn = 0, previous = 0;
	const started = process.hrtime.bigint();
	for (let f = 1; f <= FRAMES; f++) {
		eng.stepWorld(world, 1 / 60);
		if (f % 30 !== 0) continue;
		const state = sample(world);
		linkSum += state.links; samples++;
		linkMax = Math.max(linkMax, state.links);
		if (previous) churn += Math.abs(state.links - previous);
		previous = state.links;
	}
	const msPerFrame = Number(process.hrtime.bigint() - started) / 1e6 / FRAMES;
	const settled = sample(world);
	/* a stir must visibly thaw: bonds break, then re-form as the cold top cools the
	   reshuffled surface again */
	eng.splash(world);
	for (let f = 0; f < 30; f++) eng.stepWorld(world, 1 / 60);
	const afterStir = sample(world);
	for (let f = 0; f < 300; f++) eng.stepWorld(world, 1 / 60);
	const recovered = sample(world);
	return {
		settled, afterStir, recovered, msPerFrame,
		meanLinks: linkSum / samples, linkMax,
		churn: churn / Math.max(1, samples - 1),
	};
}

function pad(text, width) { return String(text).padEnd(width); }

function printRow(label, candidate, rate, result) {
	const s = result.settled;
	console.log(pad(label, 20)
		+ pad(num(result.meanLinks, 0) + "/" + num(result.linkMax, 0), 15)
		+ pad(s.cold, 7)
		+ pad(s.coldBonds, 11)
		+ pad(num(result.churn, 1), 7)
		+ pad(num(s.minT, 2) + "/" + num(s.meanT, 2) + "/" + num(s.maxT, 2), 18)
		+ pad(num(s.topT, 2) + "/" + num(s.bottomT, 2), 13)
		+ pad(result.afterStir.links, 7)
		+ pad(result.recovered.links, 9)
		+ pad(num(s.maxV, 0), 6)
		+ num(result.msPerFrame, 2)
		+ (rate !== undefined ? "  rate " + rate + "x" : "")
		+ (s.nan ? "  NaN=" + s.nan : ""));
}
function num(value, digits) { return value.toFixed(digits); }

console.log("thermal zone sweep · " + W + "x" + H + " · " + FRAMES + " frames · source 1x · conduction 1x · seeded");
console.log(pad("candidate", 20) + pad("links avg/max", 15) + pad("cold", 7) + pad("coldBonds", 11)
	+ pad("churn", 7) + pad("Tmin/mean/max", 18) + pad("top/bottom", 13)
	+ pad("stir", 7) + pad("recover", 9) + pad("maxV", 6) + "ms/frame");
for (const candidate of CANDIDATES) printRow(candidate.name, candidate, undefined, run(candidate));
console.log("cold = beads able to bond (T<" + BOND_HEAT + ") · coldBonds = links whose pair mean T<" + COLD_TEMP
	+ " · churn = mean |Δlinks| per 30-frame sample · stir = links 0.5 s after a splash");

console.log("\nsource rate at the shipped cold " + CHOSEN.coldEnd + " / hot " + CHOSEN.hotStart + " (the slider's range)");
console.log(pad("candidate", 20) + pad("links avg/max", 15) + pad("cold", 7) + pad("coldBonds", 11)
	+ pad("churn", 7) + pad("Tmin/mean/max", 18) + pad("top/bottom", 13)
	+ pad("stir", 7) + pad("recover", 9) + pad("maxV", 6) + "ms/frame");
for (const rate of SOURCE_RATES) printRow("rate " + rate + "x", CHOSEN, rate, run(CHOSEN, rate));
console.log("rate 0x must leave the bed neutral (no bonds): the source is the only way a bead leaves T=0.5");
