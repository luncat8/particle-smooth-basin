"use strict";

const $ = id => document.getElementById(id);

const canvas = $("c");
const ctx = canvas.getContext("2d", { alpha: false });
const statsEl = $("stats");
const presetSelect = $("scenarioPreset");
let world = null;
let assets = null;
let dpr = 1;
let activePreset = "";		// the preset the scene came from, "" once a control moved
const sprites = buildSprites();
const temperatureSprites = buildTemperatureSprites();

/* Optional stage timer: open with ?profile=1. The recorder itself is
   js/profile.js, so the page and tests.html measure the same way. */
const PROFILE_FRAMES = 300;
const profileSearch = typeof location !== "undefined" ? location.search : (window.location ? window.location.search : "");
const profiler = !!profileSearch && profileSearch.indexOf("profile=1") !== -1 ? createProfiler(PROFILE_FRAMES) : null;
let profileDone = false;

function reportProfile() {
	profileDone = true;
	const text = profiler.line();
	statsEl.textContent = text;
	console.log(text);
	window.__profile = profiler.summary();	// one-off, for a headless driver
}

function percentValue(value) {
	return Math.round(value) + "%";
}

function timesValue(digits) {
	return value => value.toFixed(digits) + "×";
}

function signedValue(value) {
	return (value > 0 ? "+" : "") + value.toFixed(2);
}

/* Every knob is one row: the world key, the slider id, the readout id and how the value
   reads. The slider's own range and granularity come from the engine's RANGES table, so
   the page cannot disagree with the world about what a control can be. */
const CONTROLS = [
	{ key: "coldEnd", id: "coldZoneEnd", out: "coldZoneValue", text: percentValue },
	{ key: "hotStart", id: "hotZoneStart", out: "hotZoneValue", text: percentValue },
	{ key: "coldPower", id: "coldPower", out: "coldPowerValue", text: timesValue(2) },
	{ key: "hotPower", id: "hotPower", out: "hotPowerValue", text: timesValue(2) },
	{ key: "conduction", id: "conductionRate", out: "conductionValue", text: timesValue(2) },
	{ key: "lift", id: "thermalLift", out: "liftValue", text: value => value.toFixed(2) },
	{ key: "arch", id: "archSize", out: "archValue", text: signedValue },
	{ key: "buoyancy", id: "buoyancy", out: "buoyancyValue", text: timesValue(2) },
	{ key: "size", id: "sizeResponse", out: "sizeValue", text: signedValue },
	{ key: "bonds", id: "bondStrength", out: "bondStrengthValue", text: value => value.toFixed(2) },
	{ key: "bondTemp", id: "bondTempExp", out: "bondTempValue", text: value => value.toFixed(1) },
	{ key: "water", id: "waterFrac", out: "waterValue", text: percentValue },
	{ key: "fill", id: "fillFraction", out: "fillValue", text: percentValue },
	{ key: "radius", id: "typicalRadius", out: "radiusValue", text: value => value + " px" },
	{ key: "mass", id: "massScale", out: "massValue", text: timesValue(2) },
];

const VIEW_LABELS = { density: "density", temp: "temperature", heat: "heat map" };
const VIEW_CYCLE = ["density", "temp", "heat"];

const controlById = {};
for (const control of CONTROLS) controlById[control.key] = control;

/* percentage sliders show 0..100 while the world keeps 0..1 */
function controlToWorld(control, sliderValue) {
	return RANGES[control.key].percent ? sliderValue / 100 : sliderValue;
}

function worldToControl(control) {
	const range = RANGES[control.key];
	return world[range.field] * (range.percent ? 100 : 1);
}

function markPresetCustom() {
	activePreset = "";
	presetSelect.value = "custom";
}

/* one pass drives the whole panel, so a preset, a paste and a reset cannot leave a
   stale readout behind */
function syncPanel() {
	for (const control of CONTROLS) {
		const value = worldToControl(control);
		$(control.id).value = value;
		$(control.out).textContent = control.text(value);
	}
	$("viewToggle").textContent = "View: " + VIEW_LABELS[world.view];
	$("viewToggle").setAttribute("aria-pressed", world.view === "temp" ? "true" : "false");
	presetSelect.value = activePreset || "custom";
	updateCountLabel();
}

