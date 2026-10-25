"use strict";

/* Hydrogel basin physics. Pure JS, no DOM — node can require it
   (experiments/). Pipeline per substep: forces and heat -> predict ->
   contact and thermal-bond relaxation -> velocity derivation. */

const TAU = Math.PI * 2;

const WATER_FRAC = 0.5;		// waterline share of screen height
const DEFAULT_FILL = 0.50;
const DEFAULT_RADIUS = 14;
const SIZE_FACTOR_MAX = 1.28;	// upper bound on bead r/rBar; pair-grid cell size assumes it
const SPAWN_CAP = 1500;
const RHO_WATER = 1;
const DRAG_AIR = 0.05;		// 1/s
const DRAG_WATER = 2.7;		// 1/s, scaled by submerged fraction^2
const SUBSTEP = 1 / 120;
const MAX_STEPS = 6;
const CONTACT_ITER = 3;
const CONTACT_SOFT = 0.55;	// 0..1 squishiness of contacts
const CONTACT_DAMP = 1;		// 0..1 inelasticity of touching pairs (hydrogel: no bounce)
const MAX_SPEED = 1600;		// px/s
const WAVE_REACT = 22;		// px/s per ripple kick unit: reaction impulse on the bead
const PAL_LIGHT = 6;		// sprite palette: 0..5 light beads, 6..11 deep

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------- world ------------------------- */

function createWorld(W, H) {
	const cap = SPAWN_CAP;
	const world = {
		W: 0, H: 0,
		tank: { x0: 0, x1: 0, y0: 0, y1: 0 },
		waterY: 0,
		grav: 1850,			// px/s^2, rescaled with screen height
		rBar: DEFAULT_RADIUS, rMax: 24,
		fillFraction: DEFAULT_FILL, typicalRadius: DEFAULT_RADIUS, massScale: 1,
		heatRate: 1, sizeResponse: 0, archSize: 0, temperatureView: false,
		n: 0, cap,
		x: new Float64Array(cap), y: new Float64Array(cap),
		px: new Float64Array(cap), py: new Float64Array(cap),
		vx: new Float64Array(cap), vy: new Float64Array(cap),
		r: new Float64Array(cap), baseSize: new Float64Array(cap), dens: new Float64Array(cap),
		invM: new Float64Array(cap), frac: new Float64Array(cap),
		temp: new Float32Array(cap), heatDelta: new Float32Array(cap),
		alpha: new Float64Array(cap), pal: new Uint8Array(cap),
		wave: { n: 0, dx: 10, x0: 0, h: null, vh: null, ld: null, rd: null },
		head: null, nxt: null, gw: 0, gh: 0,
		pairA: new Int32Array(cap * 8), pairB: new Int32Array(cap * 8),
		pairN: 0,
		pairRF: 1.25,		// includes near-contact heat and thermal-bond candidates
		linkLookupSlot: 0, linkLookupKey: 0, linkLookupValue: -1,
		linkA: new Int32Array(cap * 8), linkB: new Int32Array(cap * 8),
		linkRest: new Float32Array(cap * 8), linkK: new Float32Array(cap * 8), linkN: 0,
		linkHashKeys: null, linkHashValues: null, linkHashMask: 0,
		pointer: { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, active: false, grab: -1, moved: 0, downT: 0 },
		acc: 0,
	};
	initLinkHash(world);
	resizeWorld(world, W, H);
	spawnBed(world);
	return world;
}

/* Rebuild the bed after geometry changes so configured coverage stays constant. */
function resizeWorld(world, W, H) {
	world.W = W; world.H = H;
	const t = world.tank;
	t.x0 = W * 0.055; t.x1 = W * 0.945;
	t.y0 = H * 0.155; t.y1 = H * 0.935;
	world.waterY = H * WATER_FRAC;
	world.grav = 1850 * clamp(H / 950, 0.75, 1.25);
	initWave(world);
	if (world.n > 0) spawnBed(world);
}

/* ------------------------- wave field -------------------------
   1-D spring columns along the waterline: visuals + a sink for bobbing
   energy. Beads crossing the surface kick the columns -> ripples, and
   pay the opposite impulse (radiation damping). Buoyancy acts on the
   flat tank level, not on h: a local meniscus under a bead resonates at
   its bobbing frequency and pumps it forever, and archimedes is defined
   against the undisturbed level anyway. */

