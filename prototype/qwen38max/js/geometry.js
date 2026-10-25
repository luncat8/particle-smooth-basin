const WALL_T = 13;
const FLARE = 1.75;

function halfWidthFor(y, rimY, bottomY, rimHW, baseHW) {
  const t = (bottomY - y) / (bottomY - rimY);
  if (t <= 0) return baseHW;
  if (t >= 1) return rimHW;
  return baseHW + (rimHW - baseHW) * Math.pow(t, FLARE);
}

function buildPot(W, H) {
  const cx = W * 0.5;
  const rimY = Math.round(H * 0.075);
  const bottomY = Math.round(H * 0.945);
  const rimHW = Math.min(W * 0.365, 640);
  const baseHW = rimHW * 0.665;

  const halfWidthAt = (y) => halfWidthFor(y, rimY, bottomY, rimHW, baseHW);

  const SAMPLES = 46;
  const outline = [];
  const FN = 4;
  const topY = rimY - H * 1.3;
  for (let i = 0; i < FN; i++) {
    const y = topY + ((rimY - topY) * i) / FN;
    outline.push({ x: cx - halfWidthAt(y), y: y });
  }
  for (let i = 0; i <= SAMPLES; i++) {
    const y = rimY + ((bottomY - rimY) * i) / SAMPLES;
    outline.push({ x: cx - halfWidthAt(y), y: y });
  }
  outline.push({ x: cx + baseHW, y: bottomY });
  for (let i = SAMPLES; i >= 0; i--) {
    const y = rimY + ((bottomY - rimY) * i) / SAMPLES;
    outline.push({ x: cx + halfWidthAt(y), y: y });
  }
  for (let i = 1; i < FN; i++) {
    const y = rimY - ((rimY - topY) * i) / FN;
    outline.push({ x: cx + halfWidthAt(y), y: y });
  }

  const centroid = { x: cx, y: (rimY + bottomY) * 0.5 };
  const segs = [];
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i];
    const b = outline[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = dy / len;
    let ny = -dx / len;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    if (nx * (centroid.x - mx) + ny * (centroid.y - my) < 0) {
      nx = -nx;
      ny = -ny;
    }
    segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, dx: dx / len, dy: dy / len, nx: nx, ny: ny, len: len });
  }

  const inner = [];
  const OUT_N = 46;
  for (let i = 0; i <= OUT_N; i++) {
    const y = rimY + ((bottomY - rimY) * i) / OUT_N;
    inner.push({ x: cx - halfWidthAt(y), y: y });
  }
  inner.push({ x: cx + baseHW, y: bottomY });
  for (let i = OUT_N; i >= 0; i--) {
    const y = rimY + ((bottomY - rimY) * i) / OUT_N;
    inner.push({ x: cx + halfWidthAt(y), y: y });
  }
  const outer = inner.map((p, i) => {
    const prev = inner[Math.max(0, i - 1)];
    const next = inner[Math.min(inner.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    let nx = ty;
    let ny = -tx;
    if (nx * (cx - p.x) + ny * ((rimY + bottomY) * 0.5 - p.y) > 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: p.x + nx * WALL_T, y: p.y + ny * WALL_T };
  });

  const areaBetween = (y0, y1) => {
    const lo = Math.max(y0, rimY);
    const hi = Math.min(y1, bottomY);
    if (hi <= lo) return 0;
    const N = 40;
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const y = lo + ((hi - lo) * (i + 0.5)) / N;
      acc += halfWidthAt(y) * 2;
    }
    return (acc * (hi - lo)) / N;
  };

  return { cx: cx, rimY: rimY, bottomY: bottomY, rimHW: rimHW, baseHW: baseHW, outline: outline, segs: segs, outer: outer, halfWidthAt: halfWidthAt, areaBetween: areaBetween };
}

function closestOnSegment(px, py, s) {
  const t = Math.min(1, Math.max(0, ((px - s.ax) * s.dx + (py - s.ay) * s.dy) / s.len));
  return { x: s.ax + s.dx * s.len * t, y: s.ay + s.dy * s.len * t };
}

function traceOutline(ctx, pot, topY = pot.rimY) {
  const N = 42;
  const top = Math.min(topY, pot.rimY);
  if (ctx.beginPath) ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const y = top + ((pot.bottomY - top) * i) / N;
    const x = pot.cx - pot.halfWidthAt(y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(pot.cx + pot.baseHW, pot.bottomY);
  for (let i = N; i >= 0; i--) {
    const y = top + ((pot.bottomY - top) * i) / N;
    ctx.lineTo(pot.cx + pot.halfWidthAt(y), y);
  }
  ctx.closePath();
}
