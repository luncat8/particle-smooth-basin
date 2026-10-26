"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const { createSandbox } = require("./fake-dom.js");
const eng = require("../js/engine.js");
const { SETTINGS, PRESETS, PRESET_BY_ID, RANGES } = eng;

const ids = ["c", "stats", "hint", "conductionRate", "conductionValue", "sizeResponse", "sizeValue", "archSize", "archValue", "buoyancy", "buoyancyValue", "scenarioPreset", "fillFraction", "fillValue", "countValue", "typicalRadius", "radiusValue", "massScale", "massValue", "viewToggle", "redeal",
	"coldZoneEnd", "coldZoneValue", "hotZoneStart", "hotZoneValue", "coldPower", "coldPowerValue", "hotPower", "hotPowerValue",
	"thermalLift", "liftValue", "bondStrength", "bondStrengthValue", "bondTempExp", "bondTempValue",
	"waterFrac", "waterValue", "copySettings", "pasteSettings", "resetSettings", "settingsEcho",
	"heatFeed", "heatFeedValue"];
/* the markup's own values: the page must re-sync them from the engine on boot */
const values = {
	conductionRate: "1", sizeResponse: "0", archSize: "0", buoyancy: "1",
	scenarioPreset: "custom", fillFraction: "50", typicalRadius: "14", massScale: "1",
	coldZoneEnd: "40", hotZoneStart: "76", coldPower: "1", hotPower: "1",
	thermalLift: "0", bondStrength: "0.72", bondTempExp: "2", waterFrac: "50", heatFeed: "0",
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

/* the browser moves a slider before it fires, so the test does the same */
function slide(elements, id, value, type) {
	elements[id].value = String(value);
	const handler = elements[id].listeners[type || "input"];
	handler({ target: elements[id], currentTarget: elements[id] });
}

/* the slider a control row owns, by world key: the ids follow the page's own table */
function slider(key) {
	return {
		coldEnd: "coldZoneEnd", hotStart: "hotZoneStart", coldPower: "coldPower", hotPower: "hotPower",
		conduction: "conductionRate", lift: "thermalLift", arch: "archSize", buoyancy: "buoyancy",
		size: "sizeResponse", bonds: "bondStrength", bondTemp: "bondTempExp", water: "waterFrac",
		fill: "fillFraction", radius: "typicalRadius", mass: "massScale", feed: "heatFeed",
	}[key];
}

(async function main() {
	const { sandbox, elements } = settingsSandbox("", () => 0);
	const bundle = ["js/engine.js", "js/render.js", "js/profile.js", "js/app.js"].map(path => fs.readFileSync(path, "utf8")).join("\n");
	vm.runInNewContext(bundle, sandbox, { filename: "browser-bundle.js" });
	for (let i = 1; i <= 31; i++) sandbox.nextFrame(i * 16.67);

	/* the page starts from the engine's shipped scene, not from whatever the markup held */
	for (const control of Object.keys(slider("coldEnd") ? {
		coldEnd: 1, hotStart: 1, coldPower: 1, hotPower: 1, conduction: 1, lift: 1, arch: 1, buoyancy: 1,
		size: 1, bonds: 1, bondTemp: 1, water: 1, fill: 1, radius: 1, mass: 1, feed: 1,
	} : {})) {
		const input = elements[slider(control)];
		const expected = SETTINGS[control] * (RANGES[control].percent ? 100 : 1);
		assert.equal(Number(input.value), expected, "boot syncs " + control + " from the shipped scene");
		assert.equal(Number(input.min), RANGES[control].ui[0], control + " takes its slider minimum from RANGES");
		assert.equal(Number(input.max), RANGES[control].ui[1], control + " takes its slider maximum from RANGES");
	}
	assert.equal(elements.scenarioPreset.value, PRESETS[0].id, "boot selects the shipped preset");
	assert.match(elements.settingsEcho.textContent, /paste reads and applies clipboard/);
	assert.match(elements.viewToggle.textContent, /View: temperature/);

	/* moving a slider writes the world through the engine setter and marks the scene custom */
	slide(elements, "conductionRate", 1.8);
	slide(elements, "heatFeed", 0.6);
	slide(elements, "coldPower", 1.5);
	slide(elements, "hotPower", 0.5);
	slide(elements, "coldZoneEnd", 55);
	slide(elements, "thermalLift", 0.5);
	slide(elements, "bondTempExp", 2.8);
	slide(elements, "waterFrac", 38);
	slide(elements, "buoyancy", 1.1);
	slide(elements, "archSize", 0.5);
	assert.equal(elements.archValue.textContent, "+0.50");
	assert.equal(elements.scenarioPreset.value, "custom", "a slider edit marks the scene custom");
	slide(elements, "sizeResponse", 1);
	slide(elements, "archSize", -4);
	elements.viewToggle.listeners.click({ currentTarget: elements.viewToggle });
	slide(elements, "fillFraction", 40, "change");
	assert.match(elements.stats.textContent, /BEADS/);
	assert.match(elements.countValue.textContent, /beads at typical size/);
	assert.match(elements.viewToggle.textContent, /View: heat map/, "the view button cycles temperature to heat map");
	assert.equal(elements.coldPowerValue.textContent, "1.50×");
	assert.equal(elements.hotPowerValue.textContent, "0.50×");
	assert.equal(elements.coldZoneValue.textContent, "55%");
	assert.equal(elements.liftValue.textContent, "0.50");
	assert.equal(elements.bondTempValue.textContent, "2.8");
	assert.equal(elements.waterValue.textContent, "38%");
	assert.equal(elements.conductionValue.textContent, "1.80×");
	assert.equal(elements.heatFeedValue.textContent, "0.60");
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
	/* Test the band gesture on a sparse bed: a random dense deal can cover every
	   point on the line, so cursor hit-testing should not depend on that lottery. */
	slide(elements, "fillFraction", 5);
	slide(elements, "fillFraction", 5, "change");
	for (let i = 1; i <= 31; i++) sandbox.nextFrame(1600 + i * 12);
	const beforeCancel = beadCount();
	elements.c.listeners.pointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} });
	elements.c.listeners.pointercancel();
	for (let i = 1; i <= 31; i++) sandbox.nextFrame(2000 + i * 16.67);
	assert.equal(beadCount(), beforeCancel, "pointer cancel does not add a bead");

	/* a band line is draggable where no bead covers it: the readout and the world follow,
	   and the gesture is not a click-to-add. The cursor probe uses the page's own hit test,
	   so the test does not need to know where the bed ended up. */
	const bandY = 600 * 0.55;
	let bandX = -1;
	for (let x = 20; x < 780 && bandX < 0; x += 10) {
		elements.c.listeners.pointermove({ clientX: x, clientY: bandY });
		if (elements.c.style.cursor === "ns-resize") bandX = x;
	}
	assert.ok(bandX > 0, "somewhere along the cold line is clear of beads");
	const beforeBand = Number(elements.coldZoneEnd.value);
	elements.c.listeners.pointerdown({ clientX: bandX, clientY: bandY, pointerId: 2, preventDefault() {} });
	assert.equal(elements.c.style.cursor, "ns-resize", "grabbing the line shows the vertical-resize cursor");
	elements.c.listeners.pointermove({ clientX: bandX, clientY: bandY + 40 });
	assert.ok(Number(elements.coldZoneEnd.value) > beforeBand, "dragging the cold line deepens the band");
	elements.c.listeners.pointerup({ clientX: bandX, clientY: bandY + 40 });
	for (let i = 1; i <= 31; i++) sandbox.nextFrame(3000 + i * 16.67);
	assert.equal(beadCount(), beforeCancel, "a band drag does not add a bead");
	assert.match(elements.coldZoneValue.textContent, /%$/, "the band readout survives the drag");

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
	slide(elements, "fillFraction", 40);
	slide(elements, "fillFraction", 40, "change");
	elements.copySettings.listeners.click({ currentTarget: elements.copySettings });
	const copied = JSON.parse(clipboard.text);
	assert.equal(copied.fill, SETTINGS.fill, "copy reports the live coverage");
	assert.equal(copied.water, 0.38, "copy reports the live water level");
	assert.ok(Math.abs(copied.coldEnd - Number(elements.coldZoneEnd.value) / 100) < 0.006, "copy reports the live cold band");
	assert.equal(copied.coldPower, 1.5, "copy reports the live cold power");
	assert.equal(copied.lift, 0.5, "copy reports the live thermal lift");
	assert.equal(copied.bondTemp, 2.8, "copy reports the live bond exponent");
	assert.equal(copied.conduction, 1.8, "copy reports the live conduction");
	assert.equal(copied.feed, 0.6, "copy reports the live heat feed");
	assert.equal(copied.size, 1, "copy reports the preset thermal size");
	assert.equal(copied.arch, -4, "copy reports the preset arch coupling");
	assert.equal(copied.view, "heat", "copy reports the view");

	clipboard.text = JSON.stringify({ fill: 0.3, coldEnd: 0.7, coldPower: 1.5, lift: 0.6, bondTemp: 4, size: 0.5, arch: 3, foreign: 1, view: "density" });
	await elements.pasteSettings.listeners.click({ currentTarget: elements.pasteSettings });
	assert.equal(Number(elements.fillFraction.value), 30, "paste drives the coverage slider (a percentage)");
	assert.equal(Number(elements.coldZoneEnd.value), 70, "paste drives the cold band slider");
	assert.equal(elements.coldZoneValue.textContent, "70%", "paste refreshes the cold band readout");
	assert.match(elements.viewToggle.textContent, /density/, "paste switches the view");
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
	assert.equal(Number(elements.heatFeed.value), SETTINGS.feed, "defaults restores the shipped heat feed");
	assert.equal(Number(elements.waterFrac.value), SETTINGS.water * 100, "defaults restores the shipped water level");
	assert.equal(elements.scenarioPreset.value, PRESETS[0].id, "defaults selects the shipped preset");
	assert.match(elements.viewToggle.textContent, /temperature/, "defaults restores the shipped view");

	/* every preset in the list is reachable from the select and does what its kind says:
	   a scene replaces the whole scene, a coupling moves size, arch and buoyancy and
	   leaves every other key alone -- whichever preset ran before it */
	let previous = null;
	for (const preset of PRESETS) {
		elements.scenarioPreset.listeners.change({ target: { value: preset.id } });
		assert.equal(elements.scenarioPreset.value, preset.id, preset.id + " stays selected after applying");
		const echo = JSON.parse(elements.settingsEcho.textContent.slice("applied ".length).replace(/ · ignored .*/, ""));
		if (preset.kind === "coupling") {
			for (const key of Object.keys(preset.settings)) {
				assert.equal(echo[key], preset.settings[key], preset.id + " applies " + key);
			}
			const untouched = Object.keys(echo).filter(key => !(key in preset.settings) && echo[key] !== previous[key]);
			assert.deepEqual(untouched, [], preset.id + " leaves every other key alone");
		} else {
			assert.deepEqual(echo, preset.settings, preset.id + " applies every scene setting");
			assert.equal(Number(elements.fillFraction.value), preset.settings.fill * 100, preset.id + " drives the sliders");
		}
		previous = echo;
	}

	/* the old presets kept their place at the end of the list, after the scenes */
	const sceneCount = PRESETS.filter(preset => preset.kind === "scene").length;
	assert.deepEqual(PRESETS.slice(sceneCount).map(preset => preset.id),
		["shrinkFlow", "bigFloats", "shrinkConvection", "growConvection", "shrinkStable", "growStable"],
		"the six coupling presets are the tail of the list");
	assert.equal(PRESET_BY_ID.sparseRaft.kind, "scene", "the old default scene is a scene preset");
	assert.deepEqual(PRESET_BY_ID.sparseRaft.settings, {
		fill: 0.21, radius: 14, water: 0.3, coldEnd: 0.56, hotStart: 0.78,
		coldPower: 2.5, hotPower: 2.5, lift: 0.4, bonds: 0.72, bondTemp: 2,
		conduction: 1, feed: 0.15, size: -0.35, arch: -2.5, buoyancy: 1, mass: 1, view: "density",
	}, "the old default scene is restored value for value");

	console.log("browser bundle smoke: boot, render, five scene and six coupling presets, live controls,"
		+ " band drag, DPR change, pointer cancel, clipboard settings paste/copy/reset and ?profile=1 passed");
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
