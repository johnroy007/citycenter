// Local Government Trust Gap Model: an illustrative model (not survey data) of
// how trust is lost when neither residents nor staff can carry the process.
// The chart is drawn on a plain canvas (the site's security policy allows no
// outside scripts).
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);

  // Potential trust: 50 at zero process, rising with diminishing returns to 100.
  const K = 30, N = 1 - Math.exp(-100 / K);
  const potF = (P) => 50 + 50 * (1 - Math.exp(-P / K)) / N;

  // AI closes ai% of each side's skill shortfall.
  // A gap only exists when BOTH sides fall short of what the process requires.
  function model(P, C, O, ai) {
    const k = ai / 100;
    const Ce = C + (100 - C) * k, Oe = O + (100 - O) * k;
    const sr = Math.max(0, P - Ce), so = Math.max(0, P - Oe);
    const pot = potF(P);
    const gap = pot * Math.sqrt((sr / 100) * (so / 100));
    return { T: pot - gap, pot, gap, sr, so, Ce, Oe };
  }
  // Share of potential trust lost across all process levels 0-100.
  function area(C, O, A) {
    let g = 0, p = 0;
    for (let x = 0; x <= 100; x++) { const m = model(x, C, O, A); g += m.gap; p += m.pot; }
    return g / p * 100;
  }

  const XS = [...Array(101)].map((_, i) => i);
  const COLORS = { grid: "#e1e0d9", tick: "#898781", potential: "#898781", current: "#2a78d6", today: "#eb6834", gap: "rgba(121,31,31,0.6)" };
  const canvas = $("ch");
  const ctx = canvas.getContext("2d");
  let state = null; // { P, C, O, A } at the last update
  let hoverX = null;

  function draw() {
    if (!state) return;
    const { P, C, O, A } = state;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 46, r: 12, t: 10, b: 40 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const sx = (x) => pad.l + x / 100 * pw;
    const sy = (y) => pad.t + (1 - y / 100) * ph;

    // Grid and axes.
    ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = COLORS.tick;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let y = 0; y <= 100; y += 10) {
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath(); ctx.moveTo(pad.l, sy(y) + 0.5); ctx.lineTo(pad.l + pw, sy(y) + 0.5); ctx.stroke();
      ctx.fillText(String(y), pad.l - 6, sy(y));
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let x = 0; x <= 100; x += 10) ctx.fillText(String(x), sx(x), pad.t + ph + 6);
    ctx.fillText("Process fairness requires", pad.l + pw / 2, pad.t + ph + 22);
    ctx.save();
    ctx.translate(12, pad.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText("Trust", 0, 0);
    ctx.restore();

    const pot = XS.map(potF);
    const cur = XS.map((x) => model(x, C, O, A).T);
    const today = A > 0 ? XS.map((x) => model(x, C, O, 0).T) : null;

    // Trust gap: the area between potential and current trust.
    ctx.fillStyle = COLORS.gap;
    ctx.beginPath();
    XS.forEach((x, i) => (i ? ctx.lineTo(sx(x), sy(pot[i])) : ctx.moveTo(sx(x), sy(pot[i]))));
    for (let i = XS.length - 1; i >= 0; i--) ctx.lineTo(sx(XS[i]), sy(cur[i]));
    ctx.closePath();
    ctx.fill();

    function line(ys, color, dash) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.beginPath();
      XS.forEach((x, i) => (i ? ctx.lineTo(sx(x), sy(ys[i])) : ctx.moveTo(sx(x), sy(ys[i]))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    line(pot, COLORS.potential, [5, 4]);
    line(cur, COLORS.current, []);
    if (today) line(today, COLORS.today, [2, 3]);

    // The current setting.
    ctx.fillStyle = COLORS.current;
    ctx.beginPath(); ctx.arc(sx(P), sy(cur[P]), 5, 0, Math.PI * 2); ctx.fill();

    // Hover read-out.
    if (hoverX !== null) {
      const i = hoverX;
      ctx.strokeStyle = COLORS.tick;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx(i) + 0.5, pad.t); ctx.lineTo(sx(i) + 0.5, pad.t + ph); ctx.stroke();
      const rows = [["Process " + i, null], ["Potential: " + Math.round(pot[i]), COLORS.potential], ["Current: " + Math.round(cur[i]), COLORS.current]];
      if (today) rows.push(["Today: " + Math.round(today[i]), COLORS.today]);
      rows.push(["Trust gap: " + Math.round(pot[i] - cur[i]), null]);
      const bw = 2 + Math.max(...rows.map((r) => ctx.measureText(r[0]).width)) + 28, bh = rows.length * 17 + 12;
      let bx = sx(i) + 10;
      if (bx + bw > w - 4) bx = sx(i) - 10 - bw;
      const by = pad.t + 6;
      ctx.fillStyle = "rgba(20,20,19,0.85)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 6); else ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      rows.forEach(([text, color], r) => {
        const ty = by + 14 + r * 17;
        if (color) { ctx.fillStyle = color; ctx.fillRect(bx + 10, ty - 4, 8, 8); }
        ctx.fillStyle = "#ffffff";
        ctx.font = (r === 0 || !color ? "600 " : "") + "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.fillText(text, bx + (color ? 24 : 10), ty);
      });
    }
  }

  function upd() {
    const P = +$("p").value, C = +$("c").value, O = +$("o").value, A = +$("a").value;
    $("pv").textContent = P; $("cv").textContent = C; $("ov").textContent = O; $("av").textContent = A + "%";
    const m = model(P, C, O, A);
    const gp = Math.round(m.gap);
    $("t").textContent = Math.round(m.T); $("ts").textContent = "of " + Math.round(m.pot) + " possible";
    $("g").textContent = gp === 0 ? "Closed" : gp;
    $("g").style.color = gp === 0 ? "var(--tg-success)" : "var(--tg-danger)";
    const a0 = area(C, O, 0), aN = area(C, O, A);
    $("ga").textContent = aN.toFixed(1) + "%";
    $("ga").style.color = aN < 0.05 ? "var(--tg-success)" : "var(--tg-danger)";
    $("gc").textContent = a0 < 0.05 ? "—" : Math.round((1 - aN / a0) * 100) + "%";
    $("gcs").textContent = a0 < 0.05 ? "no gap to close" : "vs. today (" + a0.toFixed(1) + "% lost)";
    $("rs").textContent = Math.round(m.sr); $("ss").textContent = Math.round(m.so);
    $("rb").style.width = m.Ce + "%"; $("rp").style.width = P + "%";
    $("ob").style.width = m.Oe + "%"; $("op").style.width = P + "%";
    state = { P, C, O, A };
    draw();
  }

  function hover(ev) {
    const r = canvas.getBoundingClientRect();
    const pw = r.width - 46 - 12;
    const x = Math.round((ev.clientX - r.left - 46) / pw * 100);
    hoverX = x >= 0 && x <= 100 ? x : null;
    draw();
  }
  canvas.addEventListener("mousemove", hover);
  canvas.addEventListener("mouseleave", () => { hoverX = null; draw(); });
  window.addEventListener("resize", draw);
  ["p", "c", "o", "a"].forEach((i) => $(i).addEventListener("input", upd));
  upd();
})();
