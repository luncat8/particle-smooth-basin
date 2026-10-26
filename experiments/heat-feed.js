"use strict";

/* Two-way heat: how far may beads write into the map before the tank drifts?
   The bands are the reservoirs and beads add transport on top of them, so the two
   failure modes are a runaway freeze (cold crust chills the water, which chills the
   crust) and a runaway thaw. This sweep runs the shipped scenes at several feed
   values and reports the drift next to the field statistics and the frame cost.
   The band profile the field is compared against is the solver's own `heat.band`,
   so the deviation column is what a bead wrote, not a re-derived guess.
   run: node experiments/heat-feed.js [seconds] [feed,feed,...] [seed] */

const eng = require("../js/engine.js");

const SEED = Number(process.argv[4]) || 0x9e3779b9;
let rng = SEED;
Math.random = () => {
	rng ^= rng << 13;
	rng ^= rng >>> 17;
	rng ^= rng << 5;
	return (rng >>> 0) / 4294967296;
};

const W = 1280, H = 800;
const SECONDS = Number(process.argv[2]) || 15;
const FRAMES = SECONDS * 60;
const MARKS = [Math.round(FRAMES / 4), Math.round(FRAMES / 2), FRAMES];
/* No argument: the guard the harness runs -- every scene next to the bands alone, then
   at the feed its preset ships. `scene` in a feed list means the preset's own value;
   numbers probe the transition by hand: the shipped scene loses its crust around 0.6. */
const FEEDS = process.argv[3]
	? process.argv[3].split(",").map(value => value === "scene" ? "scene" : Number(value))
	: [0, "scene"];
const feedOf = (scene, entry) => entry === "scene" ? eng.PRESET_BY_ID[scene].settings.feed : entry;
const SCENES = eng.PRESETS.filter(preset => preset.kind === "scene").map(preset => preset.id);
const HOT = 0.6, COLD = 0.483;

/* the page's own path: shipped settings, preset overrides, then the feed, then the deal */
function build(scene, feed) {
	rng = SEED;
	const world = eng.createWorld(W, H);
	eng.applySettings(world, eng.SETTINGS);
	eng.applySettings(world, eng.PRESET_BY_ID[scene].settings);
	if (feed !== null) eng.setHeatFeed(world, feed);
	eng.spawnBed(world);
	return world;
}

/* the write is what the beads added to the band target; the field is the relaxed
   version of it, so `dev` is measured on the target and the range on the field */
function fieldStats(world) {
	const h = world.heat, field = h.field, band = h.band, target = h.target;
	let devSum = 0, clamped = 0, written = 0, min = 1, max = 0;
	for (let i = 0; i < field.length; i++) {
		const dev = target[i] - band[i];
		devSum += Math.abs(dev);
		if (dev > 0.1 || dev < -0.1) written++;
		const f = field[i];
		if (f <= 0.001 || f >= 0.999) clamped++;
		if (f < min) min = f;
		if (f > max) max = f;
	}
	const cells = field.length;
	return { min, max, dev: devSum / cells, written: written / cells, clamped: clamped / cells };
}

function sample(world) {
	let cold = 0, hot = 0, sumT = 0, nan = 0, maxV = 0, links = 0;
	const ys = Array.prototype.slice.call(world.y, 0, world.n).sort((a, b) => a - b);
	const top = world.n ? ys[Math.floor(world.n * 0.02)] : world.tank.y0;
	const span = Math.max(1, world.tank.y1 - top);
	let topSum = 0, topN = 0, bottomSum = 0, bottomN = 0;
	for (let i = 0; i < world.n; i++) {
		const t = world.temp[i];
		if (!isFinite(t) || !isFinite(world.x[i]) || !isFinite(world.y[i])) nan++;
		sumT += t;
		if (t < COLD) cold++;
		if (t > HOT) hot++;
		if (world.y[i] < top + span * 0.25) { topSum += t; topN++; }
		if (world.y[i] > top + span * 0.75) { bottomSum += t; bottomN++; }
		maxV = Math.max(maxV, Math.hypot(world.vx[i], world.vy[i]));
	}
	for (let k = 0; k < world.linkN; k++) if (world.linkK[k] >= 0.02) links++;
	return {
		n: world.n, cold, hot, links, nan, maxV,
		meanT: world.n ? sumT / world.n : 0,
		topT: topN ? topSum / topN : 0,
		bottomT: bottomN ? bottomSum / bottomN : 0,
	};
}

function run(scene, feed) {
	const world = build(scene, feed);
	const midY = new Float64Array(world.n), wasUp = new Uint8Array(world.n);
	const startTop = Math.min.apply(null, Array.prototype.slice.call(world.y, 0, world.n));
	const mid = (startTop + world.tank.y1) / 2;
	for (let i = 0; i < world.n; i++) midY[i] = mid;
	let hotRise = 0, coldSink = 0;
	const marks = [];
	const started = process.hrtime.bigint();
	for (let f = 1; f <= FRAMES; f++) {
		eng.stepWorld(world, 1 / 60);
		if (world.n !== midY.length) break;
		for (let i = 0; i < world.n; i++) {
			const up = world.y[i] < midY[i] ? 1 : 0;
			if (up === wasUp[i]) continue;
			wasUp[i] = up;
			if (up && world.temp[i] > HOT) hotRise++;
			if (!up && world.temp[i] < 0.35) coldSink++;
		}
		if (MARKS.indexOf(f) >= 0) {
			const state = sample(world);
			state.at = Math.round(f / 60) + "s";
			marks.push(state);
		}
	}
	const msPerFrame = Number(process.hrtime.bigint() - started) / 1e6 / FRAMES;
	/* a splash must not push the field out of range or leave a NaN behind */
	eng.splash(world);
	for (let f = 0; f < 120; f++) eng.stepWorld(world, 1 / 60);
	const stats = fieldStats(world);
	let fieldOk = isFinite(stats.min) && isFinite(stats.max) && stats.min >= 0 && stats.max <= 1;
	for (let i = 0; i < world.heat.field.length; i++) if (!isFinite(world.heat.field[i])) fieldOk = false;
	return {
		marks, msPerFrame, stats, fieldOk,
		end: sample(world),
		hotRise: hotRise / SECONDS, coldSink: coldSink / SECONDS,
	};
}

