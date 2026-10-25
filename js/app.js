"use strict";

const $ = id => document.getElementById(id);

const canvas = $("c");
const ctx = canvas.getContext("2d", { alpha: false });
const statsEl = $("stats");
let world = null;
let assets = null;
let dpr = 1;
const sprites = buildSprites();
const temperatureSprites = buildTemperatureSprites();
const SCENARIO_PRESETS = {
	shrinkFlow: [-1, 0],
	bigFloats: [0, 4],
	shrinkConvection: [-1, -4],
	growConvection: [1, 4],
	shrinkStable: [-1, 4],
	growStable: [1, -4],
};

function signedValue(value) {
	return (value > 0 ? "+" : "") + value.toFixed(2);
}

function syncSizeControl(value) {
	$("sizeResponse").value = value;
	setSizeResponse(world, value);
	$("sizeValue").textContent = signedValue(value);
}

function syncArchControl(value) {
	$("archSize").value = value;
	setArchSize(world, value);
	$("archValue").textContent = signedValue(value);
}

function fit() {
	const W = window.innerWidth, H = window.innerHeight;
	dpr = Math.min(window.devicePixelRatio || 1, 2);
	canvas.width = Math.round(W * dpr);
	canvas.height = Math.round(H * dpr);
	canvas.style.width = W + "px";
	canvas.style.height = H + "px";
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (!world) world = createWorld(W, H);
	else resizeWorld(world, W, H);
	assets = makeAssets(ctx, world);
	assets.sprites = sprites;
	assets.tempSprites = temperatureSprites;
	updateCountLabel();
}

function countForSettings(fillPercent, radius) {
	const area = world.W * world.H;
	const estimate = Math.max(1, Math.round((fillPercent / 100) * area / (Math.PI * 1.027 * radius * radius)));
	return estimate > SPAWN_CAP ? SPAWN_CAP + " max (cap)" : estimate;
}

function updateCountLabel() {
	const fill = Number($("fillFraction").value);
	const radius = Number($("typicalRadius").value);
	$("countValue").textContent = countForSettings(fill, radius) + " beads at typical size";
}

function updateStats() {
	let totalTemp = 0;
	for (let i = 0; i < world.n; i++) totalTemp += world.temp[i];
	const avgTemp = world.n ? totalTemp / world.n : 0;
	statsEl.textContent = world.n + " BEADS · " + world.linkActiveN + " ACTIVE LINKS · MEAN T " + avgTemp.toFixed(2) + " · " + Math.round(fpsEMA) + " FPS";
}

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

function endPointer(now) {
	pointerUp(world, now);
	canvas.style.cursor = "default";
}
canvas.addEventListener("pointerup", () => endPointer(performance.now()));
canvas.addEventListener("pointercancel", () => endPointer(Infinity));
canvas.addEventListener("pointerleave", () => { if (!world.pointer.down) canvas.style.cursor = "default"; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

$("sourceRate").addEventListener("input", e => {
	const value = Number(e.target.value);
	setSourceRate(world, value);
	$("sourceValue").textContent = value.toFixed(2) + "×";
});

$("conductionRate").addEventListener("input", e => {
	const value = Number(e.target.value);
	setConductionRate(world, value);
	$("conductionValue").textContent = value.toFixed(2) + "×";
});

$("sizeResponse").addEventListener("input", e => {
	syncSizeControl(Number(e.target.value));
	$("scenarioPreset").value = "custom";
});

$("archSize").addEventListener("input", e => {
	syncArchControl(Number(e.target.value));
	$("scenarioPreset").value = "custom";
});

$("buoyancy").addEventListener("input", e => {
	const value = Number(e.target.value);
	setBuoyancy(world, value);
	$("buoyancyValue").textContent = value.toFixed(2) + "×";
});

$("scenarioPreset").addEventListener("change", e => {
	const preset = SCENARIO_PRESETS[e.target.value];
	if (!preset) return;
	syncSizeControl(preset[0]);
	syncArchControl(preset[1]);
});

$("fillFraction").addEventListener("input", e => {
	$("fillValue").textContent = e.target.value + "%";
	updateCountLabel();
});

$("typicalRadius").addEventListener("input", e => {
	$("radiusValue").textContent = e.target.value + " px";
	updateCountLabel();
});

$("massScale").addEventListener("input", e => {
	const value = Number(e.target.value);
	setMassScale(world, value);
	$("massValue").textContent = value.toFixed(2) + "×";
});

function redealFromControls() {
	setFillFraction(world, Number($("fillFraction").value) / 100);
	setTypicalRadius(world, Number($("typicalRadius").value));
	setSizeResponse(world, Number($("sizeResponse").value));
	setMassScale(world, Number($("massScale").value));
	spawnBed(world);
}

$("fillFraction").addEventListener("change", redealFromControls);
$("typicalRadius").addEventListener("change", redealFromControls);
$("redeal").addEventListener("click", redealFromControls);

$("viewToggle").addEventListener("click", e => {
	world.temperatureView = !world.temperatureView;
	e.currentTarget.setAttribute("aria-pressed", world.temperatureView ? "true" : "false");
	e.currentTarget.textContent = "Temperature hue: " + (world.temperatureView ? "on" : "off");
});

window.addEventListener("keydown", e => {
	if (e.key === "r" || e.key === "R") redealFromControls();
	if (e.code === "Space") {
		e.preventDefault();
		splash(world);
	}
});

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
		updateStats();
	}
}
requestAnimationFrame(frame);
