var TAU = Math.PI * 2;

const PAD = 7;
const SPRITE_SS = 2;

const lerp = (a, b, t) => a + (b - a) * t;
var clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function pebbleColor(dens) {
  const t = clamp((dens - 0.36) / (2.4 - 0.36), 0, 1);
  const warm = t > 0.45 && Math.random() < 0.18;
  if (warm) {
    return {
      h: lerp(38, 14, Math.random()),
      s: lerp(58, 72, Math.random()),
      l: lerp(66, 46, t),
    };
  }
  return {
    h: lerp(156, 210, t) + rand(-5, 5),
    s: lerp(46, 60, t) + rand(-6, 8),
    l: lerp(85, 42, Math.pow(t, 0.86)) + rand(-3, 3),
  };
}

var rand = (a, b) => a + Math.random() * (b - a);

function makePebbleSprite(R, h, s, l) {
  const ext = R + PAD;
  const size = Math.max(6, Math.ceil(ext * 2 * SPRITE_SS));
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const g = cv.getContext("2d");
  g.scale(SPRITE_SS, SPRITE_SS);
  const cx = ext;
  const cy = ext;
  const hsl = (hh, ss, ll, a = 1) =>
    `hsla(${hh.toFixed(1)}, ${clamp(ss, 0, 100).toFixed(1)}%, ${clamp(ll, 0, 100).toFixed(1)}%, ${a})`;

  let gr = g.createRadialGradient(cx, cy, R * 0.82, cx, cy, ext);
  gr.addColorStop(0, hsl(h, s, l + 12, 0.2));
  gr.addColorStop(0.55, hsl(h, s, l + 6, 0.07));
  gr.addColorStop(1, hsl(h, s, l, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cy, ext, 0, TAU);
  g.fill();

  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.clip();

  gr = g.createRadialGradient(cx - R * 0.36, cy - R * 0.4, R * 0.05, cx + R * 0.06, cy + R * 0.08, R * 1.14);
  gr.addColorStop(0, hsl(h - 6, s * 0.8, Math.min(97, l + 32)));
  gr.addColorStop(0.26, hsl(h, s, l + 15));
  gr.addColorStop(0.6, hsl(h + 2, s * 1.02, l + 2));
  gr.addColorStop(0.86, hsl(h + 4, s * 1.06, l - 12));
  gr.addColorStop(1, hsl(h + 6, s * 1.1, l - 27));
  g.fillStyle = gr;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  g.globalCompositeOperation = "lighter";
  gr = g.createRadialGradient(cx + R * 0.44, cy + R * 0.48, 0, cx + R * 0.44, cy + R * 0.48, R * 0.95);
  gr.addColorStop(0, hsl(h + 14, 95, 78, 0.4));
  gr.addColorStop(0.5, hsl(h + 10, 90, 66, 0.14));
  gr.addColorStop(1, hsl(h, 80, 60, 0));
  g.fillStyle = gr;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.globalCompositeOperation = "source-over";

  gr = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(0.78, "rgba(226,255,251,0.05)");
  gr.addColorStop(0.94, "rgba(226,255,251,0.34)");
  gr.addColorStop(1, hsl(h + 8, 70, 22, 0.42));
  g.fillStyle = gr;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  gr = g.createRadialGradient(cx - R * 0.1, cy + R * 1.02, 0, cx - R * 0.1, cy + R * 1.02, R * 1.25);
  gr.addColorStop(0, hsl(h + 6, 65, 10, 0.3));
  gr.addColorStop(1, hsl(h, 60, 10, 0));
  g.fillStyle = gr;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  g.save();
  g.translate(cx - R * 0.33, cy - R * 0.41);
  g.rotate(-0.6);
  g.scale(1, 0.62);
  gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
  gr.addColorStop(0, "rgba(255,255,255,0.78)");
  gr.addColorStop(0.45, "rgba(255,255,255,0.24)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, R * 0.42, 0, TAU);
  g.fill();
  g.restore();

  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.arc(cx - R * 0.45, cy - R * 0.5, Math.max(0.7, R * 0.088), 0, TAU);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.42)";
  g.beginPath();
  g.arc(cx - R * 0.08, cy - R * 0.64, Math.max(0.5, R * 0.052), 0, TAU);
  g.fill();

  g.restore();

  g.lineWidth = Math.max(0.6, R * 0.05);
  g.strokeStyle = "rgba(233,255,252,0.24)";
  g.beginPath();
  g.arc(cx, cy, R - g.lineWidth * 0.5, 0, TAU);
  g.stroke();

  return cv;
}