function initWave(world) {
	const w = world.wave;
	const innerW = world.tank.x1 - world.tank.x0;
	w.dx = Math.max(7, innerW / 160);
	w.n = Math.floor(innerW / w.dx) + 1;
	w.x0 = world.tank.x0;
	if (!w.h || w.h.length !== w.n) {
		w.h = new Float32Array(w.n);
		w.vh = new Float32Array(w.n);
		w.ld = new Float32Array(w.n);
		w.rd = new Float32Array(w.n);
	} else {
		w.h.fill(0); w.vh.fill(0);
	}
}

function disturb(world, x, amount) {
	const w = world.wave;
	const i = Math.floor((x - w.x0) / w.dx);
	if (i < 0 || i >= w.n) return;
	const a = clamp(amount, -1.4, 1.4);
	w.vh[i] += a;
	if (i + 1 < w.n) w.vh[i + 1] += a * 0.6;
	if (i - 1 >= 0) w.vh[i - 1] += a * 0.6;
}

function waveStep(world) {
	const w = world.wave;
	const K = 0.022, D = 0.018, S = 0.16, PASSES = 2, MAXH = 26;
	const h = w.h, vh = w.vh, ld = w.ld, rd = w.rd, n = w.n;
	for (let i = 0; i < n; i++) {
		vh[i] += -K * h[i] - D * vh[i];
		h[i] += vh[i];
		if (h[i] > MAXH) { h[i] = MAXH; vh[i] *= 0.5; }
		else if (h[i] < -MAXH) { h[i] = -MAXH; vh[i] *= 0.5; }
	}
	for (let p = 0; p < PASSES; p++) {
		for (let i = 0; i < n; i++) {
			if (i > 0) { ld[i] = S * (h[i] - h[i - 1]); vh[i - 1] += ld[i]; }
			if (i < n - 1) { rd[i] = S * (h[i] - h[i + 1]); vh[i + 1] += rd[i]; }
		}
		for (let i = 0; i < n; i++) {
			if (i > 0) h[i - 1] += ld[i];
			if (i < n - 1) h[i + 1] += rd[i];
		}
	}
}

/* ------------------------- particles ------------------------- */

/* true submerged area fraction of a disc; d = center depth below surface */
function submergedFrac(d, r) {
	if (d <= -r) return 0;
	if (d >= r) return 1;
	const q = d / r;
	return 0.5 + (q * Math.sqrt(1 - q * q) + Math.asin(q)) / Math.PI;
}

function rollDensity() {
	const u = Math.random();
	if (u < 0.50) return 0.45 + Math.random() * 0.50;	// floats high
	if (u < 0.65) return 0.95 + Math.random() * 0.13;	// ~neutral, hovers
	return 1.10 + Math.random() * 1.00;			// sinks
}

function pushBead(world, x, y, r, dens) {
	const i = world.n++;
	world.x[i] = x; world.y[i] = y;
	world.px[i] = x; world.py[i] = y;
	world.vx[i] = (Math.random() - 0.5) * 30;
	world.vy[i] = 0;
	world.r[i] = r;
	world.baseSize[i] = r / world.rBar;
	world.dens[i] = dens;
	world.invM[i] = 1 / (world.massScale * dens * r * r);	// 2D mass, pi cancels in weighting
	world.frac[i] = 0;
	world.temp[i] = 0.5;
	world.alpha[i] = 0.82 + Math.random() * 0.16;
	world.pal[i] = (dens < 1 ? 0 : PAL_LIGHT) + ((Math.random() * PAL_LIGHT) | 0);
	if (r > world.rMax) world.rMax = r;
	return i;
}

/* Checkerboard hex bed: alternating bead sizes avoid large initial
   overlaps while count is derived from requested water-body coverage. */
