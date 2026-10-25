var TAU = Math.PI * 2;
var clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let grainPattern = null;
function grain(ctx) {
  if (grainPattern) return grainPattern;
  const c = document.createElement("canvas");
  c.width = c.height = 120;
  const g = c.getContext("2d");
  const img = g.createImageData(120, 120);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 130 + Math.random() * 125;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 44;
  }
  g.putImageData(img, 0, 0);
  grainPattern = ctx.createPattern(c, "repeat");
  return grainPattern;
}

let bubbleSprite = null;
function bubble() {
  if (bubbleSprite) return bubbleSprite;
  const S = 32;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(S * 0.42, S * 0.38, 0, S * 0.5, S * 0.5, S * 0.5);
  gr.addColorStop(0, "rgba(233,255,253,0.75)");
  gr.addColorStop(0.28, "rgba(160,238,236,0.18)");
  gr.addColorStop(0.72, "rgba(140,225,230,0.10)");
  gr.addColorStop(0.9, "rgba(226,255,252,0.5)");
  gr.addColorStop(1, "rgba(226,255,252,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  bubbleSprite = c;
  return c;
}

function buildWaterBody(sink, sim) {
  const w = sim.water;
  sink.moveTo(w.x0 - 10, w.base + w.h[0]);
  for (let i = 1; i < w.cols; i++) sink.lineTo(w.x0 + i * w.dx, w.base + w.h[i]);
  sink.lineTo(w.x1 + 10, sim.pot.bottomY + 400);
  sink.lineTo(w.x0 - 10, sim.pot.bottomY + 400);
  sink.closePath();
}

function buildSurface(sink, sim) {
  const w = sim.water;
  sink.moveTo(w.x0 - 10, w.base + w.h[0]);
  for (let i = 1; i < w.cols; i++) sink.lineTo(w.x0 + i * w.dx, w.base + w.h[i]);
}

function traceOuter(ctx, pot) {
  const pts = pot.outer;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function drawScene(ctx, sim) {
  const W = sim.W, H = sim.H;
  const pot = sim.pot;
  const t = sim.time;
  const w = sim.water;
  ctx.clearRect(0, 0, W, H);

  const waterBody = new Path2D();
  buildWaterBody(waterBody, sim);
  const surfLine = new Path2D();
  buildSurface(surfLine, sim);
  const interior = new Path2D();
  traceOutline(interior, pot, pot.rimY - H * 0.35);

  const bg = ctx.createLinearGradient(0, 0, W * 0.35, H);
  bg.addColorStop(0, "#082a34");
  bg.addColorStop(0.45, "#05191f");
  bg.addColorStop(1, "#020d12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(pot.cx, -H * 0.22, 10, pot.cx, -H * 0.22, H * 1.05);
  glow.addColorStop(0, "rgba(126,238,224,0.15)");
  glow.addColorStop(0.42, "rgba(70,180,190,0.055)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const rr = pot.rimHW * (1.22 + i * 0.4) + Math.sin(t * 0.32 + i) * 7;
    ctx.strokeStyle = `rgba(96,214,208,${0.032 - i * 0.006})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(pot.cx, H * 0.5, rr, rr * 0.84, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(0, pot.bottomY + 14);
  ctx.scale(1, 0.2);
  const sh = ctx.createRadialGradient(pot.cx, 0, 4, pot.cx, 0, pot.baseHW * 1.75);
  sh.addColorStop(0, "rgba(0,0,0,0.6)");
  sh.addColorStop(0.45, "rgba(0,0,0,0.26)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(pot.cx, 0, pot.baseHW * 1.75, 0, TAU);
  ctx.fill();
  ctx.restore();

  const glass = ctx.createLinearGradient(pot.cx - pot.rimHW, 0, pot.cx + pot.rimHW, 0);
  glass.addColorStop(0, "rgba(190,245,245,0.10)");
  glass.addColorStop(0.18, "rgba(150,225,230,0.035)");
  glass.addColorStop(0.5, "rgba(120,200,210,0.018)");
  glass.addColorStop(0.85, "rgba(160,230,235,0.045)");
  glass.addColorStop(1, "rgba(200,250,250,0.11)");
  traceOuter(ctx, pot);
  ctx.fillStyle = glass;
  ctx.fill();

  ctx.save();
  ctx.clip(interior);

  const wb = ctx.createLinearGradient(0, w.base - 30, 0, pot.bottomY);
  wb.addColorStop(0, "rgba(126,238,230,0.32)");
  wb.addColorStop(0.06, "rgba(58,186,196,0.42)");
  wb.addColorStop(0.45, "rgba(22,120,146,0.54)");
  wb.addColorStop(1, "rgba(5,52,76,0.74)");
  ctx.fillStyle = wb;
  ctx.fill(waterBody);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.clip(waterBody);
  for (let i = 0; i < 5; i++) {
    const px = pot.cx + (i - 2) * pot.rimHW * 0.42 + Math.sin(t * 0.21 + i * 1.7) * 26;
    const spread = 46 + Math.sin(t * 0.3 + i) * 12;
    const gr = ctx.createLinearGradient(px, w.base, px + spread * 1.5, pot.bottomY);
    gr.addColorStop(0, `rgba(150,255,240,${0.07 + 0.022 * Math.sin(t * 0.7 + i)})`);
    gr.addColorStop(1, "rgba(120,235,255,0)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(px - spread * 0.4, w.base - 8);
    ctx.lineTo(px + spread * 0.4, w.base - 8);
    ctx.lineTo(px + spread * 2.1, pot.bottomY + 20);
    ctx.lineTo(px - spread * 1.1, pot.bottomY + 20);
    ctx.closePath();
    ctx.fill();
  }
  for (let k = 0; k < 6; k++) {
    const yy = w.base + 30 + k * ((pot.bottomY - w.base) / 6.2);
    ctx.beginPath();
    for (let x = w.x0 - 10; x <= w.x1 + 10; x += 22) {
      const y = yy + Math.sin(x * 0.011 + t * (0.5 + k * 0.08) + k) * 7 + Math.sin(x * 0.031 - t * 0.9) * 3;
      if (x === w.x0 - 10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(140,255,238,${0.05 - k * 0.005})`;
    ctx.lineWidth = 12 - k;
    ctx.stroke();
  }
  ctx.restore();

  const bSprite = bubble();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const b of sim.bubbles) {
    const s = b.r * 5;
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 3 + b.ph);
    ctx.drawImage(bSprite, b.x - s * 0.5, b.y - s * 0.5, s, s);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const beads = sim.balls.slice().sort((a, b) => a.dens - b.dens);
  for (const b of beads) {
    const s = sim.surfaceAt(b.x);
    const under = clamp((b.y - s) / Math.max(1, b.r * 2), -1, 1);
    let ox = 0;
    if (b.frac > 0.05) {
      const ci = clamp(Math.round((b.x - w.x0) / w.dx), 1, w.cols - 2);
      ox = (w.h[ci + 1] - w.h[ci - 1]) * 0.3 * b.frac;
    }
    const dr = b.dr * (b.dying ? 0.55 + 0.45 * b.alpha : 1);
    const ext = dr + PAD;
    const gel = b.frac > 0.94 ? 0.93 : 1;
    ctx.globalAlpha = b.dying ? clamp(b.alpha, 0, 1) * gel : gel;
    ctx.drawImage(b.sprite, b.x + ox - ext, b.y - ext, ext * 2, ext * 2);
    if (under > 0) {
      ctx.globalAlpha = 0.11 * under;
      ctx.fillStyle = "#0a5a76";
      ctx.beginPath();
      ctx.arc(b.x + ox, b.y, dr, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (b.grabbed) {
      ctx.strokeStyle = "rgba(245,167,95,0.8)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -t * 24;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.dr + 7, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  const veil = ctx.createLinearGradient(0, w.base - 10, 0, pot.bottomY);
  veil.addColorStop(0, "rgba(96,214,224,0.15)");
  veil.addColorStop(0.35, "rgba(24,132,164,0.24)");
  veil.addColorStop(1, "rgba(4,48,74,0.4)");
  ctx.fillStyle = veil;
  ctx.fill(waterBody);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.clip(waterBody);
  for (let k = 0; k < 3; k++) {
    const yy = w.base + 16 + k * 52;
    ctx.beginPath();
    for (let x = w.x0 - 10; x <= w.x1 + 10; x += 20) {
      const y = yy + Math.sin(x * 0.017 - t * (1.1 + k * 0.3) + k * 2) * 5;
      if (x === w.x0 - 10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(190,255,248,${0.05 - k * 0.012})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(150,245,238,0.15)";
  ctx.lineWidth = 7;
  ctx.stroke(surfLine);
  const sl = ctx.createLinearGradient(w.x0, 0, w.x1, 0);
  sl.addColorStop(0, "rgba(214,255,252,0.32)");
  sl.addColorStop(0.3, "rgba(236,255,253,0.95)");
  sl.addColorStop(0.62, "rgba(200,250,248,0.72)");
  sl.addColorStop(1, "rgba(214,255,252,0.3)");
  ctx.strokeStyle = sl;
  ctx.lineWidth = 1.8;
  ctx.stroke(surfLine);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const b of beads) {
    if (b.dying || b.frac < 0.02 || b.frac > 0.985) continue;
    const s = sim.surfaceAt(b.x);
    const u = b.y - s;
    const chord = Math.sqrt(Math.max(0.5, b.dr * b.dr - u * u));
    ctx.strokeStyle = `rgba(228,255,251,${0.26 + 0.14 * Math.sin(t * 3 + b.seed)})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(b.x, s, chord, Math.max(1.1, chord * 0.24), 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const d of sim.drops) {
    const a = clamp(d.life, 0, 1);
    ctx.fillStyle = `rgba(216,255,252,${0.5 * a})`;
    ctx.beginPath();
    ctx.ellipse(
      d.x,
      d.y,
      d.r * 0.8,
      d.r * (1 + clamp(Math.abs(d.vy) / 900, 0, 1.1)),
      Math.atan2(d.vy, d.vx) - Math.PI / 2,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.restore();

  ctx.restore();

  traceOuter(ctx, pot);
  ctx.strokeStyle = "rgba(206,250,250,0.3)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  traceOutline(ctx, pot);
  ctx.strokeStyle = "rgba(226,255,253,0.14)";
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= 26; i++) {
      const y = pot.rimY + ((pot.bottomY - pot.rimY) * i) / 26;
      const x = pot.cx + side * (pot.halfWidthAt(y) - (side < 0 ? 7 : 10));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const gr = ctx.createLinearGradient(0, pot.rimY, 0, pot.bottomY);
    const a = side < 0 ? 0.17 : 0.07;
    gr.addColorStop(0, `rgba(230,255,253,${a * 0.3})`);
    gr.addColorStop(0.25, `rgba(230,255,253,${a})`);
    gr.addColorStop(0.8, `rgba(200,245,250,${a * 0.4})`);
    gr.addColorStop(1, "rgba(200,245,250,0)");
    ctx.strokeStyle = gr;
    ctx.lineWidth = side < 0 ? 4 : 2.5;
    ctx.stroke();
  }
  ctx.restore();

  const rimHW = pot.halfWidthAt(pot.rimY) + 13;
  ctx.beginPath();
  ctx.ellipse(pot.cx, pot.rimY, rimHW, Math.max(6, rimHW * 0.022), 0, 0, TAU);
  ctx.strokeStyle = "rgba(224,255,252,0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(pot.cx, pot.rimY, rimHW - 13, Math.max(4, rimHW * 0.018), 0, 0, TAU);
  ctx.strokeStyle = "rgba(180,240,240,0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const rest = H * sim.params.level;
  const hw = pot.halfWidthAt(rest);
  ctx.save();
  ctx.setLineDash([2, 7]);
  ctx.strokeStyle = "rgba(245,167,95,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pot.cx - hw - 30, rest);
  ctx.lineTo(pot.cx + hw + 30, rest);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "500 10px 'DM Mono', ui-monospace, monospace";
  ctx.fillStyle = "rgba(245,167,95,0.85)";
  ctx.textAlign = "left";
  ctx.fillText(`${Math.round(sim.params.level * 100)}%`, pot.cx + hw + 36, rest + 3.5);
  ctx.restore();

  const p = sim.pointer;
  if (p.inside) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = p.down ? "rgba(245,167,95,0.34)" : "rgba(127,240,221,0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 9]);
    ctx.lineDashOffset = -t * 26;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.down ? 150 : 118, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = p.down ? "rgba(245,167,95,0.55)" : "rgba(190,250,245,0.26)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  const pat = grain(ctx);
  if (pat) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  const vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.34, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.44)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}
