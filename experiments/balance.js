"use strict";

/* Scene balance sweep: does the bed fit under the water, do bonds form at its top,
   and does heat actually circulate? Every candidate is a full settings object, the
   same keys the page's Copy settings button emits, so a table row can be pasted
   back into the app.
   run: node experiments/balance.js [seconds] [WxH] */

const eng = require("../js/engine.js");

const SIZE = (process.argv[3] || "1280x800").split("x");
const W = Number(SIZE[0]) || 1280, H = Number(SIZE[1]) || 800;
const SECONDS = Number(process.argv[2]) || 12;

let rng = 0x9e3779b9;
Math.random = () => {
	rng ^= rng << 13;
	rng ^= rng >>> 17;
	rng ^= rng << 5;
	return (rng >>> 0) / 4294967296;
};

/* every candidate starts from the shipped settings and overrides only what it probes */
const BASE = eng.SETTINGS;
function cand(id, overrides) { return Object.assign({ id }, BASE, overrides); }

const CANDIDATES = [cand("shipped", {})];

const FRAMES = SECONDS * 60;
const MARKS = [120, 240, 480, FRAMES];

/* build exactly the way the page does: applySettings + spawnBed. Re-deriving the
   world from a hand-picked subset once made this sweep disagree with the app. */
function build(settings) {
	const world = eng.createWorld(W, H);
	eng.applySettings(world, eng.SETTINGS);
	eng.applySettings(world, settings);
	eng.spawnBed(world);
	return world;
}

/* 2% quantile, not the single highest bead: one bead flung at the ceiling must not
   pass for the bed's surface. */
function bedTop(world) {
	if (!world.n) return world.tank.y1;
	const ys = Array.prototype.slice.call(world.y, 0, world.n).sort((a, b) => a - b);
	return ys[Math.floor(world.n * 0.02)];
}

function sample(world) {
	let links = 0, cold = 0, hot = 0, nan = 0, maxV = 0;
	let topSum = 0, topN = 0, bottomSum = 0, bottomN = 0;
	/* convection: heat flux upward. hot beads moving up and cold beads moving down
	   both count positive, so a still bed reads ~0 and a mixing bed reads > 0. */
	let flux = 0, hotUp = 0, hotN = 0, above = 0;
	const top = bedTop(world);
	const span = Math.max(1, world.tank.y1 - top);
	for (let i = 0; i < world.n; i++) {
		const t = world.temp[i], vy = world.vy[i];
		if (!isFinite(t) || !isFinite(world.x[i]) || !isFinite(world.y[i]) || !isFinite(vy)) nan++;
		if (t < 0.483) cold++;
		if (t > 0.6) { hot++; hotN++; if (vy < 0) hotUp++; }
		flux += (t - 0.5) * -vy;
		if (world.y[i] < world.waterY) above++;
		if (world.y[i] < top + span * 0.25) { topSum += t; topN++; }
		if (world.y[i] > top + span * 0.75) { bottomSum += t; bottomN++; }
		maxV = Math.max(maxV, Math.hypot(world.vx[i], world.vy[i]));
	}
	for (let k = 0; k < world.linkN; k++) if (world.linkK[k] >= 0.02) links++;
	return {
		links, cold, hot, nan, maxV, above,
		topT: topN ? topSum / topN : 0,
		bottomT: bottomN ? bottomSum / bottomN : 0,
		flux: flux / world.n,
		hotUpShare: hotN ? hotUp / hotN : 0,
	};
}

