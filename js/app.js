"use strict";

const $ = id => document.getElementById(id);

const canvas = $("c");
const ctx = canvas.getContext("2d", { alpha: false });

let world = null;
let assets = null;
let dpr = Math.min(window.devicePixelRatio || 1, 2);

function fit() {
	const W = window.innerWidth, H = window.innerHeight;
	canvas.width = Math.round(W * dpr);
	canvas.height = Math.round(H * dpr);
	canvas.style.width = W + "px";
	canvas.style.height = H + "px";
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (!world) world = createWorld(W, H);
	else resizeWorld(world, W, H);
	assets = makeAssets(ctx, world);
	assets.sprites = sprites;
}

const sprites = buildSprites();
fit();

let resizeTimer = 0;
window.addEventListener("resize", () => {
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(fit, 120);
});

function setPointer(e) {
	const r = canvas.getBoundingClientRect();
	pointerMove(world, e.clientX - r.left, e.clientY - r.top);
}

canvas.addEventListener("pointerdown", e => {
	e.preventDefault();
	setPointer(e);
	canvas.setPointerCapture(e.pointerId);
	pointerDown(world, world.pointer.x, world.pointer.y, performance.now());
	canvas.style.cursor = "grabbing";
});

canvas.addEventListener("pointermove", e => {
	setPointer(e);
	if (world.pointer.down) return;
	const hit = pickBead(world, world.pointer.x, world.pointer.y, 8);
	canvas.style.cursor = hit >= 0 ? "grab" : "default";
});

function endPointer(e) {
	pointerUp(world, performance.now());
	canvas.style.cursor = "default";
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("contextmenu", e => e.preventDefault());

window.addEventListener("keydown", e => {
	if (e.key === "r" || e.key === "R") spawnBed(world);
	if (e.code === "Space") {
		e.preventDefault();
		splash(world);
	}
});

const statsEl = $("stats");
let fpsEMA = 60, statTick = 0;
let last = performance.now();

function frame(now) {
	requestAnimationFrame(frame);
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;

	stepWorld(world, dt);
	render(ctx, world, assets);

	fpsEMA = fpsEMA * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
	if (++statTick >= 30) {
		statTick = 0;
		statsEl.textContent = world.n + " BEADS \u00B7 " + Math.round(fpsEMA) + " FPS";
	}
}
requestAnimationFrame(frame);
