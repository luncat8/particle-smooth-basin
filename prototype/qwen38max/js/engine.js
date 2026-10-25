var TAU = Math.PI * 2;

const SUB_DT = 1 / 240;
const MAX_STEPS = 9;
const K_CONTACT = 22000;
const C_CONTACT = 96;
const FRICTION = 3.2;
const K_WALL = 30000;
const C_WALL = 130;
const MAX_SPEED = 2600;
const DRAW_SCALE = 0.9;

var clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
var rand = (a, b) => a + Math.random() * (b - a);

function submergedArea(r, u) {
  if (u >= r) return Math.PI * r * r;
  if (u <= -r) return 0;
  const c = Math.abs(u);
  const seg = r * r * Math.acos(c / r) - c * Math.sqrt(Math.max(0, r * r - c * c));
  return u >= 0 ? Math.PI * r * r - seg : seg;
}

class Basin {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.pot = buildPot(W, H);
    this.balls = [];
    this.drops = [];
    this.bubbles = [];
    this.params = { gravity: 1500, level: 0.5, fill: 0.7, viscosity: 1, size: 1, paused: false };
    this.water = { cols: 0, dx: 8, x0: 0, x1: 0, h: new Float32Array(0), v: new Float32Array(0), tgt: new Float32Array(0), base: 0, set: 0, rest: 0, rise: 0 };
    this.pointer = { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false };
    this.time = 0;
    this.acc = 0;
    this.nextId = 1;
    this.addCooldown = 0;
    this.segBoxes = [];
    this.buildWater();
    this.reset();
  }

  buildWater() {
    const w = this.water;
    w.rest = 0;
    w.rise = 0;
    w.set = this.H * this.params.level;
    w.base = w.set;
    const hw = this.pot.halfWidthAt(w.base);
    w.x0 = this.pot.cx - hw * 1.02;
    w.x1 = this.pot.cx + hw * 1.02;
    w.cols = clamp(Math.round((w.x1 - w.x0) / 7), 40, 260);
    w.dx = (w.x1 - w.x0) / (w.cols - 1);
    w.h = new Float32Array(w.cols);
    w.v = new Float32Array(w.cols);
    w.tgt = new Float32Array(w.cols);
  }

  resize(W, H) {
    const sx = W / (this.W || W);
    const sy = H / (this.H || H);
    this.W = W;
    this.H = H;
    this.pot = buildPot(W, H);
    for (const b of this.balls) {
      b.x *= sx;
      b.y *= sy;
      b.x = clamp(b.x, this.pot.cx - this.pot.halfWidthAt(b.y) + b.r, this.pot.cx + this.pot.halfWidthAt(b.y) - b.r);
    }
    this.segBoxes = [];
    this.buildWater();
  }

  radiusFor() {
    const s = this.params.size;
    const base = clamp(Math.min(this.W, this.H) / 46, 9, 20) * s;
    return clamp(base * rand(0.62, 1.32), 6, 46);
  }

  densityFor() {
    const u = Math.random();
    if (u < 0.27) return rand(0.24, 0.72);
    if (u < 0.4) return rand(0.86, 1.1);
    return rand(1.2, 2.4);
  }

  makeBall(x, y, dens, r) {
    const rad = (r == null) ? this.radiusFor() : r;
    const d = (dens == null) ? this.densityFor() : dens;
    const c = pebbleColor(d);
    const b = {
      id: this.nextId++,
      x: x, y: y, vx: 0, vy: 0, r: rad, dr: rad * DRAW_SCALE, dens: d,
      m: d * Math.PI * rad * rad,
      inv: 1 / (d * Math.PI * rad * rad),
      frac: 0, hue: c.h, sat: c.s, lit: c.l,
      sprite: makePebbleSprite(rad * DRAW_SCALE, c.h, c.s, c.l),
      grabbed: false, dying: false, alpha: 1, seed: Math.random() * TAU,
    };
    return b;
  }

  reset() {
    this.balls = [];
    this.drops = [];
    this.nextId = 1;
    this.acc = 0;

    const targetArea = this.targetArea();
    const samples = [];
    let acc = 0;
    let guard = 0;
    while (acc < targetArea && guard++ < 900) {
      const r = this.radiusFor();
      samples.push(r);
      acc += Math.PI * r * r;
    }
    samples.sort((a, b) => b - a);

    const bottom = this.pot.bottomY;
    let y = bottom - samples[0] - 2;
    let i = 0;
    let row = 0;
    while (i < samples.length) {
      const rowR = samples[i];
      const hw = this.pot.halfWidthAt(y) - rowR - 4;
      const step = rowR * 2.12;
      const n = Math.max(1, Math.floor((hw * 2) / step));
      const x0 = this.pot.cx - ((n - 1) * step) / 2 + (row % 2 ? step * 0.5 : 0);
      for (let k = 0; k < n && i < samples.length; k++, i++) {
        const r = samples[i];
        const b = this.makeBall(x0 + k * step + rand(-1.5, 1.5), y + rand(-1.5, 1.5), this.densityFor(), r);
        this.balls.push(b);
      }
      y -= rowR * 1.9;
      row++;
      if (y < this.pot.rimY + 46) y = this.pot.rimY + 46 + (row % 5) * 7;
    }

    const slots = this.balls.map((b) => ({ x: b.x, y: b.y }));
    this.balls.sort((a, b) => b.dens - a.dens);
    this.balls.forEach((b, idx) => {
      b.x = slots[idx].x;
      b.y = slots[idx].y;
    });

    this.water.h.fill(0);
    this.water.v.fill(0);
    this.water.tgt.fill(0);
    this.bubbles = [];
    for (let i = 0; i < 34; i++) this.bubbles.push(this.newBubble(rand(0, 1)));
  }

  targetArea() {
    const rest = this.H * this.params.level;
    return this.params.fill * this.pot.areaBetween(rest, this.pot.bottomY);
  }

  currentArea() {
    let a = 0;
    for (const b of this.balls) if (!b.dying) a += Math.PI * b.r * b.r;
    return a;
  }

  fitCount() {
    const target = this.targetArea();
    let cur = this.currentArea();
    this.addCooldown -= 1;
    if (cur < target * 0.995 && this.addCooldown <= 0 && this.balls.length < 420) {
      this.addCooldown = 2;
      const r = this.radiusFor();
      const hw = this.pot.halfWidthAt(this.pot.rimY + 30);
      const b = this.makeBall(this.pot.cx + rand(-hw * 0.75, hw * 0.75), this.pot.rimY - rand(20, 90), undefined, r);
      b.vy = rand(60, 260);
      this.balls.push(b);
      cur += Math.PI * r * r;
    } else if (cur > target * 1.012) {
      this.addCooldown = 4;
      const live = this.balls.filter((b) => !b.dying && !b.grabbed);
      if (live.length) {
        live.sort((a, b) => a.y - b.y);
        const pick = live[Math.floor(Math.random() * Math.max(1, Math.min(6, live.length)))];
        pick.dying = true;
      }
    }
  }

  dropPebble() {
    if (this.balls.length > 460) return;
    const hw = this.pot.halfWidthAt(this.pot.rimY + 30);
    const b = this.makeBall(this.pot.cx + rand(-hw * 0.7, hw * 0.7), this.pot.rimY - rand(60, 180));
    b.vy = rand(80, 200);
    this.balls.push(b);
  }

  newBubble(t) {
    const y = this.pot.bottomY - rand(4, (this.pot.bottomY - this.water.base) * 0.9);
    const hw = this.pot.halfWidthAt(y) * 0.94;
    return {
      x: this.pot.cx + rand(-hw, hw),
      y: this.pot.bottomY - t * (this.pot.bottomY - this.water.base),
      r: rand(1.1, 3.6),
      ph: Math.random() * TAU,
      sp: rand(14, 42),
    };
  }

  surfaceAt(x) {
    const w = this.water;
    const f = (x - w.x0) / w.dx;
    const i = clamp(Math.floor(f), 0, w.cols - 2);
    const t = clamp(f - i, 0, 1);
    return w.base + w.h[i] * (1 - t) + w.h[i + 1] * t;
  }

  ripple(x, strength, width = 26) {
    const w = this.water;
    const ci = (x - w.x0) / w.dx;
    const span = Math.ceil(width / w.dx) + 1;
    for (let k = -span; k <= span; k++) {
      const i = Math.round(ci) + k;
      if (i < 0 || i >= w.cols) continue;
      const f = Math.exp(-(k * k) / (2 * Math.max(1.5, span * 0.5) ** 2));
      w.v[i] += strength * f;
    }
  }

  updateWater(dt) {
    const w = this.water;
    let sub = 0;
    for (const b of this.balls) sub += submergedArea(b.r, b.y - this.surfaceAt(b.x)) * (b.alpha == null ? 1 : b.alpha);
    const free = Math.max(80, this.pot.halfWidthAt(this.H * this.params.level) * 2);
    w.rise = clamp(sub / free, -26, 260);
    w.rest += (w.rise - w.rest) * Math.min(1, dt * 0.55);
    w.set += (this.H * this.params.level - w.set) * Math.min(1, dt * 3.2);
    w.base = w.set + clamp(w.rise - w.rest, -24, 24);
    const hw = this.pot.halfWidthAt(w.base);
    w.x0 = this.pot.cx - hw * 1.02;
    w.x1 = this.pot.cx + hw * 1.02;

    const iters = clamp(Math.round(dt * 60), 1, 3);
    const K = 0.024;
    const DAMP = 0.986;
    const SPREAD = 0.24;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < w.cols; i++) {
        w.v[i] = (w.v[i] - K * (w.h[i] - w.tgt[i])) * DAMP;
        w.tgt[i] *= 0.88;
      }
      for (let i = 0; i < w.cols; i++) w.h[i] += w.v[i];
      for (let p = 0; p < 2; p++) {
        const ld = new Array(w.cols);
        const rd = new Array(w.cols);
        for (let i = 0; i < w.cols; i++) {
          ld[i] = i > 0 ? SPREAD * (w.h[i] - w.h[i - 1]) : 0;
          rd[i] = i < w.cols - 1 ? SPREAD * (w.h[i] - w.h[i + 1]) : 0;
          if (i > 0) w.v[i - 1] += ld[i];
          if (i < w.cols - 1) w.v[i + 1] += rd[i];
        }
        for (let i = 0; i < w.cols; i++) {
          if (i > 0) w.h[i - 1] += ld[i] * 0.8;
          if (i < w.cols - 1) w.h[i + 1] += rd[i] * 0.8;
        }
      }
      w.v[0] *= 0.6;
      w.v[w.cols - 1] *= 0.6;
      w.h[0] *= 0.9;
      w.h[w.cols - 1] *= 0.9;
    }
  }

  step(dt) {
    if (this.params.paused) return;
    this.acc += Math.min(dt, 0.06);
    let n = 0;
    while (this.acc >= SUB_DT && n < MAX_STEPS) {
      this.substep(SUB_DT);
      this.acc -= SUB_DT;
      n++;
    }
    if (n === MAX_STEPS) this.acc = 0;
    this.relax();
    this.fitCount();
    this.updateWater(dt);
    this.updateEffects(dt);
    this.time += dt;
  }

  substep(dt) {
    const balls = this.balls;
    const g = this.params.gravity;
    const visc = this.params.viscosity;

    for (const b of balls) {
      if (b.dying) {
        b.alpha -= dt * 2.6;
        continue;
      }
      const s = this.surfaceAt(b.x);
      const u = b.y - s;
      const area = Math.PI * b.r * b.r;
      const sub = submergedArea(b.r, u);
      b.frac = sub / area;

      if (b.grabbed) {
        const p = this.pointer;
        b.vx += ((p.x - b.x) * 420 - b.vx * 26) * dt;
        b.vy += ((p.y - b.y) * 420 - b.vy * 26) * dt;
      } else {
        b.vy += g * (1 - b.frac / b.dens) * dt;

        if (b.frac > 0.0005) {
          const sp = Math.hypot(b.vx, b.vy);
          const cQuad = 0.22 * visc;
          const cLin = 26 * visc;
          let drag = (b.frac * (cQuad * sp + cLin)) / (b.dens * b.r);
          drag = Math.min(drag * dt, 0.55);
          b.vx -= b.vx * drag;
          b.vy -= b.vy * drag;
          b.vx *= 1 - Math.min(0.4, b.frac * dt * 0.5);
        } else {
          b.vx *= 1 - Math.min(0.2, dt * 0.12);
        }
      }

      if (b.frac > 0.002 && b.frac < 0.995) {
        const w = this.water;
        const ci = (b.x - w.x0) / w.dx;
        const span = Math.ceil((b.r * 1.35) / w.dx);
        const s0 = Math.max(0, Math.round(ci) - span);
        const s1 = Math.min(w.cols - 1, Math.round(ci) + span);
        const men = 4 * b.frac * (1 - b.frac);
        for (let i = s0; i <= s1; i++) {
          const k = i - ci;
          const f = Math.exp(-(k * k) / (2 * Math.max(1.2, span * 0.6) ** 2));
          w.v[i] += b.vy * dt * 0.42 * f * (0.4 + 0.6 * b.r / 20);
          w.tgt[i] -= men * b.r * 0.34 * f * dt * 60 * 0.06;
        }
        if (Math.abs(b.vy) > 200 && men > 0.35 && Math.random() < dt * 26) this.splash(b, s);
      }
    }

    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.dying) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.dying) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rr = a.r + b.r;
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const ov = Math.min(rr - d, 14);
        const nx = dx / d;
        const ny = dy / d;
        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        const mEff = (a.m * b.m) / (a.m + b.m);
        let fn = (K_CONTACT * ov - C_CONTACT * vn) * mEff;
        if (fn < 0) fn = 0;
        const tx = -ny;
        const ty = nx;
        const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
        let ft = -vt * FRICTION * mEff;
        const maxF = fn * 0.24;
        ft = clamp(ft, -maxF, maxF);
        const fx = fn * nx + ft * tx;
        const fy = fn * ny + ft * ty;
        a.vx -= fx * a.inv * dt;
        a.vy -= fy * a.inv * dt;
        b.vx += fx * b.inv * dt;
        b.vy += fy * b.inv * dt;
      }
    }

    if (!this.segBoxes.length) {
      this.segBoxes = this.pot.segs.map((s) => ({
        x0: Math.min(s.ax, s.bx) - 60,
        y0: Math.min(s.ay, s.by) - 60,
        x1: Math.max(s.ax, s.bx) + 60,
        y1: Math.max(s.ay, s.by) + 60,
      }));
    }
    for (const b of balls) {
      if (b.dying) continue;
      const segs = this.pot.segs;
      for (let i = 0; i < segs.length; i++) {
        const bb = this.segBoxes[i];
        if (b.x < bb.x0 || b.x > bb.x1 || b.y < bb.y0 || b.y > bb.y1) continue;
        const s = segs[i];
        const c = closestOnSegment(b.x, b.y, s);
        let nx = b.x - c.x;
        let ny = b.y - c.y;
        let d = Math.hypot(nx, ny);
        if (d > b.r) continue;
        if (d < 1e-4) {
          nx = s.nx;
          ny = s.ny;
          d = 0;
        } else {
          nx /= d;
          ny /= d;
          if (nx * s.nx + ny * s.ny < 0) {
            nx = s.nx;
            ny = s.ny;
          }
        }
        const ov = Math.min(b.r - d, 16);
        const vn = b.vx * nx + b.vy * ny;
        let fn = K_WALL * ov - C_WALL * vn;
        if (fn < 0) fn = 0;
        b.vx += fn * nx * dt;
        b.vy += fn * ny * dt;
      }
    }

    if (this.pointer.down || this.pointer.inside) {
      const R = 150;
      const str = this.pointer.down ? 1 : 0.34;
      for (const b of balls) {
        if (b.dying || b.grabbed) continue;
        const dx = b.x - this.pointer.x;
        const dy = b.y - this.pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const d = Math.sqrt(d2) || 1;
        const f = Math.pow(1 - d / R, 2) * str;
        b.vx += (this.pointer.vx * 0.9 + (dx / d) * 190) * f * dt * 6;
        b.vy += (this.pointer.vy * 0.9 + (dy / d) * 190) * f * dt * 6;
      }
    }

    for (const b of balls) {
      if (b.dying) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_SPEED) {
        b.vx = (b.vx / sp) * MAX_SPEED;
        b.vy = (b.vy / sp) * MAX_SPEED;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const hw = this.pot.halfWidthAt(b.y) + b.r * 2;
      if (b.y > this.pot.bottomY + 60 || Math.abs(b.x - this.pot.cx) > hw + 90 || !isFinite(b.x)) {
        b.x = this.pot.cx + rand(-40, 40);
        b.y = this.pot.rimY + 40;
        b.vx = 0;
        b.vy = 0;
      }
    }
  }

  relax() {
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.dying) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.dying) continue;
        const rr = a.r + b.r;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr * 0.94 || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const ov = rr * 0.97 - d;
        if (ov <= 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        const tm = a.m + b.m;
        const ka = (b.m / tm) * 0.34 * ov;
        const kb = (a.m / tm) * 0.34 * ov;
        a.x -= nx * ka;
        a.y -= ny * ka;
        b.x += nx * kb;
        b.y += ny * kb;
      }
      const segs = this.pot.segs;
      for (let i = 0; i < segs.length; i++) {
        const bb = this.segBoxes[i];
        if (bb && (a.x < bb.x0 || a.x > bb.x1 || a.y < bb.y0 || a.y > bb.y1)) continue;
        const s = segs[i];
        const c = closestOnSegment(a.x, a.y, s);
        const dx = a.x - c.x;
        const dy = a.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d > a.r || d < 1e-4) continue;
        const ov = a.r - d;
        a.x += (dx / d) * ov * 0.5;
        a.y += (dy / d) * ov * 0.5;
      }
    }
  }

  splash(b, s) {
    const chord = Math.sqrt(Math.max(1, b.r * b.r - (b.y - s) ** 2));
    this.ripple(b.x, clamp(b.vy * 0.028, 1, 26), chord * 1.5 + 18);
    const n = clamp(Math.round(b.vy / 130), 2, 9);
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.drops.push({
        x: b.x + side * chord * rand(0.4, 1),
        y: s - rand(0, 4),
        vx: side * rand(30, 150) + b.vx * 0.25,
        vy: -rand(0.25, 0.85) * b.vy * rand(0.5, 1),
        r: rand(1.4, 3.6),
        life: 1,
      });
    }
    if (this.drops.length > 260) this.drops.splice(0, this.drops.length - 260);
  }

  updateEffects(dt) {
    const g = this.params.gravity;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.vy += g * 0.62 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt * 0.55;
      if (d.life <= 0) {
        this.drops.splice(i, 1);
        continue;
      }
      if (d.y > this.surfaceAt(d.x) + 2 && d.vy > 0) {
        this.ripple(d.x, clamp(d.vy * 0.012, 0.4, 7), 14);
        this.drops.splice(i, 1);
      }
    }
    for (const b of this.bubbles) {
      b.y -= b.sp * dt;
      b.x += Math.sin(this.time * 2.2 + b.ph) * 9 * dt;
      const s = this.surfaceAt(b.x);
      if (b.y < s + 3) {
        this.ripple(b.x, -1.1, 10);
        Object.assign(b, this.newBubble(0));
      }
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      if (this.balls[i].dying && this.balls[i].alpha <= 0) this.balls.splice(i, 1);
    }
  }

  pointerMove(x, y) {
    const p = this.pointer;
    p.vx = p.vx * 0.6 + (x - p.x) * 0.4 * 60 * 0.45;
    p.vy = p.vy * 0.6 + (y - p.y) * 0.4 * 60 * 0.45;
    p.x = x;
    p.y = y;
    p.inside = true;
    if (!p.down) this.ripple(x, clamp(Math.abs(p.vy) * 0.004, 0, 1.2), 20);
  }

  pointerLeave() {
    this.pointer.inside = false;
    this.pointer.down = false;
    this.releaseGrab();
  }

  pointerDown(x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.down = true;
    this.pointer.inside = true;
    let best = null;
    let bd = Infinity;
    for (const b of this.balls) {
      if (b.dying) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < b.dr * 1.05 && d < bd) {
        bd = d;
        best = b;
      }
    }
    this.ripple(x, -6.5, 44);
    if (best) {
      best.grabbed = true;
      best.vx *= 0.2;
      best.vy *= 0.2;
    }
  }

  releaseGrab() {
    for (const b of this.balls) b.grabbed = false;
  }

  pointerUp() {
    this.pointer.down = false;
    this.releaseGrab();
  }

  stats() {
    let afloat = 0;
    let sunk = 0;
    let dens = 0;
    let area = 0;
    const alive = this.balls.filter((b) => !b.dying);
    for (const b of alive) {
      dens += b.dens;
      area += Math.PI * b.r * b.r;
      if (b.frac < 0.88) afloat++;
      if (b.frac > 0.99) sunk++;
    }
    let energy = 0;
    for (let i = 0; i < this.water.cols; i++) energy += Math.abs(this.water.v[i]);
    return {
      count: alive.length,
      area: area,
      targetArea: this.targetArea(),
      afloat: afloat,
      sunk: sunk,
      meanDens: alive.length ? dens / alive.length : 0,
      waveEnergy: energy / Math.max(1, this.water.cols),
      levelPx: this.water.base,
    };
  }
}