function run(settings) {
	const world = build(settings);
	const top = bedTop(world);
	const geometry = {
		bedTop: Math.round(top),
		waterY: Math.round(world.waterY),
		freeWater: Math.round(top - world.waterY),
		bottom: Math.round(world.tank.y1),
		n: world.n,
	};
	const marks = [];
	let previous = null;
	/* mixing: where did each bead start, and did it travel? a still bed keeps its
	   beads; convection moves them vertically and re-sorts them by temperature. */
	const startY = new Float64Array(world.n);
	const midY = new Float64Array(world.n), wasUp = new Uint8Array(world.n);
	const startMid = (top + world.tank.y1) / 2;
	for (let i = 0; i < world.n; i++) {
		startY[i] = world.y[i];
		midY[i] = startMid;
	}
	let fluxSum = 0, fluxFrames = 0, crossings = 0, hotUpSum = 0;
	let hotRise = 0, coldSink = 0;
	const wasAbove = new Uint8Array(world.n);
	const started = process.hrtime.bigint();
	for (let f = 1; f <= FRAMES; f++) {
		eng.stepWorld(world, 1 / 60);
		for (let i = 0; i < world.n; i++) {
			const above = world.y[i] < world.waterY ? 1 : 0;
			if (above !== wasAbove[i]) crossings++;
			wasAbove[i] = above;
		}
		for (let i = 0; i < world.n; i++) {
			const up = world.y[i] < midY[i] ? 1 : 0;
			if (up === wasUp[i]) continue;
			wasUp[i] = up;
			/* overturning, not churn: a hot bead carried above the mid-line, a cold
			   bead carried below it. Both are the signature of a convection cell. */
			if (up && world.temp[i] > 0.6) hotRise++;
			if (!up && world.temp[i] < 0.35) coldSink++;
		}
		if (f > FRAMES - 360) {
			let flux = 0, hotUp = 0, hotN = 0;
			for (let i = 0; i < world.n; i++) {
				flux += (world.temp[i] - 0.5) * -world.vy[i];
				if (world.temp[i] > 0.6) { hotN++; if (world.vy[i] < 0) hotUp++; }
			}
			fluxSum += flux / world.n;
			hotUpSum += hotN ? hotUp / hotN : 0;
			fluxFrames++;
		}
		if (MARKS.indexOf(f) < 0) continue;
		const state = sample(world);
		state.at = Math.round(f / 60) + "s";
		state.free = Math.round(bedTop(world) - world.waterY);	// water surface above the bed
		state.moved = previous ? Math.abs(state.links - previous) : 0;
		previous = state.links;
		marks.push(state);
	}
	let travelled = 0, travel = 0;
	for (let i = 0; i < world.n; i++) {
		const dy = Math.abs(world.y[i] - startY[i]);
		travel += dy;
		if (dy > 20) travelled++;
	}
	const msPerFrame = Number(process.hrtime.bigint() - started) / 1e6 / FRAMES;
	/* the splash test: does the crust tear and re-form */
	eng.splash(world);
	for (let f = 0; f < 30; f++) eng.stepWorld(world, 1 / 60);
	const afterStir = sample(world);
	for (let f = 0; f < 300; f++) eng.stepWorld(world, 1 / 60);
	const recovered = sample(world);
	return {
		settings, geometry, marks, msPerFrame, afterStir, recovered,
		freeEnd: Math.round(bedTop(world) - world.waterY),
		fluxMean: fluxSum / Math.max(1, fluxFrames),
		hotUpMean: hotUpSum / Math.max(1, fluxFrames),
		crossings: crossings / SECONDS,
		hotRise: hotRise / SECONDS, coldSink: coldSink / SECONDS,
		travel: travel / world.n, travelled: travelled / world.n,
	};
}

function pad(text, width) { return String(text).padEnd(width); }
function fix(value, digits) { return Number(value).toFixed(digits); }

console.log("balance sweep · " + W + "x" + H + " · " + SECONDS + " s · seeded");
console.log(pad("candidate", 12) + pad("n", 6) + pad("bedTop", 8) + pad("water", 7) + pad("free 2/4/8/end", 14) + pad("above", 9)
	+ pad("coldEnd", 9) + pad("links 2/4/8/end", 19) + pad("cold", 6) + pad("top/bottom T", 14)
	+ pad("flux", 8) + pad("hotUp", 7) + pad("moved", 7) + pad("stir/rec", 10) + pad("maxV", 6) + pad("up/down", 10) + "ms/frame");
for (const candidate of CANDIDATES) {
	const result = run(candidate);
	const marks = result.marks;
	const links = marks.map(mark => mark.links).join("/");
	const last = marks[marks.length - 1];
	const end = result.recovered;
	console.log(pad(candidate.id, 12)
		+ pad(result.geometry.n, 6)
		+ pad(result.geometry.bedTop, 8)
		+ pad(result.geometry.waterY, 7)
		+ pad(result.marks.map(mark => mark.free).join("/"), 13)
		+ pad(result.marks[result.marks.length - 1].above + "/" + result.geometry.n, 9)
		+ pad(Math.round(candidate.coldEnd * H) + "px", 9)
		+ pad(links, 19)
		+ pad(last.cold, 6)
		+ pad(fix(last.topT, 2) + "/" + fix(last.bottomT, 2), 14)
		+ pad(fix(result.fluxMean, 1), 8)
		+ pad(fix(result.hotUpMean * 100, 0) + "%", 7)
		+ pad(fix(result.travel, 0) + "px/" + fix(result.travelled * 100, 0) + "%", 9)
		+ pad(fix(result.crossings, 1), 7)
		+ pad(result.afterStir.links + "/" + end.links, 10)
		+ pad(fix(last.maxV, 0), 6)
		+ pad(fix(result.hotRise, 1) + "/" + fix(result.coldSink, 1), 9)
		+ fix(result.msPerFrame, 2)
		+ (last.nan ? "  NaN=" + last.nan : ""));
}
console.log("free = px of water above the bed at 2/4/8 s and end (negative: the bed sticks out) · links at 2/4/8 s and end"
	+ " · cold = beads below 0.483 of 1 · flux = last 4 s mean of (T-0.5)·(-vy) · hotUp = share of hot beads moving up"
	+ " · moved = mean |Δy| and share of beads that travelled > 20 px over the run"
	+ " · stir/rec = links 0.5 s after a splash / 5 s later"
	+ " · up/down = hot beads carried above the bed mid-line and cold ones below it, per second"
	+ " · above = beads whose centre is above the waterline at the end");