/* the two band sliders follow a drag inside the canvas without re-syncing the panel */
function syncZoneControls() {
	for (let i = 0; i < 2; i++) {
		const control = CONTROLS[i];
		const value = worldToControl(control);
		$(control.id).value = value;
		$(control.out).textContent = control.text(value);
	}
}

function setEcho(text, tone) {
	const echo = $("settingsEcho");
	echo.textContent = text;
	echo.className = "echo" + (tone ? " " + tone : "");
}

function refreshAssets() {
	assets = makeAssets(ctx, world);	// gradients and paths are geometry-bound
	assets.sprites = sprites;
	assets.tempSprites = temperatureSprites;
}

function reportApplied(ignored) {
	const note = ignored.length ? " · ignored " + ignored.join(",") : "";
	const line = JSON.stringify(readSettings(world));
	setEcho("applied " + line + note, ignored.length ? "bad" : "ok");
	console.log("settings " + line + note);
}

function applyAndDeal(settings, presetId) {
	const ignored = applySettings(world, settings);
	activePreset = presetId || "";
	spawnBed(world);
	refreshAssets();
	syncPanel();
	reportApplied(ignored);
	return ignored;
}

/* a scene preset re-deals the bed; a coupling preset retunes size, arch and buoyancy
   on the live bed while leaving its fill, water and bands alone */
function applyPresetById(preset) {
	const ignored = applyPreset(world, preset);
	activePreset = preset.id;
	if (preset.kind === "scene") spawnBed(world);
	refreshAssets();
	syncPanel();
	reportApplied(ignored);
}

function copySettings() {
	const text = JSON.stringify(readSettings(world));
	const button = $("copySettings");
	const done = () => {
		button.textContent = "Copied ✓";
		setTimeout(() => { button.textContent = "Copy settings"; }, 1400);
		setEcho(text, "ok");
		console.log("settings " + text);
	};
	if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
		return text;
	}
	legacyCopy(text, done);
	return text;
}

function legacyCopy(text, done) {
	const area = document.createElement("textarea");
	area.value = text;
	document.body.appendChild(area);
	area.select();
	let copied = false;
	try { copied = document.execCommand("copy"); } catch (error) { copied = false; }
	document.body.removeChild(area);
	if (copied) done();
	else setEcho(text + "  (copy blocked — select the line above)", "bad");
}

function pasteSettings() {
	const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
	if (!clipboard || !clipboard.readText) {
		setEcho("clipboard read unavailable — allow clipboard access in this browser", "bad");
		return null;
	}
	const button = $("pasteSettings");
	button.textContent = "Reading clipboard…";
	let reading;
	try {
		reading = clipboard.readText();
	} catch (error) {
		button.textContent = "Paste settings";
		setEcho("clipboard read blocked — allow clipboard access and try again", "bad");
		return null;
	}
	return Promise.resolve(reading).then(text => {
		button.textContent = "Paste settings";
		if (!text.trim()) {
			setEcho("clipboard is empty", "bad");
			return;
		}
		let parsed = null;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			setEcho("not JSON: " + (error && error.message ? error.message : error), "bad");
			return;
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			setEcho("settings must be a JSON object like {\"fill\":0.4,\"water\":0.3}", "bad");
			return;
		}
		applyAndDeal(parsed);
	}, () => {
		button.textContent = "Paste settings";
		setEcho("clipboard read blocked — allow clipboard access and try again", "bad");
	});
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
	refreshAssets();
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
	if (profileDone) return;	// keep the finished profile on screen
	let totalTemp = 0;
	for (let i = 0; i < world.n; i++) totalTemp += world.temp[i];
	const avgTemp = world.n ? totalTemp / world.n : 0;
	statsEl.textContent = world.n + " BEADS · " + world.linkActiveN + " ACTIVE LINKS · MEAN T " + avgTemp.toFixed(2)
		+ " · " + VIEW_LABELS[world.view].toUpperCase() + " · " + Math.round(fpsEMA) + " FPS";
}

