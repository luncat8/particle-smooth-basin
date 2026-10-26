"use strict";

/* Hydrogel basin physics. Pure JS, no DOM — node can require it
   (experiments/). Pipeline per substep: forces and heat -> predict ->
   contact and thermal-bond relaxation -> velocity derivation. */

const TAU = Math.PI * 2;

const WATER_FRAC = 0.30;		// waterline share of screen height: a water column above the bed
const DEFAULT_FILL = 0.40;	// canvas coverage: a bed that leaves room to convect
const DEFAULT_RADIUS = 14;
const DEFAULT_SIZE = -1;	// hot shrinks: with a negative arch size, hot beads rise
const DEFAULT_ARCH = -10;
const SIZE_FACTOR_MAX = 1.28;	// upper bound on bead r/rBar; pair-grid cell size assumes it
const SPAWN_CAP = 1500;
const RHO_WATER = 1;
const ARCH_LIFT_LIMIT = 8;
const ARCH_SIZE_MIN = -10;
const ARCH_SIZE_MAX = 2;
const DRAG_AIR = 0.05;		// 1/s
const DRAG_WATER = 2.7;		// 1/s, scaled by submerged fraction^2
const SUBSTEP = 1 / 120;
const WAVE_SUBSTEPS = 2;	// wave field advances at 60 Hz in fixed steps
const MAX_STEPS = 6;
const CONTACT_ITER = 3;
const CONTACT_SOFT = 0.55;	// 0..1 squishiness of contacts
const CONTACT_DAMP = 1;		// 0..1 inelasticity of touching pairs (hydrogel: no bounce)
const LINK_CREATE_RATIO = 1.08;	// bond creation distance / sum of radii
const LINK_HEAT_MAX = 0.55;	// bonds only form below this pair mean temperature
const LINK_HEAT_RAMP = 0.40;	// stiffness falls to zero over this span below the ceiling
const LINK_STRENGTH = 0.40;	// stiffness at zero temperature (times the ramp^exponent)
const LINK_TEMP_EXP = 2.5;	// how sharply strength falls with temperature
const THERMAL_LIFT = 0.30;	// hot beads are this much lighter than cold ones (0..1)
const COLD_POWER = 0.7;		// shipped zone rates (the sliders' defaults)
const HOT_POWER = 2;
const LINK_ACTIVE_K = 0.02;	// weaker bonds keep their rest but skip the constraint solver
const MAX_SPEED = 1600;		// px/s
const WAVE_REACT = 22;		// px/s per ripple kick unit: reaction impulse on the bead
/* The bands are shared with render.js, so the visible gradients match the thermal
   zones applied by the solver. */
const COLD_ZONE_END = 0.30;	// share of H cooled from the top, and drawn as the cold gradient
const HOT_ZONE_START = 0.75;	// share of H where the heated bottom band starts
const PAL_LIGHT = 6;		// sprite palette: 0..5 light beads, 6..11 deep

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------- world ------------------------- */

