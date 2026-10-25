"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const ids = ["c", "stats", "hint", "sourceRate", "sourceValue", "conductionRate", "conductionValue", "sizeResponse", "sizeValue", "archSize", "archValue", "buoyancy", "buoyancyValue", "scenarioPreset", "fillFraction", "fillValue", "countValue", "typicalRadius", "radiusValue", "massScale", "massValue", "viewToggle", "redeal"];
const contextTarget = {
	createLinearGradient() { return { addColorStop() {} }; },
	createRadialGradient() { return { addColorStop() {} }; },
};
const context = new Proxy(contextTarget, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
function fakeCanvas() { return { width: 0, height: 0, getContext: () => context }; }
class Path2D {
	moveTo() {}
	lineTo() {}
	quadraticCurveTo() {}
}

function makeSandbox(search, now) {
	const elements = Object.create(null);
	for (const id of ids) elements[id] = { id, value: "", textContent: "", style: {}, listeners: Object.create(null), addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {} };
	Object.assign(elements.sourceRate, { value: "1" });
	Object.assign(elements.conductionRate, { value: "1" });
	Object.assign(elements.sizeResponse, { value: "0" });
	Object.assign(elements.archSize, { value: "0" });
	Object.assign(elements.buoyancy, { value: "1" });
	Object.assign(elements.scenarioPreset, { value: "custom" });
	Object.assign(elements.fillFraction, { value: "50" });
	Object.assign(elements.typicalRadius, { value: "14" });
	Object.assign(elements.massScale, { value: "1" });
	elements.c.getBoundingClientRect = () => ({ left: 0, top: 0 });
	elements.c.setPointerCapture = () => {};
	elements.c.getContext = () => context;
	const sandbox = {
		Path2D,
		document: { getElementById: id => elements[id], createElement: fakeCanvas },
		window: {
			innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
			location: { search },
			listeners: Object.create(null),
			addEventListener(type, fn) { this.listeners[type] = fn; },
		},
		performance: { now },
		requestAnimationFrame(fn) { sandbox.nextFrame = fn; },
		setTimeout(fn) { fn(); return 1; },
		clearTimeout() {},
		console,
	};
	return { sandbox, elements };
}

const { sandbox, elements } = makeSandbox("", () => 0);
const bundle = ["js/engine.js", "js/render.js", "js/app.js"].map(path => fs.readFileSync(path, "utf8")).join("\n");
vm.runInNewContext(bundle, sandbox, { filename: "browser-bundle.js" });
for (let i = 1; i <= 31; i++) {
	const frame = sandbox.nextFrame;
	frame(i * 16.67);
}
elements.sourceRate.listeners.input({ target: { value: "2.5" } });
elements.conductionRate.listeners.input({ target: { value: "3" } });
elements.buoyancy.listeners.input({ target: { value: "1.5" } });
elements.archSize.listeners.input({ target: { value: "0.5" } });
assert.equal(elements.archValue.textContent, "+0.50");
assert.equal(elements.scenarioPreset.value, "custom");
const scenarios = [
	["shrinkFlow", -1, 0], ["bigFloats", 0, 4],
	["shrinkConvection", -1, -4], ["growConvection", 1, 4],
	["shrinkStable", -1, 4], ["growStable", 1, -4],
];
for (const [name, size, arch] of scenarios) {
	elements.scenarioPreset.listeners.change({ target: { value: name } });
	assert.equal(Number(elements.sizeResponse.value), size);
	assert.equal(Number(elements.archSize.value), arch);
}
elements.viewToggle.listeners.click({ currentTarget: elements.viewToggle });
elements.fillFraction.listeners.change();
assert.match(elements.stats.textContent, /BEADS/);
assert.match(elements.countValue.textContent, /beads at typical size/);
assert.match(elements.viewToggle.textContent, /on/);
assert.equal(elements.sourceValue.textContent, "2.50×");
assert.equal(elements.conductionValue.textContent, "3.00×");
assert.equal(elements.buoyancyValue.textContent, "1.50×");
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

console.log("browser bundle smoke: boot, render, six presets, live controls, DPR change, pointer cancel and ?profile=1 passed");
