const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d", { alpha: false });

let sim = null;
let dpr = Math.min(2, window.devicePixelRatio || 1);
let W = window.innerWidth;
let H = window.innerHeight;

const state = {
  paused: false,
  level: 0.5,
  fill: 0.7,
  gravity: 1500,
  viscosity: 1,
  size: 1,
};

function fit() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (sim) sim.resize(W, H);
}

fit();
sim = new Basin(W, H);
sim.params.level = state.level;
sim.params.fill = state.fill;
sim.params.gravity = state.gravity;
sim.params.viscosity = state.viscosity;
sim.params.size = state.size;
sim.params.paused = state.paused;

let raf = 0;
let last = performance.now();
let frames = 0;
let fpsClock = last;
let fps = 60;

function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;
  if (now - fpsClock > 500) {
    fps = (frames * 1000) / (now - fpsClock);
    frames = 0;
    fpsClock = now;
    const fpsEl = document.getElementById("fps");
    if (fpsEl) fpsEl.textContent = Math.round(fps) + " fps";
  }
  sim.step(dt);
  drawScene(ctx, sim);
}
raf = requestAnimationFrame(loop);

window.addEventListener("resize", fit);

function rectPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
canvas.addEventListener("pointermove", (e) => {
  const p = rectPoint(e);
  sim.pointerMove(p.x, p.y);
});
canvas.addEventListener("pointerdown", (e) => {
  const p = rectPoint(e);
  canvas.setPointerCapture(e.pointerId);
  sim.pointerDown(p.x, p.y);
});
canvas.addEventListener("pointerup", () => sim.pointerUp());
canvas.addEventListener("pointercancel", () => sim.pointerUp());
canvas.addEventListener("pointerleave", () => sim.pointerLeave());

// keyboard
window.addEventListener("keydown", (e) => {
  const el = e.target;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePause();
  } else if (e.key === "r" || e.key === "R") {
    doReset();
  } else if (e.key === "d" || e.key === "D") {
    sim.dropPebble();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    state.level = Math.min(0.82, Math.max(0.18, state.level + (e.key === "ArrowUp" ? -0.01 : 0.01)));
    syncParams();
    updateLevelUI();
  }
});

// stats poll
setInterval(() => {
  const st = sim.stats();
  document.getElementById("stat-count").textContent = st.count;
  document.getElementById("stat-afloat").textContent = st.afloat;
  document.getElementById("stat-sunk").textContent = st.sunk;
  document.getElementById("mean-dens").textContent = st.meanDens.toFixed(2);
  document.getElementById("level-px").textContent = Math.round(st.levelPx);
  const filledPct = st.targetArea > 0 ? (st.area / st.targetArea) * 100 : 0;
  const hf = document.getElementById("hint-fill");
  if (hf) hf.textContent = "now " + filledPct.toFixed(0) + " %";
}, 220);

function syncParams() {
  sim.params.level = state.level;
  sim.params.fill = state.fill;
  sim.params.gravity = state.gravity;
  sim.params.viscosity = state.viscosity;
  sim.params.size = state.size;
  sim.params.paused = state.paused;
}

function updateLevelUI() {
  const v = document.getElementById("v-level");
  if (v) v.textContent = Math.round(state.level * 100);
  const input = document.getElementById("d-level");
  if (input) {
    input.value = Math.round(state.level * 100);
    updatePct(input, 18, 82);
  }
}

function updatePct(input, min, max) {
  const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--pct", pct + "%");
}

function togglePause() {
  state.paused = !state.paused;
  syncParams();
  const badge = document.getElementById("paused-badge");
  if (badge) {
    if (state.paused) {
      badge.classList.remove("-translate-y-3", "opacity-0");
      badge.classList.add("translate-y-0", "opacity-100");
    } else {
      badge.classList.add("-translate-y-3", "opacity-0");
      badge.classList.remove("translate-y-0", "opacity-100");
    }
  }
  const btn = document.getElementById("btn-pause");
  if (btn) btn.textContent = state.paused ? "resume" : "pause";
}

function doReset() {
  sim.params.size = state.size;
  sim.params.fill = state.fill;
  sim.params.level = state.level;
  sim.reset();
}

// slider wiring
function wireSlider(id, valId, min, max, fmt, onChange) {
  const input = document.getElementById(id);
  const valEl = valId ? document.getElementById(valId) : null;
  if (!input) return;
  const update = () => {
    const v = parseFloat(input.value);
    if (valEl) valEl.textContent = fmt(v);
    updatePct(input, min, max);
    onChange(v);
    syncParams();
  };
  input.addEventListener("input", update);
  updatePct(input, min, max);
}

wireSlider("d-level", "v-level", 18, 82, (v) => Math.round(v), (v) => { state.level = v / 100; });
wireSlider("d-fill", "v-fill", 25, 88, (v) => Math.round(v), (v) => { state.fill = v / 100; });
wireSlider("d-gravity", "v-gravity", 300, 2800, (v) => Math.round(v), (v) => {
  state.gravity = v;
  const hg = document.getElementById("hint-gravity");
  if (hg) hg.textContent = ((v / 1500) * 9.81).toFixed(1) + " m·s⁻²";
});
wireSlider("d-viscosity", "v-viscosity", 0.2, 2.4, (v) => v.toFixed(2), (v) => { state.viscosity = v; });
wireSlider("d-size", "v-size", 0.55, 1.6, (v) => v.toFixed(2), (v) => { state.size = v; });

document.getElementById("btn-drop").addEventListener("click", () => sim.dropPebble());
document.getElementById("btn-pause").addEventListener("click", () => togglePause());
document.getElementById("btn-reset").addEventListener("click", () => doReset());