function pad(text, width) { return String(text).padEnd(width); }
function num(value, digits) { return Number(value).toFixed(digits); }

console.log("heat feed sweep · " + W + "x" + H + " · " + SECONDS + " s · seed 0x" + SEED.toString(16) + " · shipped settings");

const results = [];
console.log(pad("scene", 12) + pad("feed", 6) + pad("meanT 5/10/end", 18) + pad("cold", 6) + pad("links", 7)
	+ pad("top/bottom", 13) + pad("up/down", 10) + pad("|f-band|", 10) + pad("written", 9) + pad("clamped", 9)
	+ pad("f min/max", 13) + "ms/frame");
for (const scene of SCENES) {
	for (const entry of FEEDS) {
		const feed = feedOf(scene, entry);
		const result = run(scene, feed);
		results.push({ scene, entry, feed, result });
		const last = result.marks[result.marks.length - 1];
		console.log(pad(scene, 12)
			+ pad((entry === "scene" ? "own " : "") + feed.toFixed(2), 8)
			+ pad(result.marks.map(mark => num(mark.meanT, 2)).join("/"), 18)
			+ pad(last.cold, 6)
			+ pad(last.links, 7)
			+ pad(num(last.topT, 2) + "/" + num(last.bottomT, 2), 13)
			+ pad(num(result.hotRise, 1) + "/" + num(result.coldSink, 1), 10)
			+ pad(num(result.stats.dev, 3), 10)
			+ pad(num(result.stats.written * 100, 0) + "%", 9)
			+ pad(num(result.stats.clamped * 100, 0) + "%", 9)
			+ pad(num(result.stats.min, 2) + "/" + num(result.stats.max, 2), 13)
			+ num(result.msPerFrame, 2));
	}
}
console.log("meanT = mean bead temperature at 5/10/end s · cold = beads below 0.483 · links = effective bonds"
	+ " · up/down = hot beads carried above the bed mid-line and cold ones below it, per second"
	+ " · |f-band| = mean cell distance from the band target · written = cells carried > 0.1 away"
	+ " · clamped = cells sitting on 0 or 1 · f min/max = the field's range");

/* ---------------------------- checks ---------------------------- */

let failures = 0;
function assert(ok, message) {
	if (ok) return;
	failures++;
	console.error("FAILED " + message);
	process.exitCode = 1;
}

const own = results.some(row => row.entry === "scene");
let driftMax = 0, crustWorst = Infinity, costMax = 0;
for (const scene of SCENES) {
	const off = results.find(row => row.scene === scene && row.entry === 0).result;
	const on = results.find(row => row.scene === scene && (own ? row.entry === "scene" : row.entry === FEEDS[0])).result;
	const drift = Math.abs(on.marks[on.marks.length - 1].meanT - off.marks[off.marks.length - 1].meanT);
	const coldOff = off.marks[off.marks.length - 1].cold, coldOn = on.marks[on.marks.length - 1].cold;
	const cost = on.msPerFrame - off.msPerFrame;
	driftMax = Math.max(driftMax, drift);
	crustWorst = Math.min(crustWorst, coldOn / Math.max(1, coldOff));
	costMax = Math.max(costMax, cost);
	assert(drift <= 0.08, scene + " drifts the mean tank temperature by " + drift.toFixed(3) + " (limit 0.08)");
	assert(coldOn >= coldOff * 0.5, scene + " keeps only " + coldOn + " of " + coldOff + " cold beads");
	assert(on.fieldOk, scene + " field stays inside 0..1 and finite through a splash");
	assert(cost < 0.5, scene + " pays " + cost.toFixed(2) + " ms/frame for the live field");
}

/* feed 0 must be the 0.4.3 field, not merely a similar one */
rng = SEED;
const quiet = build("thermal", 0);
eng.solveHeatMap(quiet);
const stepped = build("thermal", 0);
for (let f = 0; f < 60; f++) eng.stepWorld(stepped, 1 / 60);
let delta = 0;
for (let i = 0; i < quiet.heat.field.length; i++) delta = Math.max(delta, Math.abs(quiet.heat.field[i] - stepped.heat.field[i]));
assert(delta === 0, "feed 0 left a bead-written field behind: " + delta.toFixed(4));
assert(results.find(row => row.entry === 0).result.stats.dev === 0, "feed 0 reports a deviation");

console.log("heat feed checks: " + SCENES.length + " scenes · worst drift " + driftMax.toFixed(3)
	+ " · crust keeps " + num(crustWorst * 100, 0) + "% of its cold beads · worst cost +" + costMax.toFixed(2)
	+ " ms/frame · feed 0 is the bands-only field · " + (failures ? failures + " FAILED" : "passed"));