function spawnBed(world) {
	const t = world.tank;
	world.n = 0;
	world.linkN = 0;
	if (world.linkHashKeys) world.linkHashKeys.fill(-1);
	world.rBar = world.typicalRadius;
	syncRMax(world);
	world.acc = 0;
	const innerW = t.x1 - t.x0;
	const canvasArea = world.W * world.H;
	const meanAreaFactor = Math.PI * 1.027;
	const target = Math.min(world.cap, Math.max(1, Math.round(world.fillFraction * canvasArea / (meanAreaFactor * world.rBar * world.rBar))));
	const sx = 2.4 * world.rBar, sy = 1.87 * world.rBar;
	const cols = Math.max(1, Math.floor(innerW / sx));
	const rows = Math.ceil(target / cols);

	for (let row = 0; row < rows && world.n < target; row++) {
		const y = t.y1 - (row + 0.6) * sy;
		for (let col = 0; col < cols && world.n < target; col++) {
			const x = t.x0 + (col + 0.5 + (row % 2 ? 0.5 : 0)) * sx;
			if (x > t.x1 - 2) continue;
			const big = ((col + row) % 2) === 0;
			const r = world.rBar * (big ? 1.05 + Math.random() * (SIZE_FACTOR_MAX - 1.05) : 0.72 + Math.random() * 0.23);
			pushBead(world, x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, r, rollDensity());
		}
	}
	world.pointer.grab = -1;
}

function syncRMax(world) {
	world.rMax = world.rBar * SIZE_FACTOR_MAX * Math.pow(2, Math.abs(world.sizeResponse) * 0.5);
}

function setHeatRate(world, value) {
	world.heatRate = clamp(value, 0, 4);
}

function setSizeResponse(world, value) {
	world.sizeResponse = clamp(value, -1, 1);
	syncRMax(world);
}

function setArchSize(world, value) {
	world.archSize = clamp(value, -1, 1);
}

function setTypicalRadius(world, value) {
	world.typicalRadius = clamp(value, 8, 22);
	world.rBar = world.typicalRadius;
	syncRMax(world);
}

function setFillFraction(world, value) {
	world.fillFraction = clamp(value, 0.3, 0.7);
}

function setMassScale(world, value) {
	world.massScale = clamp(value, 0.4, 2.5);
	for (let i = 0; i < world.n; i++) world.invM[i] = 1 / (world.massScale * world.dens[i] * world.r[i] * world.r[i]);
}

function addBead(world, x, y) {
	if (world.n >= world.cap) return false;
	const t = world.tank;
	const r = world.rBar * (0.8 + Math.random() * (SIZE_FACTOR_MAX - 0.8));
	const nx = clamp(x, t.x0 + r, t.x1 - r);
	const ny = clamp(y, t.y0 + 24, t.y1 - r);
	pushBead(world, nx, ny, r, rollDensity());
	if (ny > world.waterY) disturb(world, nx, 2.2);
	return true;
}

function splash(world) {
	for (let i = 0; i < world.n; i++) {
		world.vy[i] -= 250 + Math.random() * 500;
		world.vx[i] += (Math.random() - 0.5) * 420;
	}
	for (let i = 0; i < world.wave.n; i++) world.wave.vh[i] += (Math.random() - 0.5) * 3;
}

/* ------------------------- spatial grid ------------------------- */

function buildGrid(world) {
	const cs = 2 * world.rMax * world.pairRF;
	const gw = Math.max(1, Math.ceil(world.W / cs));
	const gh = Math.max(1, Math.ceil(world.H / cs));
	world.gw = gw; world.gh = gh;
	if (!world.head || world.head.length !== gw * gh) world.head = new Int32Array(gw * gh);
	const head = world.head;
	head.fill(-1);
	if (!world.nxt || world.nxt.length < world.n) world.nxt = new Int32Array(Math.max(64, world.n * 2));
	const nxt = world.nxt;
	const x = world.x, y = world.y;
	for (let i = 0; i < world.n; i++) {
		let cx = (x[i] / cs) | 0; if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
		let cy = (y[i] / cs) | 0; if (cy < 0) cy = 0; else if (cy >= gh) cy = gh - 1;
		const c = cy * gw + cx;
		nxt[i] = head[c];
		head[c] = i;
	}
}

