"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const ids = ["c", "stats", "hint", "heatRate", "heatValue", "sizeResponse", "sizeValue", "archSize", "archValue", "fillFraction", "fillValue", "countValue", "typicalRadius", "radiusValue", "massScale", "massValue", "viewToggle", "redeal"];
const elements = Object.create(null);
for (const id of ids) elements[id] = { id, value: "", textContent: "", style: {}, listeners: Object.create(null), addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {} };
Object.assign(elements.heatRate, { value: "1" });
Object.assign(elements.sizeResponse, { value: "0" });
Object.assign(elements.archSize, { value: "0" });
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
elements.heatRate.listeners.input({ target: { value: "2.5" } });
elements.archSize.listeners.input({ target: { value: "0.5" } });
elements.viewToggle.listeners.click({ currentTarget: elements.viewToggle });
elements.fillFraction.listeners.change();
assert.match(elements.stats.textContent, /BEADS/);
assert.match(elements.countValue.textContent, /beads at typical size/);
assert.match(elements.viewToggle.textContent, /on/);
assert.equal(elements.archValue.textContent, "+0.50");
console.log("browser bundle smoke: boot, render, controls and re-deal passed");
