"use strict";

/* Minimal DOM sandbox for node: boots a page bundle without a browser.
   Canvas calls are accepted, not rasterized — this proves logic, never timings
   or pixels. Shared by experiments/smoke.js (the app bundle) and
   experiments/harness.js (the tests.html harness). */

function fakeContext() {
	const target = {
		createLinearGradient() { return { addColorStop() {} }; },
		createRadialGradient() { return { addColorStop() {} }; },
		/* enough of a 2D context for the heat-map pixels the renderer uploads */
		createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
		canvas: null,
	};
	return new Proxy(target, {
		get(object, key) { return key in object ? object[key] : () => {}; },
		set(object, key, value) { object[key] = value; return true; },
	});
}

function fakeCanvas() {
	const context = fakeContext();
	return {
		width: 0, height: 0, style: {}, id: "",
		listeners: Object.create(null),
		getContext: () => context,
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
		setPointerCapture() {},
		releasePointerCapture() {},
		addEventListener(type, fn) { this.listeners[type] = fn; },
	};
}

class Path2D {
	moveTo() {}
	lineTo() {}
	quadraticCurveTo() {}
	arc() {}
	ellipse() {}
	closePath() {}
}

function fakeElement(id) {
	return {
		id, value: "", textContent: "", innerHTML: "", checked: false, disabled: false,
		style: {}, listeners: Object.create(null),
		addEventListener(type, fn) { this.listeners[type] = fn; },
		removeEventListener() {},
		setAttribute() {},
		getAttribute() { return null; },
		appendChild() {},
		removeChild() {},
		click() { if (this.listeners.click) this.listeners.click({ currentTarget: this, target: this }); },
	};
}

/* options:
   ids          element ids to create up front (others are created on demand)
   values       initial `value` per element id
   checks       initial `checked` per element id
   search       location.search served to window.location
   dpr          window.devicePixelRatio (default 1)
   innerWidth / innerHeight   viewport in CSS px (default 800x600)
   now          performance.now stub (default () => 0)
   schedule     'manual' queues one frame in sandbox.nextFrame (default);
                'timer' drives requestAnimationFrame on real timers
   windowExtras extra properties on window (e.g. __harnessManual)
   extraGlobals extra names visible as globals (location, navigator, fetch, …)
   console      console stand-in; a page's own logs then stay out of the caller's stdout */
function createSandbox(options) {
	const settings = options || {};
	const canvasIds = settings.canvasIds || ["c"];
	const elements = Object.create(null);
	for (const id of settings.ids || []) elements[id] = canvasIds.indexOf(id) >= 0 ? fakeCanvas() : fakeElement(id);
	for (const id of Object.keys(settings.values || {})) {
		const element = elements[id] || (elements[id] = fakeElement(id));
		element.value = String(settings.values[id]);
	}
	for (const id of Object.keys(settings.checks || {})) {
		const element = elements[id] || (elements[id] = fakeElement(id));
		element.checked = !!settings.checks[id];
	}
	const canvas = elements.c || (elements.c = fakeCanvas());

	// Timer-driven frames must not run before the bundle has finished loading.
	let pending = null;
	function requestAnimationFrame(fn) {
		if (settings.schedule === "timer") setTimeout(() => fn(sandbox.performance.now()), 0);
		else pending = fn;
	}

	const sandbox = Object.assign({
		Path2D,
		document: {
			body: fakeElement("body"),
			getElementById: id => elements[id] || (elements[id] = fakeElement(id)),
			createElement: tag => (tag === "canvas" ? fakeCanvas() : fakeElement("")),
			addEventListener() {},
		},
		window: {
			innerWidth: settings.innerWidth || 800,
			innerHeight: settings.innerHeight || 600,
			devicePixelRatio: settings.dpr || 1,
			location: { search: settings.search || "", protocol: "http:" },
			listeners: Object.create(null),
			addEventListener(type, fn) { this.listeners[type] = fn; },
		},
		performance: { now: settings.now || (() => 0) },
		requestAnimationFrame,
		setTimeout: settings.schedule === "timer" ? setTimeout : (fn => { fn(); return 1; }),
		clearTimeout: settings.schedule === "timer" ? clearTimeout : (() => {}),
		console,
	}, settings.extraGlobals || {});

	Object.assign(sandbox.window, settings.windowExtras || {});
	if (settings.console) sandbox.console = settings.console;
	Object.defineProperty(sandbox, "nextFrame", { get: () => pending });
	return { sandbox, elements, canvas };
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { createSandbox, fakeCanvas, fakeContext, Path2D };
}
