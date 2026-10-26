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
const QUERY = "?run=0&version=0.3.2";		// the runner appends the same version it puts in the log name
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

	const env = await harness.env();
	assert.match(env, /node|browser/, "environment line names the browser family");
	assert.match(env, /gpu /, "environment line names a GPU class");
	assert.match(env, /isolated (yes|no)/, "environment line reports cross-origin isolation");
	assert.match(env, /timer [\d.]+ us/, "environment line reports the timer step");

	const checks = harness.checks();
	console.log("checks: " + checks.map(check => check.id + "=" + (check.ok ? "ok" : check.detail)).join(" · "));
	assert.equal(checks.length, 8, "eight checks run");
	assert.ok(checks.some(check => check.id === "thermal-zone" && /bonds/.test(check.detail) && /above water/.test(check.detail)),
		"the default-rate thermal zone check reports bond counts");
	for (const check of checks) assert.ok(check.ok, "check " + check.id + " failed: " + check.detail);
	assert.ok(checks.some(check => check.id === "canvas" && /skipped/.test(check.detail)),
		"the pixel check reports itself skipped without a rasterizer");

	const quick = harness.perfCases("quick");
	const full = harness.perfCases("full");
	assert.equal(quick.map(item => item.id).join(","), "shipped,default dpr1,default dpr2", "quick matrix");
	assert.equal(full.length, 12, "full matrix is the shipped scene, 3 sizes x 3 variants and 2 interaction cases");
	assert.equal(quick[0].id, "shipped", "the quick run starts by measuring the shipped scene");
	assert.ok(full.some(item => item.id === "shipped" && item.settings && item.settings.fill > 0),
		"the matrix measures the scene the app opens with");
	assert.ok(full.some(item => item.id === "cap dpr1-temp"), "full matrix carries the temperature view at the cap");
	assert.ok(full.some(item => item.id === "cold-links") && full.some(item => item.id === "stirred-cap"),
		"full matrix carries the preset and stirred cases");

	const rows = await harness.runPerf([quick[0]], { warm: 1, measure: 5 });
	assert.equal(rows.length, 1, "one perf row");
	const row = rows[0];
	assert.equal(row.frames, 5, "five measured frames");
	assert.equal(row.id, "shipped", "the first row is the shipped scene");
	assert.ok(row.n > 500 && row.n < 800, "the shipped scene spawns around six hundred beads, got " + row.n);
	assert.ok(Number.isFinite(row.frame.p50) && Number.isFinite(row.frame.p95), "frame percentiles are numbers");
	assert.ok(row.frame.p95 >= row.frame.p50, "p95 is not below p50");
	assert.ok(row.sim.p95 >= 0 && row.render.p95 >= 0 && row.interval.p95 >= 0, "stage percentiles are non-negative");

	const passing = harness.summarise(checks, rows);
	assert.ok(passing.ok, "summary passes when every check and case is inside budget");
	assert.match(passing.line, /^RESULT pass · checks 8\/8 · perf 1\/1 within 16\.7 ms/);
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
	assert.match(posted[0].body, /RESULT pass · checks 8\/8 · perf 3\/3 within 16\.7 ms/);
	assert.match(sandboxHost.elements.status.textContent, /^PASS · checks 8\/8/, "status line carries the verdict");
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
