"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const { createSandbox } = require("./fake-dom.js");
const { SETTINGS, SCENARIO_PRESETS } = require("../js/engine.js");

const ids = ["c", "stats", "hint", "conductionRate", "conductionValue", "sizeResponse", "sizeValue", "archSize", "archValue", "buoyancy", "buoyancyValue", "scenarioPreset", "fillFraction", "fillValue", "countValue", "typicalRadius", "radiusValue", "massScale", "massValue", "viewToggle", "redeal",
	"coldZoneEnd", "coldZoneValue", "hotZoneStart", "hotZoneValue", "coldPower", "coldPowerValue", "hotPower", "hotPowerValue",
	"thermalLift", "liftValue", "bondStrength", "bondStrengthValue", "bondTempExp", "bondTempValue",
	"waterFrac", "waterValue", "copySettings", "pasteSettings", "resetSettings", "settingsEcho"];
/* the markup's own values: the page must re-sync them from the engine on boot */
const values = {
	conductionRate: "1", sizeResponse: "0", archSize: "0", buoyancy: "1",
	scenarioPreset: "custom", fillFraction: "50", typicalRadius: "14", massScale: "1",
	coldZoneEnd: "40", hotZoneStart: "76", coldPower: "1", hotPower: "1",
	thermalLift: "0", bondStrength: "0.72", bondTempExp: "2", waterFrac: "50",
};

function makeSandbox(search, now) {
	return createSandbox({ ids, values, search, now });
}

/* Clipboard stand-in: Paste reads its contents directly, without a prompt. */
const clipboard = { text: null };
function settingsSandbox(search, now) {
	return createSandbox({
		ids, values, search, now,
		extraGlobals: {
			navigator: { clipboard: {
				writeText: text => { clipboard.text = text; return Promise.resolve(); },
				readText: () => Promise.resolve(clipboard.text || ""),
			} },
		},
	});
}

