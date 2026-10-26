"use strict";

/* Preallocated sample channels and the three-stage frame timer shared by the
   page (`?profile=1`) and the browser harness (tests.html). Off costs nothing:
   no buffer is touched and no string is built while profiling is disabled. */

function createSamples(frames) {
	const values = new Float64Array(frames);
	let count = 0;

	/* Float64Array.sort() is numeric, so percentiles need no comparator
	   and no scratch array beyond the one slice() taken at report time. */
	function percentile(fraction) {
		const n = count || 1;
		const sorted = values.slice(0, count).sort();
		return sorted[Math.min(n - 1, Math.floor(fraction * n))];
	}

	return {
		frames,
		get count() { return count; },
		get full() { return count >= frames; },
		add(value) { if (count < frames) values[count++] = value; },
		summary() { return { p50: percentile(0.5), p95: percentile(0.95) }; },
	};
}

function createProfiler(frames) {
	const frame = createSamples(frames);
	const sim = createSamples(frames);
	const render = createSamples(frames);
	let done = false;

	return {
		frames,
		get count() { return frame.count; },
		get done() { return done; },

		/* true on the call that completed the sample set */
		record(frameMs, simMs, renderMs) {
			if (done) return false;
			frame.add(frameMs);
			sim.add(simMs);
			render.add(renderMs);
			done = frame.full;
			return done;
		},

		summary() {
			return { frames: frame.count, frame: frame.summary(), sim: sim.summary(), render: render.summary() };
		},

		/* One-off report line: `PROFILE 300F · FRAME p50 1.20 p95 2.40 · …` */
		line() {
			const s = this.summary();
			return "PROFILE " + s.frames + "F"
				+ " · FRAME p50 " + s.frame.p50.toFixed(2) + " p95 " + s.frame.p95.toFixed(2)
				+ " · SIM p50 " + s.sim.p50.toFixed(2) + " p95 " + s.sim.p95.toFixed(2)
				+ " · RENDER p50 " + s.render.p50.toFixed(2) + " p95 " + s.render.p95.toFixed(2) + " MS";
		},
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { createSamples, createProfiler };
}
