/* devicePixelRatio-aware equity line and candle charts. */
(function (global) {
  "use strict";

  function dpr() {
    return Math.max(1, window.devicePixelRatio || 1);
  }

  function sizeCanvas(canvas) {
    const w = canvas.clientWidth || 0;
    const h = canvas.clientHeight || 0;
    const r = dpr();
    const tw = Math.max(1, Math.round(w * r));
    const th = Math.max(1, Math.round(h * r));
    if (canvas.width !== tw) canvas.width = tw;
    if (canvas.height !== th) canvas.height = th;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return { ctx, w, h, r };
  }

  function parseT(p) {
    if (p == null) return 0;
    if (typeof p === "number") return p;
    const t = p.t ?? p.ts ?? p.time;
    if (typeof t === "number") return t;
    const d = Date.parse(t || "");
    return Number.isFinite(d) ? d : 0;
  }

  function val(p) {
    const v = p.v ?? p.value ?? p.c ?? p.close ?? p.price;
    return Number(v);
  }

  function nicePad(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    if (min === max) {
      const pad = Math.max(1, Math.abs(min) * 0.04);
      return { min: min - pad, max: max + pad };
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  }

  function layoutMarks(marks, xOf, topY, rowH) {
    const placed = marks
      .map((m) => ({ ...m, x: xOf(parseT(m)), row: 0 }))
      .filter((m) => Number.isFinite(m.x))
      .sort((a, b) => a.x - b.x);
    const minGap = 64;
    for (let i = 1; i < placed.length; i++) {
      let row = 0;
      let ok = false;
      while (!ok) {
        ok = true;
        for (let j = 0; j < i; j++) {
          if (placed[j].row === row && Math.abs(placed[i].x - placed[j].x) < minGap) {
            ok = false;
            row += 1;
            break;
          }
        }
      }
      placed[i].row = row;
    }
    return placed.map((m) => ({ ...m, y: topY + m.row * rowH }));
  }

  function markColor(kind) {
    if (kind === "bought") return "#0a84ff";
    if (kind === "sold" || kind === "profit") return "#00d35a";
    if (kind === "stopped" || kind === "loss") return "#ff453a";
    return "#ffffff";
  }

  function markText(m) {
    if (m.label) return m.label;
    const kind = String(m.kind || "").toLowerCase();
    if (kind === "bought") return "Bought " + (m.symbol || m.name || "X");
    if (kind === "sold") {
      const n = m.usd ?? m.pnl;
      return (n >= 0 ? "+$" : "-$") + Math.abs(Number(n) || 0).toFixed(0);
    }
    if (kind === "stopped") {
      const n = m.usd ?? m.pnl;
      const pct = m.pct != null ? String(m.pct) : "-25%";
      const money = (n < 0 ? "-$" : "+$") + Math.abs(Number(n) || 0).toFixed(0);
      return pct + " · " + money;
    }
    return String(m.text || "");
  }

  let slideStart = 0;
  let lastKey = "";

  function drawEquity(canvas, data, opts) {
    const { ctx, w, h } = sizeCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const points = (data && data.points) || [];
    const marks = (data && data.marks) || [];
    const start = data && data.start != null ? Number(data.start) : (points[0] ? val(points[0]) : 0);
    const reduced = !!(opts && opts.reduced);
    const padL = 4, padR = 4, padT = 28, padB = 10;
    const iw = Math.max(1, w - padL - padR);
    const ih = Math.max(1, h - padT - padB);

    const nums = points.map(val).filter((n) => Number.isFinite(n));
    if (Number.isFinite(start)) nums.push(start);
    const extent = nicePad(Math.min(...nums, start), Math.max(...nums, start));
    const ts = points.map(parseT);
    const t0 = ts.length ? Math.min(...ts) : 0;
    const t1 = ts.length ? Math.max(...ts) : 1;
    const span = t1 - t0 || 1;

    const xOf = (t) => padL + ((t - t0) / span) * iw;
    const yOf = (v) => padT + (1 - (v - extent.min) / (extent.max - extent.min || 1)) * ih;

    // dashed start line
    const ys = yOf(start);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(235,235,245,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, ys);
    ctx.lineTo(padL + iw, ys);
    ctx.stroke();
    ctx.restore();

    if (!points.length) return;

    let coords = points.map((p) => [xOf(parseT(p)), yOf(val(p))]);
    if (coords.length === 1) {
      const y = coords[0][1];
      coords = [[padL, y], [padL + iw, y]];
    }
    const key = (data.range || "") + ":" + points.length + ":" + (points[points.length - 1] && val(points[points.length - 1]));
    const now = performance.now();
    if (!reduced && key !== lastKey && coords.length >= 2) {
      if (lastKey) slideStart = now;
      lastKey = key;
    }
    const elapsed = now - slideStart;
    if (!reduced && elapsed < 250 && coords.length >= 2 && slideStart) {
      const t = elapsed / 250;
      const ease = 1 - Math.pow(1 - t, 3);
      const a = coords[coords.length - 2];
      const b = coords[coords.length - 1];
      coords = coords.slice(0, -1).concat([[a[0] + (b[0] - a[0]) * ease, a[1] + (b[1] - a[1]) * ease]]);
      requestAnimationFrame(() => drawEquity(canvas, data, opts));
    }

    const path = () => {
      ctx.beginPath();
      coords.forEach((c, i) => (i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
    };

    // fill under the line (allowed; cards themselves have no gradient)
    path();
    ctx.lineTo(coords[coords.length - 1][0], padT + ih);
    ctx.lineTo(coords[0][0], padT + ih);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, padT, 0, padT + ih);
    g.addColorStop(0, "rgba(0,211,90,0.28)");
    g.addColorStop(1, "rgba(0,211,90,0)");
    ctx.fillStyle = g;
    ctx.fill();

    path();
    ctx.strokeStyle = "#00d35a";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const laid = layoutMarks(marks, xOf, 4, 14);
    ctx.font = "500 10px " + (getComputedStyle(document.body).fontFamily || "system-ui");
    ctx.textBaseline = "top";
    laid.forEach((m) => {
      const text = markText(m);
      if (!text) return;
      ctx.fillStyle = markColor(String(m.kind || "").toLowerCase());
      const tw = ctx.measureText(text).width;
      const x = Math.min(Math.max(m.x - tw / 2, 0), w - tw);
      ctx.fillText(text, x, m.y);
    });
  }

  function drawCandles(canvas, data) {
    const { ctx, w, h } = sizeCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const candles = (data && data.candles) || [];
    const exitLine = data && data.exit_line != null ? Number(data.exit_line) : null;
    const padL = 8, padR = 8, padT = 10, padB = 10;
    const iw = Math.max(1, w - padL - padR);
    const ih = Math.max(1, h - padT - padB);
    if (!candles.length) return;
    const highs = candles.map((c) => Number(c.h ?? c.c ?? c.price));
    const lows = candles.map((c) => Number(c.l ?? c.c ?? c.price));
    if (exitLine != null) { highs.push(exitLine); lows.push(exitLine); }
    const extent = nicePad(Math.min(...lows), Math.max(...highs));
    const yOf = (v) => padT + (1 - (v - extent.min) / (extent.max - extent.min || 1)) * ih;
    const n = candles.length;
    const slot = iw / n;
    const bodyW = Math.max(1, Math.min(8, slot * 0.6));

    if (exitLine != null) {
      const y = yOf(exitLine);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "#ff9f0a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + iw, y);
      ctx.stroke();
      ctx.restore();
    }

    candles.forEach((c, i) => {
      const o = Number(c.o ?? c.c);
      const cl = Number(c.c);
      const hi = Number(c.h ?? cl);
      const lo = Number(c.l ?? cl);
      const up = cl >= o;
      const x = padL + slot * i + slot / 2;
      ctx.strokeStyle = up ? "#00d35a" : "#ff453a";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(hi));
      ctx.lineTo(x, yOf(lo));
      ctx.stroke();
      const y1 = yOf(Math.max(o, cl));
      const y2 = yOf(Math.min(o, cl));
      const bh = Math.max(1, y2 - y1);
      ctx.fillRect(x - bodyW / 2, y1, bodyW, bh);
    });
  }

  global.DeskCharts = { drawEquity, drawCandles, sizeCanvas };
})(window);
