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

function signedValue(value) {
	return (value > 0 ? "+" : "") + value.toFixed(2);
}

function percentValue(percent) {
	return Math.round(percent) + "%";
}

/* every control is a pure function of the world, so one pass can sync the panel after
   a paste, a preset or a reset */
const CONTROL_VIEWS = [
	{ id: "coldZoneEnd", out: "coldZoneValue", read: world => world.coldZoneEnd * 100, text: percentValue },
	{ id: "hotZoneStart", out: "hotZoneValue", read: world => world.hotZoneStart * 100, text: percentValue },
	{ id: "coldPower", out: "coldPowerValue", read: world => world.coldPower, text: value => value.toFixed(2) + "×" },
	{ id: "hotPower", out: "hotPowerValue", read: world => world.hotPower, text: value => value.toFixed(2) + "×" },
	{ id: "thermalLift", out: "liftValue", read: world => world.thermalLift, text: value => value.toFixed(2) },
	{ id: "bondStrength", out: "bondStrengthValue", read: world => world.linkStrength, text: value => value.toFixed(2) },
	{ id: "bondTempExp", out: "bondTempValue", read: world => world.linkTempExp, text: value => value.toFixed(1) },
	{ id: "waterFrac", out: "waterValue", read: world => world.waterFrac * 100, text: percentValue },
	{ id: "conductionRate", out: "conductionValue", read: world => world.conductionRate, text: value => value.toFixed(2) + "×" },
	{ id: "sizeResponse", out: "sizeValue", read: world => world.sizeResponse, text: signedValue },
	{ id: "archSize", out: "archValue", read: world => world.archSize, text: signedValue },
	{ id: "buoyancy", out: "buoyancyValue", read: world => world.buoyancy, text: value => value.toFixed(2) + "×" },
	{ id: "fillFraction", out: "fillValue", read: world => world.fillFraction * 100, text: percentValue },
	{ id: "typicalRadius", out: "radiusValue", read: world => world.typicalRadius, text: value => value + " px" },
	{ id: "massScale", out: "massValue", read: world => world.massScale, text: value => value.toFixed(2) + "×" },
];

function syncPanel() {
	for (const view of CONTROL_VIEWS) {
		const value = view.read(world);
		$(view.id).value = value;
		$(view.out).textContent = view.text(value);
	}
	$("viewToggle").setAttribute("aria-pressed", world.temperatureView ? "true" : "false");
	$("viewToggle").textContent = "Temperature hue: " + (world.temperatureView ? "on" : "off");
	updateCountLabel();
}

function setEcho(text, tone) {
	const echo = $("settingsEcho");
	echo.textContent = text;
	echo.className = "echo" + (tone ? " " + tone : "");
}

function applyAndDeal(settings) {
	const ignored = applySettings(world, settings);
	spawnBed(world);
	assets = makeAssets(ctx, world);
	assets.sprites = sprites;
	assets.tempSprites = temperatureSprites;
	syncPanel();
	const note = ignored.length ? " · ignored " + ignored.join(",") : "";
	const line = JSON.stringify(readSettings(world));
	setEcho("applied " + line + note, ignored.length ? "bad" : "ok");
	console.log("settings " + line + note);
	return ignored;
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
	/* clipboard first, then the old execCommand path for file:// windows */
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
	const input = window.prompt("Paste a settings line", "");
	if (!input) return null;
	let parsed = null;
	try {
		parsed = JSON.parse(input);
	} catch (error) {
		setEcho("not JSON: " + (error && error.message ? error.message : error), "bad");
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		setEcho("settings must be a JSON object like {\"fill\":0.21,\"water\":0.3}", "bad");
		return null;
	}
	return applyAndDeal(parsed);
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
	if (profileDone) return;	// keep the finished profile on screen
	let totalTemp = 0;
	for (let i = 0; i < world.n; i++) totalTemp += world.temp[i];
	const avgTemp = world.n ? totalTemp / world.n : 0;
	statsEl.textContent = world.n + " BEADS · " + world.linkActiveN + " ACTIVE LINKS · MEAN T " + avgTemp.toFixed(2) + " · " + Math.round(fpsEMA) + " FPS";
}

fit();
applyAndDeal(SETTINGS);
setEcho("copy settings writes one JSON line · paste applies one", "");

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

$("coldZoneEnd").addEventListener("input", e => {
	setColdZoneEnd(world, Number(e.target.value) / 100);
	$("coldZoneValue").textContent = e.target.value + "%";
});

$("hotZoneStart").addEventListener("input", e => {
	setHotZoneStart(world, Number(e.target.value) / 100);
	$("hotZoneValue").textContent = e.target.value + "%";
});

$("coldPower").addEventListener("input", e => {
	setColdPower(world, Number(e.target.value));
	$("coldPowerValue").textContent = Number(e.target.value).toFixed(2) + "×";
});

$("hotPower").addEventListener("input", e => {
	setHotPower(world, Number(e.target.value));
	$("hotPowerValue").textContent = Number(e.target.value).toFixed(2) + "×";
});

$("thermalLift").addEventListener("input", e => {
	setThermalLift(world, Number(e.target.value));
	$("liftValue").textContent = Number(e.target.value).toFixed(2);
});

$("bondStrength").addEventListener("input", e => {
	setBondStrength(world, Number(e.target.value));
	$("bondStrengthValue").textContent = Number(e.target.value).toFixed(2);
});

$("bondTempExp").addEventListener("input", e => {
	setBondTempExp(world, Number(e.target.value));
	$("bondTempValue").textContent = Number(e.target.value).toFixed(1);
});

$("waterFrac").addEventListener("input", e => {
	setWaterFrac(world, Number(e.target.value) / 100);
	$("waterValue").textContent = e.target.value + "%";
	assets = makeAssets(ctx, world);	// the water gradients are geometry-bound
	assets.sprites = sprites;
	assets.tempSprites = temperatureSprites;
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

$("copySettings").addEventListener("click", copySettings);
$("pasteSettings").addEventListener("click", pasteSettings);
$("resetSettings").addEventListener("click", () => applyAndDeal(SETTINGS));
$("typicalRadius").addEventListener("change", redealFromControls);
$("redeal").addEventListener("click", redealFromControls);

$("viewToggle").addEventListener("click", () => {
	world.temperatureView = !world.temperatureView;
	syncPanel();
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
