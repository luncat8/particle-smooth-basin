"use strict";

/* Browser rendering: pre-rendered bead sprites, gradients cached at
   resize. No per-frame allocations, no string building in the loop. */

const RENDER_SHRINK = 0.88;	// draw radius vs collision radius -> visual gaps
const SPRITE_SIZE = 96;

const LIGHT_COLORS = ["#8fe0dc", "#a5ecd0", "#f5b8cf", "#c3b4f4", "#f6d9a0", "#bfe3f2"];
const DEEP_COLORS = ["#4fb6c9", "#6f97dd", "#b58ad6", "#d99a63", "#3fa98a", "#7f7fd0"];
const TEMP_COLORS = ["#5686f5", "#55aef2", "#4dcbdc", "#57d6ae", "#88d66d", "#c4d45d", "#e8bf55", "#f49a50", "#ef7055", "#e95170"];

const FONT_MONO = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function rgba(hex, a) {
	const v = parseInt(hex.slice(1), 16);
	return "rgba(" + ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255) + "," + a + ")";
}

/* pre-rendered translucent hydrogel bead: dense refracting rim,
   inner caustic focus, soft specular highlight */
function beadSprite(hex) {
	const S = SPRITE_SIZE, R = S / 2;
	const c = document.createElement("canvas");
	c.width = c.height = S;
	const g = c.getContext("2d");
	let gr = g.createRadialGradient(R * 0.72, R * 0.68, R * 0.08, R, R, R);
	gr.addColorStop(0.00, rgba(hex, 0.06));
	gr.addColorStop(0.45, rgba(hex, 0.22));
	gr.addColorStop(0.78, rgba(hex, 0.50));
	gr.addColorStop(0.94, rgba(hex, 0.68));
	gr.addColorStop(1.00, rgba(hex, 0.78));
	g.fillStyle = gr;
	g.beginPath(); g.arc(R, R, R - 1, 0, TAU); g.fill();

	g.save();
	g.beginPath(); g.arc(R, R, R - 2, 0, TAU); g.clip();
	gr = g.createRadialGradient(R * 1.22, R * 1.26, 1, R * 1.22, R * 1.26, R * 0.55);
	gr.addColorStop(0, "rgba(255,255,255,0.30)");
	gr.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = gr; g.fillRect(0, 0, S, S);
	g.restore();

	g.strokeStyle = "rgba(255,255,255,0.26)";
	g.lineWidth = 1.4;
	g.beginPath(); g.arc(R, R, R - 1.6, 0, TAU); g.stroke();

	g.save();
	g.translate(R * 0.66, R * 0.52); g.rotate(-0.5);
	gr = g.createRadialGradient(0, 0, 0.5, 0, 0, R * 0.24);
	gr.addColorStop(0, "rgba(255,255,255,0.95)");
	gr.addColorStop(1, "rgba(255,255,255,0)");
	g.fillStyle = gr;
	g.beginPath(); g.ellipse(0, 0, R * 0.20, R * 0.115, 0, 0, TAU); g.fill();
	g.restore();

	g.fillStyle = "rgba(255,255,255,0.5)";
	g.beginPath(); g.arc(R * 0.80, R * 0.78, 1.6, 0, TAU); g.fill();
	return c;
}

function buildSprites() {
	const out = [];
	for (let i = 0; i < LIGHT_COLORS.length; i++) out.push(beadSprite(LIGHT_COLORS[i]));
	for (let i = 0; i < DEEP_COLORS.length; i++) out.push(beadSprite(DEEP_COLORS[i]));
	return out;
}

function buildTemperatureSprites() {
	const out = [];
	for (let i = 0; i < TEMP_COLORS.length; i++) out.push(beadSprite(TEMP_COLORS[i]));
	return out;
}

/* all frame-invariant fills, rebuilt on resize */
function makeAssets(ctx, world) {
	const W = world.W, H = world.H, t = world.tank, waterY = world.waterY;
	const a = { sprites: null };

	a.bgGrad = ctx.createLinearGradient(0, 0, 0, H);
	a.bgGrad.addColorStop(0, "#0d1a21");
	a.bgGrad.addColorStop(0.55, "#16323d");
	a.bgGrad.addColorStop(1, "#0a141a");

	a.glowGrad = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, Math.max(W, H) * 0.6);
	a.glowGrad.addColorStop(0, "rgba(120,200,225,0.07)");
	a.glowGrad.addColorStop(1, "rgba(120,200,225,0)");

	a.waterGradA = ctx.createLinearGradient(0, waterY, 0, t.y1);
	a.waterGradA.addColorStop(0, "rgba(126,214,235,0.12)");
	a.waterGradA.addColorStop(0.5, "rgba(66,158,190,0.19)");
	a.waterGradA.addColorStop(1, "rgba(18,84,112,0.33)");

	a.waterGradB = ctx.createLinearGradient(0, waterY, 0, t.y1);
	a.waterGradB.addColorStop(0, "rgba(120,208,235,0.07)");
	a.waterGradB.addColorStop(1, "rgba(20,90,120,0.22)");

	a.floorGrad = ctx.createLinearGradient(0, t.y1, 0, t.y1 + 26);
	a.floorGrad.addColorStop(0, "rgba(110,190,215,0.10)");
	a.floorGrad.addColorStop(1, "rgba(110,190,215,0)");

	a.coldZoneEnd = H * world.coldZoneEnd;		// the drawn band is the physics band
	a.hotZoneStart = H * world.hotZoneStart;
	a.coldZone = ctx.createLinearGradient(0, 0, 0, a.coldZoneEnd);
	a.coldZone.addColorStop(0, "rgba(74,138,255,0.12)");
	a.coldZone.addColorStop(1, "rgba(74,138,255,0)");
	a.hotZone = ctx.createLinearGradient(0, a.hotZoneStart, 0, H);
	a.hotZone.addColorStop(0, "rgba(255,142,70,0)");
	a.hotZone.addColorStop(1, "rgba(255,142,70,0.13)");

	a.tankOuter = tankPath(world, 0);
	a.tankInner = tankPath(world, 3);
	a.tankRim = new Path2D();
	a.tankRim.moveTo(t.x0 - 7, t.y0); a.tankRim.lineTo(t.x0 + 9, t.y0);
	a.tankRim.moveTo(t.x1 - 9, t.y0); a.tankRim.lineTo(t.x1 + 7, t.y0);

	ctx.lineCap = "round";
	ctx.font = FONT_MONO;
	ctx.textAlign = "right";
	return a;
}