function createWorld(W, H) {
	const cap = SPAWN_CAP;
	const world = {
		W: 0, H: 0,
		tank: { x0: 0, x1: 0, y0: 0, y1: 0 },
		waterY: 0, waterFrac: WATER_FRAC,
		grav: 1850,			// px/s^2, rescaled with screen height
		rBar: DEFAULT_RADIUS, rMax: 24,
		fillFraction: DEFAULT_FILL, typicalRadius: DEFAULT_RADIUS, massScale: 1,
		sourceRate: 1, conductionRate: 0.25, sizeResponse: DEFAULT_SIZE, archSize: DEFAULT_ARCH, buoyancy: 0.2, thermalLift: THERMAL_LIFT,
		coldZoneEnd: COLD_ZONE_END, hotZoneStart: HOT_ZONE_START,
		coldPower: COLD_POWER, hotPower: HOT_POWER,
		linkStrength: LINK_STRENGTH, linkTempExp: LINK_TEMP_EXP, linkHeatMax: LINK_HEAT_MAX,
		temperatureView: true,
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
		cell: new Int32Array(cap), cellX: new Int32Array(cap), cellY: new Int32Array(cap),
		pairA: new Int32Array(cap * 8), pairB: new Int32Array(cap * 8),
		pairR: new Float64Array(cap * 8), pairN: 0,
		pairRF: 1.25,		// includes near-contact heat and thermal-bond candidates
		linkA: new Int32Array(cap * 8), linkB: new Int32Array(cap * 8),
		linkRest: new Float32Array(cap * 8), linkK: new Float32Array(cap * 8), linkN: 0, linkActiveN: 0,
		linkHashKeys: null, linkHashRest: null, linkHashMask: 0,
		linkPrevKeys: null, linkPrevRest: null,
		pointer: { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, grab: -1, moved: 0, downT: 0 },
		acc: 0, waveTick: 0,
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
	world.waterY = H * world.waterFrac;
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

/* Alternating big/small radii keep the bed mixed instead of one uniform lattice. */
function bedRadius(world, index) {
	const big = (index % 2) === 0;
	return world.rBar * (big
		? 1.05 + Math.random() * (SIZE_FACTOR_MAX - 1.05)
		: 0.72 + Math.random() * 0.23);
}

/* Rows packed from each bead's own radius. The old fixed 2.4 rBar lattice was
   narrower than the largest beads, so every spawn started interpenetrating and
   the bed blew itself out of the water within a second. */
function spawnBed(world) {
	const t = world.tank;
	world.n = 0;
	world.linkN = 0;
	world.linkActiveN = 0;
	world.waveTick = 0;
	if (world.linkHashKeys) {
		world.linkHashKeys.fill(-1);
		world.linkPrevKeys.fill(-1);
	}
	world.rBar = world.typicalRadius;
	syncRMax(world);
	world.acc = 0;
	const canvasArea = world.W * world.H;
	const meanAreaFactor = Math.PI * 1.027;
	const target = Math.min(world.cap, Math.max(1, Math.round(world.fillFraction * canvasArea / (meanAreaFactor * world.rBar * world.rBar))));
	const gap = world.rBar * 0.16;
	const row = [];	// r, cx pairs for one row, reused across rows
	let y = t.y1 - gap;
	while (world.n < target) {
		row.length = 0;
		let x = t.x0 + gap, rowMax = 0;
		for (;;) {
			const r = bedRadius(world, world.n + row.length / 2);
			if (x + 2 * r > t.x1 - gap) break;
			row.push(r, x + r);
			if (r > rowMax) rowMax = r;
			x += 2 * r + gap;
		}
		if (row.length === 0) break;
		y -= rowMax;
		for (let k = 0; k < row.length && world.n < target; k += 2) {
			pushBead(world, row[k + 1], y, row[k], rollDensity());
		}
		y -= rowMax + gap;
	}
	world.pointer.grab = -1;
}

function syncRMax(world) {
	world.rMax = world.rBar * SIZE_FACTOR_MAX * Math.pow(2, Math.abs(world.sizeResponse) * 0.5);
}

function setSourceRate(world, value) {
	world.sourceRate = clamp(value, 0, 4);
}

function setConductionRate(world, value) {
	world.conductionRate = clamp(value, 0, 4);
}

function setSizeResponse(world, value) {
	world.sizeResponse = clamp(value, -1, 1);
	syncRMax(world);
	refreshThermalSizes(world);
}

function setArchSize(world, value) {
	world.archSize = clamp(value, ARCH_SIZE_MIN, ARCH_SIZE_MAX);
}

function setColdZoneEnd(world, value) {
	world.coldZoneEnd = clamp(value, 0.10, 0.80);
}

function setHotZoneStart(world, value) {
	world.hotZoneStart = clamp(value, 0.40, 0.95);
}

function setColdPower(world, value) {
	world.coldPower = clamp(value, 0, 4);
}

function setHotPower(world, value) {
	world.hotPower = clamp(value, 0, 4);
}

function setBondStrength(world, value) {
	world.linkStrength = clamp(value, 0.2, 1);
}

function setBondTempExp(world, value) {
	world.linkTempExp = clamp(value, 0.5, 6);
}

function setWaterFrac(world, value) {
	world.waterFrac = clamp(value, 0.25, 0.75);
	world.waterY = world.H * world.waterFrac;
}

function setBuoyancy(world, value) {
	world.buoyancy = clamp(value, 0, 2);
}

function setThermalLift(world, value) {
	world.thermalLift = clamp(value, 0, 1);
}

function setTypicalRadius(world, value) {
	world.typicalRadius = clamp(value, 8, 22);
	world.rBar = world.typicalRadius;
	syncRMax(world);
	refreshThermalSizes(world);
}

function setFillFraction(world, value) {
	world.fillFraction = clamp(value, 0.08, 0.7);
}

function setMassScale(world, value) {
	world.massScale = clamp(value, 0.4, 2.5);
	refreshThermalSizes(world);
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
	const cell = world.cell, cellX = world.cellX, cellY = world.cellY;
	for (let i = 0; i < world.n; i++) {
		let cx = (x[i] / cs) | 0; if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
		let cy = (y[i] / cs) | 0; if (cy < 0) cy = 0; else if (cy >= gh) cy = gh - 1;
		const c = cy * gw + cx;
		cell[i] = c; cellX[i] = cx; cellY[i] = cy;
		nxt[i] = head[c];
		head[c] = i;
	}
}

function growPairBuffers(world) {
	const cap = world.pairA.length * 2;
	const a = new Int32Array(cap), b = new Int32Array(cap), r = new Float64Array(cap);
	a.set(world.pairA); b.set(world.pairB); r.set(world.pairR);
	world.pairA = a; world.pairB = b; world.pairR = r;
	const la = new Int32Array(cap), lb = new Int32Array(cap);
	const rest = new Float32Array(cap), k = new Float32Array(cap);
	la.set(world.linkA); lb.set(world.linkB);
	rest.set(world.linkRest); k.set(world.linkK);
	world.linkA = la; world.linkB = lb; world.linkRest = rest; world.linkK = k;
}

function pairTest(world, i, j, rf) {
	const dx = world.x[j] - world.x[i], dy = world.y[j] - world.y[i];
	const sumR = world.r[i] + world.r[j], rr = sumR * rf;
	if (dx * dx + dy * dy >= rr * rr) return;
	if (world.pairN >= world.pairA.length) growPairBuffers(world);	// exceptional jam
	const k = world.pairN++;
	world.pairA[k] = i;
	world.pairB[k] = j;
	world.pairR[k] = sumR;
}

/* each unordered pair visited once: same cell via the list tail, neighbor
   cells only in +x and +y direction */
function collectPairs(world) {
	world.pairN = 0;
	const gw = world.gw, gh = world.gh;
	const head = world.head, nxt = world.nxt;
	const cell = world.cell, cellX = world.cellX, cellY = world.cellY;
	const rf = world.pairRF;
	for (let i = 0; i < world.n; i++) {
		const c = cell[i], cx = cellX[i], cy = cellY[i];
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

/* Thermal bonds are rebuilt from the current pair list each substep.
   Two open-addressed tables preserve each cold pair's rest distance without
   accumulating warm or separated links. Warm pairs thaw immediately. */
function initLinkHash(world) {
	if (world.linkHashKeys) return;
	let size = 1;
	while (size < world.pairA.length * 2) size *= 2;
	world.linkHashKeys = new Int32Array(size);
	world.linkPrevKeys = new Int32Array(size);
	world.linkHashRest = new Float32Array(size);
	world.linkPrevRest = new Float32Array(size);
	world.linkHashKeys.fill(-1);
	world.linkPrevKeys.fill(-1);
	world.linkHashMask = size - 1;
}

function linkKey(world, a, b) {
	if (a > b) { const swap = a; a = b; b = swap; }
	return a * world.cap + b;
}

function linkSlot(world, key) {
	return (Math.imul(key, 2654435761) >>> 0) & world.linkHashMask;
}

function findLinkRest(world, key) {
	const keys = world.linkPrevKeys, mask = world.linkHashMask;
	let slot = linkSlot(world, key);
	while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & mask;
	return keys[slot] === key ? world.linkPrevRest[slot] : -1;
}

function storeLinkRest(world, key, rest) {
	const keys = world.linkHashKeys, mask = world.linkHashMask;
	let slot = linkSlot(world, key);
	while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & mask;
	keys[slot] = key;
	world.linkHashRest[slot] = rest;
}

function swapLinkHash(world) {
	const keys = world.linkHashKeys;
	world.linkHashKeys = world.linkPrevKeys;
	world.linkPrevKeys = keys;
	const rest = world.linkHashRest;
	world.linkHashRest = world.linkPrevRest;
	world.linkPrevRest = rest;
	world.linkHashKeys.fill(-1);
}

function collectThermalBonds(world) {
	initLinkHash(world);
	swapLinkHash(world);
	const oldLinkN = world.linkN;
	world.linkN = 0;
	world.linkActiveN = 0;
	const temp = world.temp, x = world.x, y = world.y;
	const pairA = world.pairA, pairB = world.pairB, pairR = world.pairR;
	const createR2 = LINK_CREATE_RATIO * LINK_CREATE_RATIO;
	const breakR2 = world.pairRF * world.pairRF;
	const heatMax = world.linkHeatMax, strength = world.linkStrength, exponent = world.linkTempExp;
	for (let k = 0; k < world.pairN; k++) {
		const a = pairA[k], b = pairB[k];
		const heat = (temp[a] + temp[b]) * 0.5;
		if (heat >= heatMax) continue;
		const dx = x[b] - x[a], dy = y[b] - y[a];
		const d2 = dx * dx + dy * dy;
		const sumR = pairR[k], sumR2 = sumR * sumR;
		if (d2 < 1e-9 || d2 >= sumR2 * breakR2) continue;
		const key = linkKey(world, a, b);
		let rest = findLinkRest(world, key);
		if (rest < 0) {
			if (d2 >= sumR2 * createR2) continue;
			rest = Math.max(1.01, Math.sqrt(d2 / sumR2));
		}
		storeLinkRest(world, key, rest);
		const cold = clamp((heatMax - heat) / LINK_HEAT_RAMP, 0, 1);
		const stiffness = strength * Math.pow(cold, exponent);
		const link = world.linkN++;
		world.linkA[link] = a;
		world.linkB[link] = b;
		world.linkRest[link] = rest;
		world.linkK[link] = stiffness;
	}
	if (oldLinkN > world.linkN) world.linkK.fill(0, world.linkN, oldLinkN);
	compactActiveLinks(world);
}

function compactActiveLinks(world) {
	const a = world.linkA, b = world.linkB, rest = world.linkRest, k = world.linkK;
	let active = 0;
	for (let i = 0; i < world.linkN; i++) {
		if (k[i] < LINK_ACTIVE_K) continue;
		if (active !== i) {
			const ai = a[i], bi = b[i], ri = rest[i], ki = k[i];
			a[i] = a[active]; b[i] = b[active]; rest[i] = rest[active]; k[i] = k[active];
			a[active] = ai; b[active] = bi; rest[active] = ri; k[active] = ki;
		}
		active++;
	}
	world.linkActiveN = active;
}

function exchangeHeat(world, h) {
	const sourceRate = world.sourceRate, conductionRate = world.conductionRate;
	const coldRate = sourceRate * world.coldPower;
	const hotRate = sourceRate * world.hotPower;
	if (coldRate <= 0 && hotRate <= 0 && conductionRate <= 0) return;
	const temp = world.temp, delta = world.heatDelta;
	const topEnd = world.H * world.coldZoneEnd;
	const bottomStart = world.H * world.hotZoneStart;
	for (let i = 0; i < world.n; i++) {
		const py = world.y[i];
		/* The cold weight stays usable at the band's lower edge (0.4, not 0): a band that
		   fades to nothing above the bed never cools its top layer fast enough to bond. */
		if (coldRate > 0 && py < topEnd) {
			const u = clamp(py / topEnd, 0, 1);
			temp[i] += (0.02 + 0.18 * u - temp[i]) * (1 - Math.exp(-coldRate * (1 - 0.6 * u) * h));
		} else if (hotRate > 0 && py > bottomStart) {
			const u = clamp((py - bottomStart) / (world.H - bottomStart), 0, 1);
			temp[i] += (1 - temp[i]) * (1 - Math.exp(-hotRate * u * u * (3 - 2 * u) * h));
		}
		delta[i] = 0;
	}
	if (conductionRate <= 0) return;
	const conductivity = conductionRate * h * 0.12;
	for (let k = 0; k < world.pairN; k++) {
		const a = world.pairA[k], b = world.pairB[k];
		const transfer = (temp[b] - temp[a]) * conductivity;
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

/* Control changes refresh size immediately; the per-substep refresh is
   skipped entirely when thermal sizing is off. */
function refreshThermalSizes(world) {
	for (let i = 0; i < world.n; i++) updateThermalSize(world, i);
}

/* ------------------------- physics ------------------------- */

/* Soft, mass-weighted contact relaxation plus thermal distance bonds and walls. */
function solveLinks(world) {
	const x = world.x, y = world.y, r = world.r, invM = world.invM;
	for (let k = 0; k < world.linkActiveN; k++) {
		const stiffness = world.linkK[k];
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
	const pairA = world.pairA, pairB = world.pairB, pairR = world.pairR, pairN = world.pairN;
	const t = world.tank;
	for (let it = 0; it < CONTACT_ITER; it++) {
		for (let k = 0; k < pairN; k++) {
			const a = pairA[k], b = pairB[k];
			const dx = x[b] - x[a], dy = y[b] - y[a];
			const rr = pairR[k];
			const d2 = dx * dx + dy * dy;
			if (d2 >= rr * rr || d2 < 1e-9) continue;
			const d = Math.sqrt(d2);
			const nx = dx / d, ny = dy / d;
			const wa = invM[a], wb = invM[b];
			const corr = (rr - d) * CONTACT_SOFT / (wa + wb);
			x[a] -= nx * corr * wa; y[a] -= ny * corr * wa;
			x[b] += nx * corr * wb; y[b] += ny * corr * wb;
		}
		if (world.linkActiveN) solveLinks(world);
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
	const x = world.x, y = world.y, invM = world.invM;
	const vx = world.vx, vy = world.vy;
	const pairA = world.pairA, pairB = world.pairB, pairR = world.pairR, pairN = world.pairN;
	for (let k = 0; k < pairN; k++) {
		const a = pairA[k], b = pairB[k];
		const dx = x[b] - x[a], dy = y[b] - y[a];
		const rr = pairR[k];
		const d2 = dx * dx + dy * dy;
		if (d2 >= rr * rr || d2 < 1e-9) continue;
		const d = Math.sqrt(d2);
		const nx = dx / d, ny = dy / d;
		const vn = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny;
		const jn = -vn * CONTACT_DAMP / (invM[a] + invM[b]);
		vx[a] -= jn * nx * invM[a]; vy[a] -= jn * ny * invM[a];
		vx[b] += jn * nx * invM[b]; vy[b] += jn * ny * invM[b];
	}
	for (let k = 0; k < world.linkActiveN; k++) {
		const stiffness = world.linkK[k];
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
	const ptrOn = world.pointer.down;

	// 1) gravity vs Archimedes + drag, then integrate. archSize couples
	// buoyancy to radius; the lift multiplier is bounded for extreme exponents.
	if (world.sizeResponse !== 0) {
		for (let i = 0; i < n; i++) updateThermalSize(world, i);
	}
	const arch = world.archSize, buoyancy = world.buoyancy, rBarInv = 1 / world.rBar;
	/* Heat thins a bead: the effective density of a fully hot bead is (1 - lift), of a
	   fully cold one (1 + lift). This is what lets a heated floor overturn instead of
	   only nudging neighbours through the size coupling. */
	const thermal = buoyancy ? world.thermalLift * 2 : 0;
	const temp = world.temp;
	for (let i = 0; i < n; i++) {
		px[i] = x[i]; py[i] = y[i];
		const f = submergedFrac(y[i] - surf, r[i]);
		frac[i] = f;
		const lift = arch && buoyancy
			? clamp(Math.pow(r[i] * rBarInv, arch), 1 / ARCH_LIFT_LIMIT, ARCH_LIFT_LIMIT)
			: 1;
		const densEff = thermal ? dens[i] * (1 - thermal * (temp[i] - 0.5)) : dens[i];
		vy[i] += grav * (1 - buoyancy * RHO_WATER * f * lift / densEff) * h;
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
	if (ptr.down) {
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
		if (++world.waveTick >= WAVE_SUBSTEPS) {
			world.waveTick = 0;
			waveStep(world);
		}
	}
	if (steps === MAX_STEPS) world.acc = 0;	// drop backlog on slow frames
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
}

function pointerDown(world, x, y, now) {
	const ptr = world.pointer;
	ptr.x = x; ptr.y = y; ptr.px = x; ptr.py = y;
	ptr.vx = 0; ptr.vy = 0;
	ptr.down = true;
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
	ptr.vx = 0; ptr.vy = 0;
	if (ptr.grab >= 0) ptr.grab = -1;
	else if (ptr.moved < 7 && now - ptr.downT < 350) addBead(world, ptr.x, ptr.y);
	ptr.down = false;
}

/* ------------------------- settings ------------------------- */

/* One flat object holds everything the page's controls set, so copying a scene and
   pasting it back (or into another window) is exact. Keys are short on purpose: this
   string gets pasted into chat. `readSettings` rounds, `applySettings` clamps through
   the same setters the sliders use. */
const SCENARIO_PRESETS = {
	convectionThermal: {
		fill: 0.4, radius: 14, water: 0.3, coldEnd: 0.3, hotStart: 0.75,
		coldPower: 0.7, hotPower: 2, lift: 0.3, bonds: 0.4, bondTemp: 2.5,
		conduction: 0.25, size: -1, arch: -10, buoyancy: 0.2, mass: 1, tempView: true,
	},
	convectionHeat: {
		fill: 0.3, radius: 14, water: 0.3, coldEnd: 0.3, hotStart: 0.75,
		coldPower: 1, hotPower: 2, lift: 0.8, bonds: 0.4, bondTemp: 2.5,
		conduction: 0.1, size: -1, arch: -4, buoyancy: 0.55, mass: 1, tempView: true,
	},
	convectionThermalGrow: {
		fill: 0.4, radius: 14, water: 0.3, coldEnd: 0.4, hotStart: 0.75,
		coldPower: 1, hotPower: 2, lift: 0.5, bonds: 0.5, bondTemp: 2, conduction: 1,
		size: 1, arch: 2, buoyancy: 0.85, mass: 1, tempView: true,
	},
	convectionBalanced: {
		fill: 0.56, radius: 14, water: 0.3, coldEnd: 0.4, hotStart: 0.75,
		coldPower: 1, hotPower: 2, lift: 0.7, bonds: 0.9, bondTemp: 1.5, conduction: 1.9,
		size: -1, arch: -5, buoyancy: 0.3, mass: 1, tempView: true,
	},
};
const SETTINGS = SCENARIO_PRESETS.convectionThermal;

const round = (value, digits) => Number(Number(value).toFixed(digits));

function readSettings(world) {
	return {
		fill: round(world.fillFraction, 3),
		radius: Math.round(world.typicalRadius),
		water: round(world.waterFrac, 3),
		coldEnd: round(world.coldZoneEnd, 2),
		hotStart: round(world.hotZoneStart, 2),
		coldPower: round(world.coldPower, 2),
		hotPower: round(world.hotPower, 2),
		lift: round(world.thermalLift, 2),
		bonds: round(world.linkStrength, 2),
		bondTemp: round(world.linkTempExp, 1),
		conduction: round(world.conductionRate, 2),
		size: round(world.sizeResponse, 2),
		arch: round(world.archSize, 1),
		buoyancy: round(world.buoyancy, 2),
		mass: round(world.massScale, 2),
		tempView: !!world.temperatureView,
	};
}

/* Tolerant by design: unknown keys are ignored and missing keys keep their value, so a
   hand-edited or older string still applies. Returns the keys it did not recognise. */
function applySettings(world, settings) {
	const known = Object.keys(SETTINGS);
	const ignored = [];
	for (const key of Object.keys(settings || {})) if (known.indexOf(key) < 0) ignored.push(key);
	const value = key => (settings && typeof settings[key] === "number" && isFinite(settings[key]) ? settings[key] : undefined);
	if (value("fill") !== undefined) setFillFraction(world, value("fill"));
	if (value("radius") !== undefined) setTypicalRadius(world, value("radius"));
	if (value("water") !== undefined) setWaterFrac(world, value("water"));
	world.coldZoneEnd = value("coldEnd") !== undefined ? clamp(value("coldEnd"), 0.10, 0.80) : world.coldZoneEnd;
	world.hotZoneStart = value("hotStart") !== undefined ? clamp(value("hotStart"), 0.40, 0.95) : world.hotZoneStart;
	if (value("coldPower") !== undefined) setColdPower(world, value("coldPower"));
	if (value("hotPower") !== undefined) setHotPower(world, value("hotPower"));
	if (value("lift") !== undefined) setThermalLift(world, value("lift"));
	if (value("bonds") !== undefined) setBondStrength(world, value("bonds"));
	if (value("bondTemp") !== undefined) setBondTempExp(world, value("bondTemp"));
	if (value("conduction") !== undefined) setConductionRate(world, value("conduction"));
	if (value("size") !== undefined) setSizeResponse(world, value("size"));
	if (value("arch") !== undefined) setArchSize(world, value("arch"));
	if (value("buoyancy") !== undefined) setBuoyancy(world, value("buoyancy"));
	if (value("mass") !== undefined) setMassScale(world, value("mass"));
	if (settings && typeof settings.tempView === "boolean") world.temperatureView = settings.tempView;
	return ignored;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		createWorld, resizeWorld, stepWorld, substep,
		spawnBed, addBead, splash, rollDensity, submergedFrac,
		setSourceRate, setConductionRate, setSizeResponse, setArchSize, setBuoyancy,
		setTypicalRadius, setFillFraction, setMassScale, setWaterFrac,
		setColdZoneEnd, setHotZoneStart, setColdPower, setHotPower, setThermalLift,
		setBondStrength, setBondTempExp,
		SETTINGS, SCENARIO_PRESETS, readSettings, applySettings,
		disturb, pickBead, pointerMove, pointerDown, pointerUp,
		SPAWN_CAP, WATER_FRAC, DEFAULT_FILL, DEFAULT_RADIUS, SUBSTEP,
		COLD_ZONE_END, HOT_ZONE_START, LINK_HEAT_MAX, LINK_STRENGTH, LINK_TEMP_EXP, THERMAL_LIFT,
	};
}
