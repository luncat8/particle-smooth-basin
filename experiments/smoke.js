"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const ids = ["c", "stats", "hint", "sourceRate", "sourceValue", "conductionRate", "conductionValue", "sizeResponse", "sizeValue", "archSize", "archValue", "buoyancy", "buoyancyValue", "scenarioPreset", "fillFraction", "fillValue", "countValue", "typicalRadius", "radiusValue", "massScale", "massValue", "viewToggle", "redeal"];
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
const contextTarget = {
	createLinearGradient() { return { addColorStop() {} }; },
	createRadialGradient() { return { addColorStop() {} }; },
};
const context = new Proxy(contextTarget, { get(target, key) { return key in target ? target[key] : () => {}; }, set(target, key, value) { target[key] = value; return true; } });
elements.c.getContext = () => context;
function fakeCanvas() { return { width: 0, height: 0, getContext: () => context }; }
const sandbox = {
	document: { getElementById: id => elements[id], createElement: fakeCanvas },
	window: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, addEventListener() {} },
	performance: { now: () => 0 },
	requestAnimationFrame(fn) { sandbox.nextFrame = fn; },
	setTimeout() { return 1; },
	clearTimeout() {},
	console,
};
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
console.log("browser bundle smoke: boot, render, six presets and live controls passed");