function pairTest(world, i, j, rf) {
	const dx = world.x[j] - world.x[i], dy = world.y[j] - world.y[i];
	const rr = (world.r[i] + world.r[j]) * rf;
	if (dx * dx + dy * dy >= rr * rr) return;
	if (world.pairN >= world.pairA.length) {
		// grows only when jammed beyond initial capacity, never per frame
		const cap = world.pairA.length * 2;
		const a = new Int32Array(cap), b = new Int32Array(cap);
		a.set(world.pairA); b.set(world.pairB);
		world.pairA = a; world.pairB = b;
	}
	const k = world.pairN++;
	world.pairA[k] = i;
	world.pairB[k] = j;
}

/* each unordered pair visited once: same cell via the list tail, neighbor
   cells only in +x and +y direction */
function collectPairs(world) {
	world.pairN = 0;
	const cs = 2 * world.rMax * world.pairRF;
	const gw = world.gw, gh = world.gh;
	const head = world.head, nxt = world.nxt;
	const x = world.x, y = world.y;
	const rf = world.pairRF;
	for (let i = 0; i < world.n; i++) {
		let cx = (x[i] / cs) | 0; if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
		let cy = (y[i] / cs) | 0; if (cy < 0) cy = 0; else if (cy >= gh) cy = gh - 1;
		const c = cy * gw + cx;
		for (let j = nxt[i]; j !== -1; j = nxt[j]) pairTest(world, i, j, rf);
		if (cx + 1 < gw) {
			for (let j = head[c + 1]; j !== -1; j = nxt[j]) pairTest(world, i, j, rf);
		}
		if (cy + 1 < gh) {
			const base = (cy + 1) * gw;
			if (cx > 0) {
				for (let j = head[base + cx - 1]; j !== -1; j = nxt[j]) pairTest(world, i, j, rf);
			}
			for (let j = head[base + cx]; j !== -1; j = nxt[j]) pairTest(world, i, j, rf);
			if (cx + 1 < gw) {
				for (let j = head[base + cx + 1]; j !== -1; j = nxt[j]) pairTest(world, i, j, rf);
			}
		}
	}
}

/* Persistent pair bonds use a bounded open-addressed table. The table is
   cleared only when a new bed is dealt; stable particle indices keep keys valid. */
function initLinkHash(world) {
	if (world.linkHashKeys) return;
	let size = 1;
	while (size < world.cap * 32) size *= 2;
	world.linkHashKeys = new Int32Array(size);
	world.linkHashValues = new Int32Array(size);
	world.linkHashKeys.fill(-1);
	world.linkHashValues.fill(-1);
	world.linkHashMask = size - 1;
}

function findLink(world, a, b) {
	const cap = world.cap;
	if (a > b) { const swap = a; a = b; b = swap; }
	const key = a * cap + b;
	let slot = (Math.imul(key, 2654435761) >>> 0) & world.linkHashMask;
	const keys = world.linkHashKeys;
	while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & world.linkHashMask;
	world.linkLookupSlot = slot;
	world.linkLookupKey = key;
	world.linkLookupValue = keys[slot] === key ? world.linkHashValues[slot] : -1;
}

function collectThermalBonds(world) {
	initLinkHash(world);
	const temp = world.temp, x = world.x, y = world.y, r = world.r;
	for (let k = 0; k < world.pairN; k++) {
		const a = world.pairA[k], b = world.pairB[k];
		if ((temp[a] + temp[b]) * 0.5 >= 0.55) continue;
		const dx = x[b] - x[a], dy = y[b] - y[a];
		const rr = r[a] + r[b];
		const d2 = dx * dx + dy * dy;
		if (d2 >= rr * rr * 1.1664 || d2 < 1e-9) continue;
		findLink(world, a, b);
		if (world.linkLookupValue >= 0 || world.linkN >= world.linkA.length) continue;
		const link = world.linkN++;
		world.linkA[link] = a;
		world.linkB[link] = b;
		world.linkRest[link] = Math.max(1.01, Math.sqrt(d2) / rr);
		world.linkK[link] = 0;
		world.linkHashKeys[world.linkLookupSlot] = world.linkLookupKey;
		world.linkHashValues[world.linkLookupSlot] = link;
	}
	for (let k = 0; k < world.linkN; k++) {
		const heat = (temp[world.linkA[k]] + temp[world.linkB[k]]) * 0.5;
		const cold = clamp((0.55 - heat) / 0.40, 0, 1);
		world.linkK[k] = cold * cold * 0.72;
	}
}

