"use strict";

/* Guided review wiring, not a pixel oracle: verify the human ratings, frozen
   DPR comparison and separate log payload in the fake DOM. */
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { createSandbox } = require("./fake-dom.js");

const html = fs.readFileSync("visual.html", "utf8");
const version = fs.readFileSync("VERSION", "utf8").trim();
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, "one inline review controller");
const script = scripts[0][1];
new vm.Script(script, { filename: "visual.html:<inline>" });
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const wanted = [...script.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]);
assert.deepEqual(wanted.filter(id => !ids.has(id)), [], "review controls exist in the markup");

const posted = [];
const host = createSandbox({
	ids: [...ids], canvasIds: ["c"], search: "?version=" + version,
	extraGlobals: {
		location: { search: "?version=" + version, protocol: "http:" },
		navigator: { userAgent: "node visual lint" },
		URL: { createObjectURL: () => "blob:review", revokeObjectURL() {} },
		Blob: class Blob { constructor(parts) { this.parts = parts; } },
		fetch: (url, options) => {
			posted.push({ url, body: options.body });
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ path: "experiments/logs/review.log", duplicate: false }) });
		},
	},
});
const context = vm.createContext(host.sandbox);
for (const file of ["js/engine.js", "js/render.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
vm.runInContext(script, context, { filename: "visual.html:<inline>" });
const review = host.sandbox.window.VisualReview;
const el = host.elements;
assert.ok(review, "review controls exposed");
assert.equal(el.testsLink.href, "tests.html?run=0&version=" + version);
assert.equal(el.save.disabled, true, "an empty review cannot be saved");

(async () => {
	review.start(2);
	assert.equal(review.state().step, 0);
	assert.equal(review.state().feed, 0);
	assert.equal(review.state().dpr, 1);
	assert.equal(review.state().n, 1500, "the guide draws the bead-cap scene");
	assert.equal(el.save.disabled, true, "one step cannot be mistaken for a complete review");
	review.mark("good");
	review.go(1);
	assert.equal(review.state().feed, 0.2);
	const live = review.state().world;
	el.note.value = "soft wake near top";
	el.note.listeners.input();
	review.mark("good");
	review.go(2);
	assert.equal(review.state().world, live, "DPR 2 paints the same paused world as DPR 1");
	assert.equal(review.state().dpr, 2);
	assert.equal(el.c.width, 2560, "the DPR 2 backing store doubles the width");
	assert.equal(review.state().heat, live.heat.field, "the field is not recomputed for DPR");
	el.hide.checked = true;
	el.hide.listeners.change();
	assert.equal(review.state().n, 1500, "wash-only drawing restores the bead count");
	review.mark("issue");
	assert.equal(el.save.disabled, true, "an issue needs a location or explanation before saving");
	el.note.value = "edge seam";
	el.note.listeners.input();
	review.go(1);
	assert.equal(review.state().world, live, "Previous returns to the same frozen scene");
	assert.equal(el.note.value, "soft wake near top", "notes survive switching steps");
	review.go(3);
	assert.equal(review.state().world, live, "the temperature view retains the bed");
	assert.equal(review.state().world.view, "temp");
	assert.equal(el.hide.checked, false, "the bead view cannot hide its subjects");
	review.mark("skip");
	assert.equal(el.save.disabled, false, "all four outcomes permit saving, including a skipped item");
	assert.match(review.report(), /visual hires · DPR 2 · feed 0\.20 · issue · edge seam/);
	assert.match(review.report(), /VISUAL summary · good 2\/4 · issues 1 · not checked 1/);
	await review.save();
	assert.equal(posted.length, 1);
	assert.equal(posted[0].url, "__visual", "manual notes never repost the automated matrix");
	assert.doesNotMatch(posted[0].body, /^RESULT /m, "visual review cannot override the automated verdict");
	assert.equal(el.save.disabled, true, "an unchanged review cannot be saved twice");
	el.note.value = "sprite rims OK";
	el.note.listeners.input();
	assert.equal(el.save.disabled, false, "editing a saved review enables a new revision");
	host.sandbox.location.protocol = "file:";
	assert.equal(await review.save(), version + "-visual-review.txt", "file:// downloads the review");
	assert.equal(posted.length, 1, "file:// never attempts a server POST");
	console.log("guided visual review: 4 steps, frozen paired DPR, hidden-bead wash, human ratings, separate save/download passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
