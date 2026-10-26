"use strict";

/* Static and sandbox validation for tests.html — the browser harness cannot be
   run here (no browser in the sandbox), so this proves the page's script
   compiles, every element id it asks for exists, and the checks and one perf
   case run against the real engine. Canvas output and real frame times are
   NOT validated: run the page for those.

   run: node experiments/harness.js */

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { createSandbox } = require("./fake-dom.js");

const html = fs.readFileSync("tests.html", "utf8");
const sources = ["js/engine.js", "js/render.js", "js/profile.js"].map(file => ({ file, code: fs.readFileSync(file, "utf8") }));

function inlineScript(page) {
	const blocks = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
	assert.equal(blocks.length, 1, "tests.html carries exactly one inline script");
	return blocks[0][1];
}

function declaredIds(page) {
	return new Set([...page.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
}

const pageScript = inlineScript(html);
new vm.Script(pageScript, { filename: "tests.html:<inline>" });   // syntax only

const markupIds = declaredIds(html);
const wanted = new Set([
	...[...pageScript.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]),
	...[...pageScript.matchAll(/getElementById\("([^"]+)"\)/g)].map(match => match[1]),
]);
const missing = [...wanted].filter(id => !markupIds.has(id));
assert.deepEqual(missing, [], "every element id the harness asks for exists in tests.html");

/* stand-in for POST /__log: the page's save path is part of what this checks */
const posted = [];
let duplicateNext = false;
function fakeFetch(url, options) {
	posted.push({ url: url, body: options && options.body ? String(options.body) : "" });
	const duplicate = duplicateNext;
	return Promise.resolve({
		ok: true,
		status: 200,
		json: () => Promise.resolve({ saved: !duplicate, duplicate: duplicate, path: "experiments/logs/fake-0.3.2-tests.log" }),
	});
}

/* the page's own console output stays out of this script's stdout: only the summary
   lines below belong in a run log */
function captureConsole() {
	const lines = [];
	const record = (...args) => lines.push(args.map(String).join(" "));
	return { lines, api: { log: record, info: record, warn: record, error: record, debug: record } };
}

const captured = captureConsole();
/* budget=60: this file validates wiring, never timings -- vm.runInContext leaves V8
   unable to optimize the engine, so the measured frames run about ten times slower
   than in a browser (see findings-pitfalls-skills.md, "tooling") */
const BUDGET = 60;
const QUERY = "?run=0&version=0.3.2&budget=" + BUDGET;		// the runner appends the same version it puts in the log name
const sandboxHost = createSandbox({
	ids: [...markupIds],
	canvasIds: ["c"],
	schedule: "timer",
	now: () => performance.now(),
	search: QUERY,
	windowExtras: { __harnessManual: true },
	console: captured.api,
	extraGlobals: {
		location: { search: QUERY, protocol: "http:" },
		navigator: { userAgent: "node", platform: "", hardwareConcurrency: 4 },
		fetch: fakeFetch,
	},
});
const { sandbox } = sandboxHost;
const context = vm.createContext(sandbox);
for (const source of sources) vm.runInContext(source.code, context, { filename: source.file });
vm.runInContext(pageScript, context, { filename: "tests.html:<inline>" });

function waitFor(predicate, label, timeoutMs) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		(function poll() {
			let ready = false;
			try { ready = predicate(); } catch (error) { reject(error); return; }
			if (ready) { resolve(); return; }
			if (Date.now() - started > (timeoutMs || 3000)) { reject(new Error("timeout waiting for " + label)); return; }
			setTimeout(poll, 10);
		})();
	});
}