function exchangeHeat(world, h) {
	const rate = world.heatRate;
	if (rate <= 0) return;
	const temp = world.temp, delta = world.heatDelta;
	const topEnd = world.H * 0.24;
	const bottomStart = world.H * 0.76;
	for (let i = 0; i < world.n; i++) {
		const py = world.y[i];
		if (py < topEnd) {
			const weight = 1 - py / topEnd;
			const target = 0.02 + 0.18 * (py / topEnd);
			temp[i] += (target - temp[i]) * (1 - Math.exp(-rate * weight * h));
		} else if (py > bottomStart) {
			const u = clamp((py - bottomStart) / (world.H - bottomStart), 0, 1);
			const weight = u * u * (3 - 2 * u);
			temp[i] += (1 - temp[i]) * (1 - Math.exp(-rate * weight * h));
		}
		delta[i] = 0;
	}
	for (let k = 0; k < world.pairN; k++) {
		const a = world.pairA[k], b = world.pairB[k];
		const transfer = (temp[b] - temp[a]) * rate * h * 0.12;
		delta[a] += transfer;
		delta[b] -= transfer;
	}
	for (let i = 0; i < world.n; i++) temp[i] = clamp(temp[i] + delta[i], 0, 1);
}

function updateThermalSize(world, i) {
	const s = world.sizeResponse;
	const factor = s ? Math.pow(2, s * (world.temp[i] - 0.5)) : 1;
	const r = world.rBar * factor * world.baseSize[i];
	world.r[i] = r;
	world.invM[i] = 1 / (world.massScale * world.dens[i] * r * r);
}

/* ------------------------- physics ------------------------- */

/* Soft, mass-weighted contact relaxation plus thermal distance bonds and walls. */
function solveLinks(world) {
	const x = world.x, y = world.y, r = world.r, invM = world.invM;
	for (let k = 0; k < world.linkN; k++) {
		const stiffness = world.linkK[k];
		if (stiffness <= 0) continue;
		const a = world.linkA[k], b = world.linkB[k];
		const dx = x[b] - x[a], dy = y[b] - y[a];
		const d2 = dx * dx + dy * dy;
		if (d2 < 1e-9) continue;
		const d = Math.sqrt(d2), target = world.linkRest[k] * (r[a] + r[b]);
		const corr = (d - target) * stiffness / (invM[a] + invM[b]);
		const nx = dx / d, ny = dy / d, wa = invM[a], wb = invM[b];
		x[a] += nx * corr * wa; y[a] += ny * corr * wa;
		x[b] -= nx * corr * wb; y[b] -= ny * corr * wb;
	}
}

function solveContacts(world) {
	const x = world.x, y = world.y, r = world.r, invM = world.invM;
	const pairA = world.pairA, pairB = world.pairB, pairN = world.pairN;
	const t = world.tank;
	for (let it = 0; it < CONTACT_ITER; it++) {
		for (let k = 0; k < pairN; k++) {
			const a = pairA[k], b = pairB[k];
			const dx = x[b] - x[a], dy = y[b] - y[a];
			const rr = r[a] + r[b];
			const d2 = dx * dx + dy * dy;
			if (d2 >= rr * rr || d2 < 1e-9) continue;
			const d = Math.sqrt(d2);
			const nx = dx / d, ny = dy / d;
			const wa = invM[a], wb = invM[b];
			const corr = (rr - d) * CONTACT_SOFT / (wa + wb);
			x[a] -= nx * corr * wa; y[a] -= ny * corr * wa;
			x[b] += nx * corr * wb; y[b] += ny * corr * wb;
		}
		solveLinks(world);
		for (let i = 0; i < world.n; i++) {
			const rad = r[i];
			if (x[i] < t.x0 + rad) x[i] = t.x0 + rad;
			else if (x[i] > t.x1 - rad) x[i] = t.x1 - rad;
			if (y[i] > t.y1 - rad) y[i] = t.y1 - rad;
			else if (y[i] < -80 + rad) y[i] = -80 + rad;
		}
	}
}