function waterPath(ctx, world) {
	const w = world.wave, t = world.tank;
	ctx.beginPath();
	ctx.moveTo(t.x0, world.waterY - w.h[0]);
	for (let i = 1; i < w.n; i++) ctx.lineTo(w.x0 + i * w.dx, world.waterY - w.h[i]);
	ctx.lineTo(t.x1, t.y1);
	ctx.lineTo(t.x0, t.y1);
	ctx.closePath();
}

function tankPath(world, off) {
	const t = world.tank;
	const x0 = t.x0 + off, x1 = t.x1 - off, y0 = t.y0, y1 = t.y1 - off, r = 14;
	const path = new Path2D();
	path.moveTo(x0, y0);
	path.lineTo(x0, y1 - r);
	path.quadraticCurveTo(x0, y1, x0 + r, y1);
	path.lineTo(x1 - r, y1);
	path.quadraticCurveTo(x1, y1, x1, y1 - r);
	path.lineTo(x1, y0);
	return path;
}

function drawTank(ctx, world, a) {
	const t = world.tank;
	ctx.fillStyle = a.floorGrad;
	ctx.fillRect(t.x0, t.y1 + 2, t.x1 - t.x0, 26);

	ctx.strokeStyle = "rgba(178,222,235,0.30)";
	ctx.lineWidth = 3;
	ctx.stroke(a.tankOuter);
	ctx.strokeStyle = "rgba(255,255,255,0.09)";
	ctx.lineWidth = 1;
	ctx.stroke(a.tankInner);

	ctx.strokeStyle = "rgba(210,240,250,0.5)";
	ctx.lineWidth = 3;
	ctx.stroke(a.tankRim);
}

function render(ctx, world, a) {
	const W = world.W, H = world.H, t = world.tank, w = world.wave;
	const waterY = world.waterY;

	ctx.fillStyle = a.bgGrad; ctx.fillRect(0, 0, W, H);
	ctx.fillStyle = a.glowGrad; ctx.fillRect(0, 0, W, H);

	ctx.fillStyle = "rgba(150,200,215,0.045)";
	ctx.fill(a.tankOuter);

	waterPath(ctx, world);
	ctx.fillStyle = a.waterGradA;
	ctx.fill();
	ctx.fillStyle = a.coldZone;
	ctx.fillRect(t.x0, 0, t.x1 - t.x0, a.coldZoneEnd);
	ctx.fillStyle = a.hotZone;
	ctx.fillRect(t.x0, a.hotZoneStart, t.x1 - t.x0, H - a.hotZoneStart);

	const linkN = world.linkActiveN;
	if (linkN) {
		const linkStride = linkN > 5000 ? 2 : 1;
		for (let pass = 0; pass < 3; pass++) {
			const low = pass === 0 ? 0 : pass === 1 ? 0.22 : 0.50;
			const high = pass === 0 ? 0.22 : pass === 1 ? 0.50 : Infinity;
			ctx.beginPath();
			for (let k = 0; k < linkN; k += linkStride) {
				const strength = world.linkK[k];
				if (strength < low || strength >= high) continue;
				const i = world.linkA[k], j = world.linkB[k];
				ctx.moveTo(world.x[i], world.y[i]);
				ctx.lineTo(world.x[j], world.y[j]);
			}
			ctx.strokeStyle = pass === 0 ? "rgba(130,220,230,0.10)" : pass === 1 ? "rgba(160,235,238,0.20)" : "rgba(205,250,245,0.32)";
			ctx.lineWidth = pass === 2 ? 1.5 : 1;
			ctx.stroke();
		}
	}

	const sprites = a.sprites, tempSprites = a.tempSprites;
	for (let i = 0; i < world.n; i++) {
		const R = world.r[i] * RENDER_SHRINK;
		const sprite = world.temperatureView
			? tempSprites[Math.min(tempSprites.length - 1, (world.temp[i] * tempSprites.length) | 0)]
			: sprites[world.pal[i]];
		ctx.globalAlpha = world.alpha[i];
		ctx.drawImage(sprite, world.x[i] - R, world.y[i] - R, R * 2, R * 2);
	}
	ctx.globalAlpha = 1;

	waterPath(ctx, world);
	ctx.fillStyle = a.waterGradB;
	ctx.fill();

	for (let pass = 0; pass < 2; pass++) {
		ctx.beginPath();
		ctx.moveTo(w.x0, waterY - w.h[0]);
		for (let i = 1; i < w.n; i++) ctx.lineTo(w.x0 + i * w.dx, waterY - w.h[i]);
		ctx.strokeStyle = pass === 0 ? "rgba(190,240,255,0.12)" : "rgba(220,248,255,0.65)";
		ctx.lineWidth = pass === 0 ? 6 : 1.8;
		ctx.stroke();
	}

	drawTank(ctx, world, a);

	ctx.fillStyle = "rgba(170,220,235,0.42)";
	ctx.fillText("WATER LEVEL \u00B7 50%", t.x1 - 14, waterY - 10);
}