(async () => {
	await waitFor(() => sandbox.window.__ready === true, "window.__ready");
	const harness = sandbox.window.Harness;
	assert.ok(harness, "tests.html exposes window.Harness");
	assert.equal(sandboxHost.elements.visualLink.href, "visual.html?version=0.3.2",
		"the visual review link carries the run-log version");

	const env = await harness.env();
	assert.match(env, /node|browser/, "environment line names the browser family");
	assert.match(env, /gpu /, "environment line names a GPU class");
	assert.match(env, /isolated (yes|no)/, "environment line reports cross-origin isolation");
	assert.match(env, /timer [\d.]+ us/, "environment line reports the timer step");

	const checks = harness.checks();
	console.log("checks: " + checks.map(check => check.id + "=" + (check.ok ? "ok" : check.detail)).join(" · "));
	assert.equal(checks.length, 9, "nine checks run");
	assert.ok(checks.some(check => check.id === "thermal-zone" && /bonds/.test(check.detail) && /above water/.test(check.detail)),
		"the default-rate thermal zone check reports bond counts");
	for (const check of checks) assert.ok(check.ok, "check " + check.id + " failed: " + check.detail);
	assert.ok(checks.some(check => check.id === "canvas" && /skipped/.test(check.detail)),
		"the pixel check reports itself skipped without a rasterizer");

	const quick = harness.perfCases("quick");
	const full = harness.perfCases("full");
	assert.equal(quick.map(item => item.id).join(","), "shipped,default dpr1,default dpr2", "quick matrix");
	assert.equal(full.length, 14, "full matrix is the shipped scene, 3 sizes x 3 variants and 4 extra cases");
	assert.equal(quick[0].id, "shipped", "the quick run starts by measuring the shipped scene");
	assert.ok(full.some(item => item.id === "shipped" && item.settings && item.settings.fill > 0),
		"the matrix measures the scene the app opens with");
	assert.ok(full.some(item => item.id === "cap dpr1-temp"), "full matrix carries the temperature view at the cap");
	assert.ok(full.some(item => item.id === "cold-links") && full.some(item => item.id === "stirred-cap"),
		"full matrix carries the preset and stirred cases");
	const heatCases = full.filter(item => item.id === "heat cap" || item.id === "heat cap dpr2");
	assert.equal(heatCases.length, 2, "paired heat-map cap cases");
	assert.equal(heatCases.map(item => item.dpr).join(","), "1,2", "heat view is measured at DPR 1 and 2");
	assert.ok(heatCases.every(item => item.view === "heat" && item.seed === heatCases[0].seed && item.seed),
		"DPR comparison uses the same seeded deal and view");
	const matrix = harness.couplingCases();
	const presets = require("../js/engine.js").PRESETS;
	const scenes = presets.filter(preset => preset.kind === "scene");
	const couplings = presets.filter(preset => preset.kind === "coupling");
	assert.equal(matrix.length, scenes.length * (couplings.length + 1), "one baseline and six couplings per scene");
	for (const scene of scenes) {
		const group = matrix.filter(item => item.scene === scene.id);
		assert.equal(group[0].coupling, "baseline", "the scene baseline comes first");
		assert.equal(group.slice(1).map(item => item.coupling).join(","), couplings.map(item => item.id).join(","),
			"couplings come from the engine's preset list, not a parallel hard-coded table");
		assert.ok(group.every(item => item.warm + item.measure === 480 && item.view === scene.settings.view),
			"matrix samples each scene at 8 s in its own view");
	}
	assert.equal(full.filter(item => item.view === "temp").length, 4,
		"the shipped case and the three temperature variants draw the temperature view");

	const rows = await harness.runPerf([quick[0]], { warm: 1, measure: 5 });
	assert.equal(rows.length, 1, "one perf row");
	const row = rows[0];
	assert.equal(row.frames, 5, "five measured frames");
	assert.equal(row.id, "shipped", "the first row is the shipped scene");
	assert.ok(row.n > 500 && row.n < 800, "the shipped scene spawns around six hundred beads, got " + row.n);
	assert.ok(Number.isFinite(row.frame.p50) && Number.isFinite(row.frame.p95), "frame percentiles are numbers");
	assert.ok(row.frame.p95 >= row.frame.p50, "p95 is not below p50");
	assert.ok(row.sim.p95 >= 0 && row.render.p95 >= 0 && row.interval.p95 >= 0, "stage percentiles are non-negative");
	const heatRows = await harness.runPerf(heatCases, { warm: 2, measure: 3 });
	assert.equal(heatRows.map(item => item.dpr).join(","), "1,2", "both heat cap paths run");
	assert.equal(heatRows[0].n, 1500, "the paired heat view runs at the bead cap");
	assert.equal(heatRows[0].links, heatRows[1].links,
		"the same seeded heat world reaches the same link count at both DPRs");
	assert.equal(heatRows[0].feed, heatRows[1].feed, "DPR cannot change heat feed");

	const passing = harness.summarise(checks, rows);
	assert.ok(passing.ok, "summary passes when every check and case is inside budget");
	assert.match(passing.line, new RegExp("^RESULT pass · checks 9/9 · perf 1/1 within " + BUDGET + " ms"));
	const failing = harness.summarise(checks.map((check, index) => (index === 0 ? { id: check.id, ok: false } : check)), rows);
	assert.equal(failing.ok, false, "summary fails when a check fails");
	assert.match(failing.line, /^RESULT fail/);

	/* the whole page path, autosave included: run() logs, tabulates, summarises,
	   saves and leaves a PASS status behind */
	sandboxHost.elements.auto.checked = true;
	const started = Date.now();
	const fullRun = await harness.run("quick", { warm: 2, measure: 6 });
	/* V8 does not optimize code compiled through vm.runInContext: the engine runs
	   ~10x slower here than in a browser. The sandbox validates wiring and verdicts,
	   never timings — see findings-pitfalls-skills.md, "tooling". */
	assert.ok(fullRun, "run() returns its report");
	assert.ok(fullRun.result.ok, "quick run passes: " + fullRun.result.line);
	assert.equal(posted.length, 1, "the run posted its log once");
	const saveButton = sandboxHost.elements.save;
	assert.equal(saveButton.textContent, "Saved \u2713", "the save button shows its saved state");
	assert.equal(saveButton.className, "saved", "the saved state is highlighted");
	assert.equal(saveButton.disabled, true, "a saved log cannot be saved twice");
	assert.match(posted[0].body, /^browser 0\.3\.2|^browser · /, "posted log starts with the environment line");
	assert.match(posted[0].body, /browser tests 0\.3\.2 · /, "posted log carries the version passed by the runner");
	assert.match(posted[0].body, /^browser · /, "the posted log opens with its environment line");
	assert.match(posted[0].body, /browser tests 0\.3\.2 · \d{4}-\d\d-\d\d/, "the posted log names its version and date");
	assert.match(posted[0].body, /check boot ok · /);
	assert.match(posted[0].body, /perf default dpr1 · n=\d+/);
	assert.match(posted[0].body, new RegExp("RESULT pass · checks 9/9 · perf 3/3 within " + BUDGET + " ms"));
	assert.match(sandboxHost.elements.status.textContent, /^PASS · checks 9\/9/, "status line carries the verdict");
	assert.match(sandboxHost.elements.out.textContent, /RESULT pass/, "the page's log element holds the report");

	/* pressing Save again must neither post nor drop the saved highlight */
	await harness.save();
	assert.equal(posted.length, 1, "a second Save posts nothing");
	assert.equal(saveButton.textContent, "Saved \u2713", "the saved state survives a second Save");
	assert.match(sandboxHost.elements.status.textContent, /already saved · experiments\/logs\/fake-0\.3\.2-tests\.log/);

	/* a server that already holds this section: the page reports it and stays saved */
	duplicateNext = true;
	await harness.run("quick", { warm: 2, measure: 6, checks: false });
	assert.equal(posted.length, 2, "a new run is a new section");
	assert.match(captured.lines.join("\n"), /\[log\] already in experiments\/logs\/fake-0\.3\.2-tests\.log — nothing appended/);
	assert.equal(saveButton.disabled, true, "a duplicate response still leaves the log saved");
	assert.equal(captured.lines.filter(line => line.startsWith("[log] appended")).length, 1, "only the first section was appended");
	assert.equal(captured.lines[0], "booting…", "the page's own console lines are captured, not printed");
	assert.ok(captured.lines.some(line => /^browser · /.test(line)), "the captured output carries the environment line");

	/* Exercise the optional matrix through run(), including scene-specific feed,
	   seeded re-deals, grouped baseline deltas, and the saved log path. Timing is
	   still browser-only; these deliberately short rows check wiring, not balance. */
	duplicateNext = false;
	sandboxHost.elements.auto.checked = false;
	const matrixRun = await harness.run("couplings", { warm: 1, measure: 2, checks: false });
	assert.ok(matrixRun, "matrix run returns a report");
	assert.equal(matrixRun.rows.length, matrix.length, "every scene/coupling row ran");
	assert.equal(sandboxHost.elements["coupling-section"].hidden, false, "matrix table is visible");
	assert.equal(sandboxHost.elements["profile-section"].hidden, true, "ordinary perf table is hidden during matrix runs");
	assert.equal(captured.lines.filter(line => line.startsWith("coupling ")).length, matrix.length,
		"matrix logs one row per combination");
	for (const scene of scenes) {
		const group = matrixRun.rows.filter(row => row.scene === scene.id);
		assert.equal(group[0].coupling, "baseline");
		assert.ok(group.every(row => row.n === group[0].n && row.feed === scene.settings.feed && !row.invalid),
			"couplings preserve " + scene.id + "'s bed size and feed with finite temperatures");
		for (const coupling of couplings) {
			const row = group.find(item => item.coupling === coupling.id);
			assert.equal(row.size, coupling.settings.size, "size retuned on " + scene.id + "/" + coupling.id);
			assert.equal(row.arch, coupling.settings.arch, "Archimedes retuned on " + scene.id + "/" + coupling.id);
			assert.equal(row.buoyancy, coupling.settings.buoyancy, "buoyancy retuned on " + scene.id + "/" + coupling.id);
		}
	}
	const repeat = (await harness.runPerf([matrix[0]], { warm: 1, measure: 2 }))[0];
	assert.equal(repeat.meanT, matrixRun.rows[0].meanT, "the seeded baseline deals and evolves identically on a rerun");
	assert.equal(repeat.links, matrixRun.rows[0].links, "the seeded baseline bonds are reproducible");
	assert.match(sandboxHost.elements.out.textContent, /coupling heat \/ baseline · feed=0\.05/);
	assert.match(sandboxHost.elements.out.textContent, /coupling thermal \/ shrinkFlow · feed=0\.20.*Δcold/);
	assert.match(sandboxHost.elements.out.textContent, /RESULT (pass|fail) · checks 9\/9 · perf \d+\/35 within/);
	assert.equal(posted.length, 2, "autosave disabled for the matrix sandbox run");
	const incomplete = harness.summarise(checks, matrixRun.rows.slice(0, 2), matrix.length);
	assert.equal(incomplete.ok, false, "a partial matrix is never a passing run");
	assert.match(incomplete.line, /incomplete 2\/35/);

	console.log("harness lint: tests.html script compiles, "
		+ markupIds.size + " element ids, " + wanted.size + " referenced ids present, "
		+ checks.length + " checks and " + rows.length + " perf case ran in the sandbox");
	console.log("sandbox page path: quick run in " + ((Date.now() - started) / 1000).toFixed(1)
		+ " s · saved once · second Save posts nothing · duplicate response accepted as saved");
	console.log("checks: " + checks.map(check => check.id + "=" + (check.ok ? "ok" : "FAIL")).join(" "));
	console.log("thermal zone: " + (checks.find(check => check.id === "thermal-zone") || {}).detail);
	console.log("perf row: " + row.id + " n=" + row.n + " frames=" + row.frames
		+ " frame p50 " + row.frame.p50.toFixed(2) + " p95 " + row.frame.p95.toFixed(2)
		+ " · sim p95 " + row.sim.p95.toFixed(2) + " · render p95 " + row.render.p95.toFixed(2));
	console.log("not validated here: canvas pixels and real frame times — open tests.html for those");
})().catch(error => {
	console.error(error);
	process.exit(1);
});