/* remove normal relative velocity of touching pairs. PBD projection
   re-injects its corrections as separation velocity (elastic micro
   contacts) which keeps a squeezed pile shimmering forever; hydrogel is
   inelastic, so damp that away after velocities are derived */
function dampContacts(world) {
	const x = world.x, y = world.y, r = world.r, invM = world.invM;
	const vx = world.vx, vy = world.vy;
	const pairA = world.pairA, pairB = world.pairB, pairN = world.pairN;
	for (let k = 0; k < pairN; k++) {
		const a = pairA[k], b = pairB[k];
		const dx = x[b] - x[a], dy = y[b] - y[a];
		const rr = r[a] + r[b];
		const d2 = dx * dx + dy * dy;
		if (d2 >= rr * rr || d2 < 1e-9) continue;
		const d = Math.sqrt(d2);
		const nx = dx / d, ny = dy / d;
		const vn = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny;
		const jn = -vn * CONTACT_DAMP / (invM[a] + invM[b]);
		vx[a] -= jn * nx * invM[a]; vy[a] -= jn * ny * invM[a];
		vx[b] += jn * nx * invM[b]; vy[b] += jn * ny * invM[b];
	}
	for (let k = 0; k < world.linkN; k++) {
		const stiffness = world.linkK[k];
		if (stiffness <= 0) continue;
		const a = world.linkA[k], b = world.linkB[k];
		const dx = x[b] - x[a], dy = y[b] - y[a];
		const d2 = dx * dx + dy * dy;
		if (d2 < 1e-9) continue;
		const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
		const vn = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny;
		const jn = -vn * stiffness / (invM[a] + invM[b]);
		vx[a] -= jn * nx * invM[a]; vy[a] -= jn * ny * invM[a];
		vx[b] += jn * nx * invM[b]; vy[b] += jn * ny * invM[b];
	}
}

function pointerForce(world, i, h) {
	const ptr = world.pointer;
	const x = world.x, y = world.y, vx = world.vx, vy = world.vy;
	if (ptr.grab >= 0) {
		if (ptr.grab !== i) return;
		// soft spring toward the pointer; heavier beads lag a bit
		const mf = Math.min(3, world.massScale * world.dens[i] * (world.r[i] * world.r[i]) / (world.rBar * world.rBar));
		vx[i] += ((ptr.x - x[i]) * 300 - vx[i] * 20) * h / mf;
		vy[i] += ((ptr.y - y[i]) * 300 - vy[i] * 20) * h / mf;
		return;
	}
	// stir: radial push + pointer velocity coupling, inside a 150 px brush
	const dx = x[i] - ptr.x, dy = y[i] - ptr.y;
	const R2 = 150 * 150, d2 = dx * dx + dy * dy;
	if (d2 >= R2) return;
	const d = Math.sqrt(d2) || 1;
	const s = 1 - d / 150, s2 = s * s;
	vx[i] += (dx / d * 2200 * s2 + ptr.vx * 4.5 * s2) * h;
	vy[i] += (dy / d * 1500 * s2 + ptr.vy * 4.5 * s2) * h;
}