/* the select is built from the engine's PRESETS table: no label or id is copied here */
function buildPresetSelect() {
	presetSelect.textContent = "";
	const custom = document.createElement("option");
	custom.value = "custom";
	custom.textContent = "Custom sliders";
	presetSelect.appendChild(custom);
	let sceneGroup = document.createElement("optgroup");
	sceneGroup.label = "Scenes (re-deal the bed)";
	let couplingGroup = document.createElement("optgroup");
	couplingGroup.label = "Couplings (live bed)";
	for (const preset of PRESETS) {
		const option = document.createElement("option");
		option.value = preset.id;
		option.textContent = preset.label;
		(preset.kind === "scene" ? sceneGroup : couplingGroup).appendChild(option);
	}
	presetSelect.appendChild(sceneGroup);
	presetSelect.appendChild(couplingGroup);
}

/* slider spans and steps live in the engine's RANGES, so markup carries ids only */
function configureControls() {
	for (const control of CONTROLS) {
		const range = RANGES[control.key];
		const input = $(control.id);
		input.min = range.ui[0];
		input.max = range.ui[1];
		input.step = range.percent ? range.step * 100 : range.step;
		input.addEventListener("input", () => {
			markPresetCustom();
			setSetting(world, control.key, controlToWorld(control, Number(input.value)));
			$(control.out).textContent = control.text(worldToControl(control));
			if (control.key === "water") refreshAssets();
			updateCountLabel();
		});
		input.addEventListener("change", () => {
			if (control.key === "fill" || control.key === "radius") spawnBed(world);
		});
	}
}

buildPresetSelect();
configureControls();
fit();
applyPresetById(PRESETS[0]);
setEcho("copy writes one JSON line · paste reads and applies clipboard", "");

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
	canvas.style.cursor = world.pointer.zone ? "ns-resize" : "grabbing";
});

canvas.addEventListener("pointermove", e => {
	setPointer(e);
	if (world.pointer.down) {
		if (world.pointer.zone) syncZoneControls();
		return;
	}
	/* the same 16 px the engine uses when deciding bead-or-band on pointer down,
	   so the cursor always predicts what a click will grab */
	if (pickBead(world, world.pointer.x, world.pointer.y, 16) >= 0) canvas.style.cursor = "grab";
	else canvas.style.cursor = pickZone(world, world.pointer.x, world.pointer.y) ? "ns-resize" : "default";
});

function endPointer(now) {
	pointerUp(world, now);
	canvas.style.cursor = "default";
	syncPanel();
}
canvas.addEventListener("pointerup", () => endPointer(performance.now()));
canvas.addEventListener("pointercancel", () => endPointer(Infinity));
canvas.addEventListener("pointerleave", () => { if (!world.pointer.down) canvas.style.cursor = "default"; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

presetSelect.addEventListener("change", e => {
	const preset = PRESET_BY_ID[e.target.value];
	if (preset) applyPresetById(preset);
});

$("copySettings").addEventListener("click", copySettings);
$("pasteSettings").addEventListener("click", pasteSettings);
$("resetSettings").addEventListener("click", () => applyPresetById(PRESETS[0]));
$("redeal").addEventListener("click", () => spawnBed(world));

$("viewToggle").addEventListener("click", () => {
	markPresetCustom();
	setView(world, VIEW_CYCLE[(VIEW_CYCLE.indexOf(world.view) + 1) % VIEW_CYCLE.length]);
	syncPanel();
});

window.addEventListener("keydown", e => {
	if (e.key === "r" || e.key === "R") spawnBed(world);
	if (e.code === "Space") {
		e.preventDefault();
		splash(world);
	}
	if (e.key >= "1" && e.key <= "3") {
		markPresetCustom();
		setView(world, VIEW_CYCLE[Number(e.key) - 1]);
		syncPanel();
	}
});

let fpsEMA = 60, statTick = 0;
let last = performance.now();

function frame(now) {
	requestAnimationFrame(frame);
	const dt = Math.min(0.05, (now - last) / 1000);
	last = now;

	if (!profiler) {
		stepWorld(world, dt);
		render(ctx, world, assets);
	} else {
		const t0 = performance.now();
		stepWorld(world, dt);
		const t1 = performance.now();
		render(ctx, world, assets);
		const t2 = performance.now();
		if (profiler.record(t2 - t0, t1 - t0, t2 - t1)) reportProfile();
	}

	fpsEMA = fpsEMA * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
	if (++statTick >= 30) {
		statTick = 0;
		updateStats();
	}
}
requestAnimationFrame(frame);