(async function main() {
	const { sandbox, elements } = settingsSandbox("", () => 0);
	const bundle = ["js/engine.js", "js/render.js", "js/profile.js", "js/app.js"].map(path => fs.readFileSync(path, "utf8")).join("\n");
	vm.runInNewContext(bundle, sandbox, { filename: "browser-bundle.js" });
	for (let i = 1; i <= 31; i++) {
		const frame = sandbox.nextFrame;
		frame(i * 16.67);
	}
	/* the page starts from the engine's shipped scene, not from whatever the markup held */
	assert.equal(Number(elements.fillFraction.value), SETTINGS.fill * 100, "boot syncs coverage from the shipped settings");
	assert.equal(Number(elements.coldZoneEnd.value), SETTINGS.coldEnd * 100, "boot syncs the cold band");
	assert.equal(Number(elements.hotZoneStart.value), SETTINGS.hotStart * 100, "boot syncs the hot band");
	assert.equal(Number(elements.coldPower.value), SETTINGS.coldPower, "boot syncs the cold power");
	assert.equal(Number(elements.hotPower.value), SETTINGS.hotPower, "boot syncs the hot power");
	assert.equal(Number(elements.thermalLift.value), SETTINGS.lift, "boot syncs the thermal lift");
	assert.equal(Number(elements.bondStrength.value), SETTINGS.bonds, "boot syncs the bond strength");
	assert.equal(Number(elements.bondTempExp.value), SETTINGS.bondTemp, "boot syncs the bond exponent");
	assert.equal(Number(elements.waterFrac.value), SETTINGS.water * 100, "boot syncs the water level");
	assert.match(elements.settingsEcho.textContent, /paste reads and applies clipboard/);
	elements.conductionRate.listeners.input({ target: { value: "1.8" } });
	elements.coldPower.listeners.input({ target: { value: "1.5" } });
	elements.hotPower.listeners.input({ target: { value: "0.5" } });
	elements.coldZoneEnd.listeners.input({ target: { value: "55" } });
	elements.thermalLift.listeners.input({ target: { value: "0.5" } });
	elements.bondTempExp.listeners.input({ target: { value: "2.8" } });
	elements.waterFrac.listeners.input({ target: { value: "38" } });
	elements.buoyancy.listeners.input({ target: { value: "1.1" } });
	elements.archSize.listeners.input({ target: { value: "0.5" } });
	assert.equal(elements.archValue.textContent, "+0.50");
	assert.equal(elements.scenarioPreset.value, "custom");
	elements.sizeResponse.listeners.input({ target: { value: "1" } });
	elements.archSize.listeners.input({ target: { value: "-4" } });
	elements.viewToggle.listeners.click({ currentTarget: elements.viewToggle });
	elements.fillFraction.listeners.change();
	assert.match(elements.stats.textContent, /BEADS/);
	assert.match(elements.countValue.textContent, /beads at typical size/);
	assert.match(elements.viewToggle.textContent, /off/);
	assert.equal(elements.coldPowerValue.textContent, "1.50×");
	assert.equal(elements.hotPowerValue.textContent, "0.50×");
	assert.equal(elements.coldZoneValue.textContent, "55%");
	assert.equal(elements.liftValue.textContent, "0.50");
	assert.equal(elements.bondTempValue.textContent, "2.8");
	assert.equal(elements.waterValue.textContent, "38%");
	assert.equal(elements.conductionValue.textContent, "1.80×");
	assert.equal(elements.buoyancyValue.textContent, "1.10×");
	assert.equal(Number(elements.sizeResponse.value), 1);
	assert.equal(Number(elements.archSize.value), -4);
	assert.equal(elements.sizeValue.textContent, "+1.00");
	assert.equal(elements.archValue.textContent, "-4.00");

	sandbox.window.devicePixelRatio = 2;
	sandbox.window.listeners.resize();
	assert.equal(elements.c.width, 1600, "resize refreshes DPR and backing-store width");
	assert.equal(elements.c.height, 1200, "resize refreshes DPR and backing-store height");
	for (let i = 1; i <= 31; i++) sandbox.nextFrame(1000 + i * 16.67);

	function beadCount() {
		return Number(elements.stats.textContent.match(/^(\d+) BEADS/)[1]);
	}
	const beforeCancel = beadCount();
	elements.c.listeners.pointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} });
	elements.c.listeners.pointercancel();
	for (let i = 1; i <= 31; i++) sandbox.nextFrame(2000 + i * 16.67);
	assert.equal(beadCount(), beforeCancel, "pointer cancel does not add a bead");
	/* profile mode: a monotonic fake clock makes every stage cost measurable;
	   after PROFILE_FRAMES the p50/p95 summary replaces the stats line */
	let tick = 0;
	const profiled = makeSandbox("?profile=1", () => (tick += 1.25));
	vm.runInNewContext(bundle, profiled.sandbox, { filename: "browser-bundle-profile.js" });
	for (let i = 1; i <= 300; i++) profiled.sandbox.nextFrame(i * 16.67);
	assert.match(profiled.elements.stats.textContent, /^PROFILE 300F · FRAME p50 \d+\.\d\d p95 \d+\.\d\d · SIM p50 \d+\.\d\d p95 \d+\.\d\d · RENDER p50 \d+\.\d\d p95 \d+\.\d\d MS$/, "profile reports after 300 frames");
	for (let i = 301; i <= 331; i++) profiled.sandbox.nextFrame(i * 16.67);
	assert.match(profiled.elements.stats.textContent, /^PROFILE/, "finished profile stays on screen");

	/* settings round trip: Copy must describe the live scene, Paste must apply it, and
	   Defaults must restore the shipped values */
	elements.fillFraction.listeners.change();
	elements.copySettings.listeners.click({ currentTarget: elements.copySettings });
	const copied = JSON.parse(clipboard.text);
	assert.equal(copied.fill, SETTINGS.fill, "copy reports the live coverage");
	assert.equal(copied.water, 0.38, "copy reports the live water level");
	assert.equal(copied.coldEnd, 0.55, "copy reports the live cold band");
	assert.equal(copied.coldPower, 1.5, "copy reports the live cold power");
	assert.equal(copied.lift, 0.5, "copy reports the live thermal lift");
	assert.equal(copied.bondTemp, 2.8, "copy reports the live bond exponent");
	assert.equal(copied.conduction, 1.8, "copy reports the live conduction");
	assert.equal(copied.size, 1, "copy reports the preset thermal size");
	assert.equal(copied.arch, -4, "copy reports the preset arch coupling");

	clipboard.text = JSON.stringify({ fill: 0.3, coldEnd: 0.7, coldPower: 1.5, lift: 0.6, bondTemp: 4, size: 0.5, arch: 3, foreign: 1 });
	await elements.pasteSettings.listeners.click({ currentTarget: elements.pasteSettings });
		assert.equal(Number(elements.fillFraction.value), 30, "paste drives the coverage slider (a percentage)");
		assert.equal(Number(elements.coldZoneEnd.value), 70, "paste drives the cold band slider");
	assert.equal(elements.coldZoneValue.textContent, "70%", "paste refreshes the cold band readout");
	assert.match(elements.settingsEcho.textContent, /^applied .*"coldEnd":0\.7/, "paste echoes what it applied");
	assert.match(elements.settingsEcho.textContent, /ignored foreign/, "unknown keys are named, not silently dropped");
	assert.ok(/BEADS/.test(elements.stats.textContent), "a paste re-deals the bed and the stats follow");

	clipboard.text = "{not json";
	await elements.pasteSettings.listeners.click({ currentTarget: elements.pasteSettings });
	assert.match(elements.settingsEcho.textContent, /^not JSON/, "a bad paste is reported, not applied");
	assert.equal(Number(elements.coldZoneEnd.value), 70, "a bad paste leaves the scene alone");

	elements.resetSettings.listeners.click({ currentTarget: elements.resetSettings });
	assert.equal(Number(elements.fillFraction.value), SETTINGS.fill * 100, "defaults restores the shipped coverage");
	assert.equal(Number(elements.coldZoneEnd.value), SETTINGS.coldEnd * 100, "defaults restores the shipped cold band");
	assert.equal(Number(elements.coldPower.value), SETTINGS.coldPower, "defaults restores the shipped cold power");
	assert.equal(Number(elements.bondTempExp.value), SETTINGS.bondTemp, "defaults restores the shipped bond exponent");
	assert.equal(Number(elements.waterFrac.value), SETTINGS.water * 100, "defaults restores the shipped water level");
	assert.equal(elements.scenarioPreset.value, "convectionThermal", "defaults selects the default preset");
	assert.match(elements.viewToggle.textContent, /on/, "default preset enables temperature view");
	for (const [name, preset] of Object.entries(SCENARIO_PRESETS)) {
		elements.scenarioPreset.listeners.change({ target: { value: name } });
		assert.equal(elements.scenarioPreset.value, name, "preset stays selected after applying the scene");
		assert.deepEqual(JSON.parse(elements.settingsEcho.textContent.slice("applied ".length)), preset, name + " applies every scene setting");
	}

	console.log("browser bundle smoke: boot, render, four full-scene presets, live controls, DPR change, pointer cancel, clipboard settings paste/copy/reset and ?profile=1 passed");
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