function substep(world, h) {
	const n = world.n;
	const x = world.x, y = world.y, vx = world.vx, vy = world.vy;
	const px = world.px, py = world.py;
	const r = world.r, dens = world.dens, frac = world.frac;
	const grav = world.grav;
	const surf = world.waterY;
	const ptrOn = world.pointer.active;

	// 1) gravity vs Archimedes + drag, then integrate. archSize couples
	// buoyancy to radius: lift = (r/rBar)^archSize, zero keeps it size-free
	const arch = world.archSize, rBarInv = 1 / world.rBar;
	for (let i = 0; i < n; i++) {
		updateThermalSize(world, i);
		px[i] = x[i]; py[i] = y[i];
		const f = submergedFrac(y[i] - surf, r[i]);
		frac[i] = f;
		const lift = arch ? Math.pow(r[i] * rBarInv, arch) : 1;
		vy[i] += grav * (1 - RHO_WATER * f * lift / dens[i]) * h;
		const df = 1 / (1 + (DRAG_AIR + DRAG_WATER * f * f) * h);
		vx[i] *= df; vy[i] *= df;
		if (ptrOn) pointerForce(world, i, h);
		x[i] += vx[i] * h; y[i] += vy[i] * h;
	}

	// 2) smooth contact solving
	buildGrid(world);
	collectPairs(world);
	exchangeHeat(world, h);
	collectThermalBonds(world);
	solveContacts(world);

	// 3) derive velocities from corrected positions (no restitution -> calm)
	const inv = 1 / h;
	for (let i = 0; i < n; i++) {
		vx[i] = clamp((x[i] - px[i]) * inv, -MAX_SPEED, MAX_SPEED);
		vy[i] = clamp((y[i] - py[i]) * inv, -MAX_SPEED, MAX_SPEED);
	}
	dampContacts(world);

	// 4) beads near the surface kick the wave field -> ripples. the wave
	// receives the opposite impulse (radiation damping) so this coupling
	// drains bobbing energy instead of pumping it back
	for (let i = 0; i < n; i++) {
		if (Math.abs(y[i] - surf) < r[i] * 0.9) {
			const amp = clamp(-vy[i] * 0.0012 * dens[i] * (r[i] / world.rBar)
				* Math.min(1, Math.abs(vy[i]) / 60), -1.4, 1.4);
			if (amp !== 0) {
				disturb(world, x[i], amp);
				vy[i] += WAVE_REACT * amp;
			}
		}
	}
}

function stepWorld(world, dt) {
	if (dt > 0.05) dt = 0.05;
	const ptr = world.pointer;
	if (ptr.active) {
		ptr.vx = 0.5 * ptr.vx + 0.5 * (ptr.x - ptr.px) / Math.max(dt, 1e-3);
		ptr.vy = 0.5 * ptr.vy + 0.5 * (ptr.y - ptr.py) / Math.max(dt, 1e-3);
	}
	ptr.px = ptr.x; ptr.py = ptr.y;

	world.acc += dt;
	let steps = 0;
	while (world.acc >= SUBSTEP && steps < MAX_STEPS) {
		substep(world, SUBSTEP);
		world.acc -= SUBSTEP;
		steps++;
	}
	if (steps === MAX_STEPS) world.acc = 0;	// drop backlog on slow frames
	waveStep(world);
}

/* ------------------------- pointer ------------------------- */

function pickBead(world, x, y, pad) {
	let best = -1, bd = Infinity;
	for (let i = 0; i < world.n; i++) {
		const dx = world.x[i] - x, dy = world.y[i] - y;
		const R = world.r[i] + pad, dd = dx * dx + dy * dy;
		if (dd < R * R && dd < bd) { bd = dd; best = i; }
	}
	return best;
}

function pointerMove(world, x, y) {
	const ptr = world.pointer;
	if (ptr.down && Math.abs(x - ptr.x) + Math.abs(y - ptr.y) > 2) ptr.moved += 2;
	ptr.x = x; ptr.y = y;
	ptr.active = true;
}

function pointerDown(world, x, y, now) {
	const ptr = world.pointer;
	ptr.x = x; ptr.y = y; ptr.px = x; ptr.py = y;
	ptr.down = true; ptr.active = true;
	ptr.moved = 0; ptr.downT = now;
	ptr.grab = pickBead(world, x, y, 16);
	if (ptr.grab >= 0) {
		world.vx[ptr.grab] *= 0.2;
		world.vy[ptr.grab] *= 0.2;
	}
	disturb(world, x, -2.2);
}

function pointerUp(world, now) {
	const ptr = world.pointer;
	if (ptr.grab >= 0) ptr.grab = -1;
	else if (ptr.moved < 7 && now - ptr.downT < 350) addBead(world, ptr.x, ptr.y);
	ptr.down = false;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		createWorld, resizeWorld, stepWorld, substep,
		spawnBed, addBead, splash, rollDensity, submergedFrac,
		setHeatRate, setSizeResponse, setArchSize, setTypicalRadius, setFillFraction, setMassScale,
		disturb, pickBead, pointerMove, pointerDown, pointerUp,
		SPAWN_CAP, WATER_FRAC, SUBSTEP,
	};
}
