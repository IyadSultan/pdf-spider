/* Paper spider, in the browser.
   The page drawing and the walking spider stay here.
   Each "Find it" click is counted by the Django server. After 10, the account locks. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const doc = $("doc"), fx = $("fx"), ctx = fx.getContext("2d"), bar = $("bar");
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cfg = window.PAPER_SPIDER || { usesLeft: 0, maxUses: 10, unlimited: false, claudeReady: false, locked: false };

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  /* ---------- document state ---------- */
  const S = {
    words: [], pages: [], baseW: 1, H: 1, mode: "text", grid: new Map(),
    big: "", cw: null, lit: new Set(), quote: null, box: null, boxOn: false,
  };
  let U = 1;
  const CELL = 64;

  function resetDoc() {
    doc.innerHTML = "";
    S.words = [];
    S.pages = [];
    S.grid = new Map();
    S.big = "";
    S.cw = null;
    S.lit = new Set();
    S.quote = null;
    S.box = null;
    S.boxOn = false;
    mission = null;
    $("result").hidden = true;
    $("note").textContent = "";
  }

  function docWidth() {
    return Math.max(280, Math.min(900, doc.clientWidth || innerWidth));
  }

  function norm(s) {
    return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
  }

  function finishDoc() {
    S.H = S.pages.reduce((a, p) => a + p.h, 0);
    U = clamp(S.baseW / 900, 0.6, 1);
    S.words.forEach((w, i) => {
      const k = Math.floor((w.x + w.w / 2) / CELL) + "," + Math.floor((w.y + w.h / 2) / CELL);
      let a = S.grid.get(k);
      if (!a) S.grid.set(k, (a = []));
      a.push(i);
    });
    if (S.mode === "text") {
      let big = "";
      const cw = [];
      S.words.forEach((w, i) => {
        const n = norm(w.t);
        for (let j = 0; j < n.length; j++) cw.push(i);
        big += n;
      });
      S.big = big;
      S.cw = cw;
    }
    sp.x = S.baseW / 2;
    sp.y = Math.min(S.H * 0.5, 120 * U);
    sp.h = Math.PI / 2;
    sp.mode = "idle";
    sp.wait = 0.6;
    sp.tx = sp.x;
    sp.ty = sp.y;
    initLegs();
  }

  function addWords(str, x, y, w, h) {
    const per = w / Math.max(1, str.length);
    const re = /\S+/g;
    let m;
    while ((m = re.exec(str))) {
      S.words.push({ t: m[0], x: x + m.index * per, y: y, w: m[0].length * per, h: h });
    }
  }

  function inkFootholds(canvas, y0, cssW, cssH) {
    const c = document.createElement("canvas");
    c.width = Math.round(cssW);
    c.height = Math.round(cssH);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(canvas, 0, 0, c.width, c.height);
    let d;
    try {
      d = g.getImageData(0, 0, c.width, c.height).data;
    } catch (e) {
      console.error("[paper.js inkFootholds] Could not read the page picture", e);
      return;
    }
    const cs = Math.max(8, Math.round(12 * clamp(cssW / 900, 0.6, 1)));
    for (let cy = 0; cy + cs <= c.height; cy += cs) {
      for (let cx = 0; cx + cs <= c.width; cx += cs) {
        let mn = 255, mx = 0;
        for (let yy = cy; yy < cy + cs; yy += 2) {
          for (let xx = cx; xx < cx + cs; xx += 2) {
            const o = (yy * c.width + xx) * 4;
            const l = (d[o] * 3 + d[o + 1] * 6 + d[o + 2]) / 10;
            if (l < mn) mn = l;
            if (l > mx) mx = l;
          }
        }
        if (mx - mn > 80) S.words.push({ t: "", x: cx, y: y0 + cy, w: cs, h: cs });
      }
    }
  }

  /* ---------- loaders ---------- */
  async function loadPdf(buf) {
    if (!window.pdfjsLib) throw new Error("nolib");
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    resetDoc();
    S.mode = "text";
    const W = docWidth();
    S.baseW = W;
    const n = pdf.numPages;
    let y = 0;
    let dpr = Math.min(devicePixelRatio || 1, 2);
    if (W > 700) dpr = Math.min(dpr, 1.5);
    for (let p = 1; p <= n; p++) {
      status("Opening page " + p + " of " + n + "…");
      const page = await pdf.getPage(p);
      const sc = W / page.getViewport({ scale: 1 }).width;
      const vp = page.getViewport({ scale: sc });
      const c = document.createElement("canvas");
      c.className = "page";
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      doc.append(c);
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: page.getViewport({ scale: sc * dpr }) }).promise;
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]) || 10;
        addWords(it.str, tx[4], y + tx[5] - h * 0.85, it.width * sc, h);
      }
      S.pages.push({ y0: y, h: vp.height, canvas: c });
      y += vp.height;
    }
    if (S.words.length < 20) {
      S.words = [];
      S.mode = "ink";
      for (const pg of S.pages) inkFootholds(pg.canvas, pg.y0, W, pg.h);
    }
    finishDoc();
    $("note").textContent = S.mode === "ink"
      ? "This PDF has no text layer, so Claude reads it as pictures and the highlight is approximate."
      : "";
    status("");
  }

  async function loadImage(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch (e) {
      console.error("[paper.js loadImage] createImageBitmap failed, trying a fallback", e);
      bmp = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onerror = no;
        r.onload = () => {
          const im = new Image();
          im.onload = () => ok(im);
          im.onerror = no;
          im.src = r.result;
        };
        r.readAsDataURL(file);
      });
    }
    resetDoc();
    S.mode = "ink";
    const W = docWidth();
    S.baseW = W;
    const h = (W * bmp.height) / bmp.width;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const c = document.createElement("canvas");
    c.className = "page";
    c.width = Math.round(W * dpr);
    c.height = Math.round(h * dpr);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    doc.append(c);
    S.pages.push({ y0: 0, h: h, canvas: c });
    inkFootholds(c, 0, W, h);
    setNight(false);
    finishDoc();
    $("note").textContent = "Claude reads an image as a picture, so the highlight is an approximate box.";
    status("");
  }

  function loadSample() {
    resetDoc();
    S.mode = "text";
    const W = docWidth();
    S.baseW = W;
    const m = Math.round(W * 0.07), bw = W - 2 * m;
    const fs = clamp(W * 0.031, 12, 19);
    const blocks = [
      { t: "Web tension and prey capture in the garden orb-weaver", f: "600 " + fs * 1.8 + "px Georgia, serif", lh: fs * 2.15, gap: fs * 0.6 },
      { t: "A sample page with invented text, so the spider has something to read. Open your own paper below.", f: "italic " + fs * 0.92 + "px Georgia, serif", lh: fs * 1.4, gap: fs * 1.6 },
      { t: "Abstract", f: "600 " + fs * 1.15 + "px Georgia, serif", lh: fs * 1.6, gap: fs * 0.4 },
      { t: "Orb-weaving spiders rebuild their webs most nights, yet how much they adjust thread tension to the prey they expect is poorly understood.", f: fs + "px Georgia, serif", lh: fs * 1.55, gap: fs * 0.8 },
      { t: "We filmed 64 webs over three weeks, measured radial thread tension with a calibrated micro-probe, and logged every prey strike.", f: fs + "px Georgia, serif", lh: fs * 1.55, gap: fs * 0.8 },
      { t: "Webs rebuilt after a night of large prey carried 31 percent higher radial tension than webs rebuilt after small prey. Capture success for large insects rose from 42 to 58 percent, while capture of small insects did not change. Spiders fed to satiety built smaller webs with wider mesh.", f: fs + "px Georgia, serif", lh: fs * 1.55, gap: fs * 0.8 },
      { t: "Garden orb-weavers tune web tension to recent prey size, which suggests the web works as a short-term memory of what the spider last caught.", f: fs + "px Georgia, serif", lh: fs * 1.55, gap: fs * 0.8 },
      { t: "Observations came from one garden in one season, and tension was measured only on radial threads.", f: fs + "px Georgia, serif", lh: fs * 1.55, gap: fs * 0.8 },
    ];
    const mc = document.createElement("canvas").getContext("2d");
    const items = [];
    let y = m * 1.2;
    for (const b of blocks) {
      mc.font = b.f;
      const sw = mc.measureText(" ").width;
      const size = parseFloat(b.f.match(/([\d.]+)px/)[1]);
      let x = m;
      for (const w of b.t.split(" ")) {
        const ww = mc.measureText(w).width;
        if (x + ww > m + bw && x > m) {
          x = m;
          y += b.lh;
        }
        items.push({ t: w, x: x, y: y, w: ww, size: size, f: b.f });
        x += ww + sw;
      }
      y += b.lh + b.gap;
    }
    const H = Math.max(y + m, innerHeight * 0.55);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const c = document.createElement("canvas");
    c.className = "page";
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#111";
    g.textBaseline = "alphabetic";
    for (const it of items) {
      g.font = it.f;
      g.fillText(it.t, it.x, it.y + it.size);
      S.words.push({ t: it.t, x: it.x, y: it.y + it.size * 0.18, w: it.w, h: it.size });
    }
    doc.append(c);
    S.pages.push({ y0: 0, h: H, canvas: c });
    finishDoc();
  }

  /* ---------- spider ---------- */
  const sp = { x: 0, y: 0, h: 0, vx: 0, vy: 0, tx: 0, ty: 0, speed: 90, legs: [], mode: "idle", wait: 1, path: [] };
  const ANG = [0.55, 1.1, 1.75, 2.4];
  let mission = null;

  function ideal(l) {
    const a = sp.h + l.ang, R = l.reach * U;
    return [sp.x + Math.cos(a) * R + sp.vx * 0.12, sp.y + Math.sin(a) * R + sp.vy * 0.12];
  }

  function initLegs() {
    sp.legs = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const l = { side: side, i: i, ang: side * ANG[i], reach: i === 0 || i === 3 ? 70 : 58, t: 1, word: -1 };
        const p = ideal(l);
        l.fx = l.sx = l.tx = p[0];
        l.fy = l.sy = l.ty = p[1];
        sp.legs.push(l);
      }
    }
  }

  function foothold(ix, iy) {
    const gx = Math.floor(ix / CELL), gy = Math.floor(iy / CELL);
    let best = -1, bd = 26 * U, bx = ix, by = iy;
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gy - 1; b <= gy + 1; b++) {
        const arr = S.grid.get(a + "," + b);
        if (!arr) continue;
        for (const i of arr) {
          if (S.lit.has(i)) continue;
          const w = S.words[i];
          const px = clamp(ix, w.x, w.x + w.w), py = clamp(iy, w.y, w.y + w.h);
          const d = Math.hypot(px - ix, py - iy);
          if (d < bd) {
            bd = d;
            best = i;
            bx = px;
            by = py;
          }
        }
      }
    }
    return { x: bx, y: by, word: best };
  }

  function stepLegs(dt) {
    let stepping = 0;
    for (const l of sp.legs) if (l.t < 1) stepping++;
    for (const l of sp.legs) {
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / 0.1);
        const e = l.t * l.t * (3 - 2 * l.t);
        l.fx = l.sx + (l.tx - l.sx) * e;
        l.fy = l.sy + (l.ty - l.sy) * e;
        continue;
      }
      const p = ideal(l), d = Math.hypot(p[0] - l.fx, p[1] - l.fy), R = l.reach * U;
      const nb = sp.legs.some((o) => o.side === l.side && Math.abs(o.i - l.i) === 1 && o.t < 1);
      if (d > R * 1.8 || (d > R * 0.55 && stepping < 4 && !nb)) {
        const f = foothold(p[0], p[1]);
        l.sx = l.fx;
        l.sy = l.fy;
        l.tx = f.x;
        l.ty = f.y;
        l.word = f.word;
        l.t = 0;
        stepping++;
      }
    }
  }

  function visibleRange() {
    const r = doc.getBoundingClientRect(), k = r.width / S.baseW;
    return [
      clamp(-r.top / k, 0, S.H),
      clamp((innerHeight - bar.offsetHeight - r.top) / k, 0, S.H),
    ];
  }

  function randomVisible() {
    const v = visibleRange();
    if (S.words.length) {
      for (let n = 0; n < 30; n++) {
        const w = S.words[(Math.random() * S.words.length) | 0];
        if (w.y > v[0] + 20 && w.y < v[1] - 20) return [w.x + w.w / 2, w.y + w.h / 2];
      }
    }
    return [S.baseW * (0.15 + Math.random() * 0.7), v[0] + (v[1] - v[0]) * (0.2 + Math.random() * 0.6)];
  }

  function arrive(dt) {
    sp.vx = sp.vy = 0;
    if (sp.mode === "go") {
      if (mission && mission.i === 0 && mission.box) S.boxOn = true;
      if (sp.path.length) {
        const p = sp.path.shift();
        sp.tx = p[0];
        sp.ty = p[1];
        sp.speed = 210 * U;
        if (mission) mission.i++;
      } else {
        sp.mode = "rest";
        if (mission && mission.words) {
          for (let i = mission.words[0]; i <= mission.words[1]; i++) S.lit.add(i);
        }
      }
      return;
    }
    if (sp.mode === "rest" || RM) return;
    sp.wait -= dt;
    if (sp.wait > 0) return;
    const p = randomVisible();
    sp.tx = p[0];
    sp.ty = p[1];
    if (sp.mode === "seek") {
      sp.speed = 280 * U;
      sp.wait = 0.12;
    } else {
      sp.mode = "idle";
      sp.speed = 95 * U;
      sp.wait = 1.2 + Math.random() * 2;
    }
  }

  function clearHome() {
    sp.homeX = null;
  }

  /* A small sway and a leg tap after the spider stops, so it does not look frozen. */
  function settleAlive(dt) {
    if (sp.homeX == null) {
      sp.homeX = sp.x;
      sp.homeY = sp.y;
      sp.homeH = sp.h;
      sp.alive = 0;
      sp.legWait = 0.5;
    }
    sp.alive += dt;
    const fade = Math.min(1, sp.alive / 0.5);
    const bob = 5.5 * U * fade;
    sp.x = sp.homeX + Math.sin(sp.alive * 1.4) * bob;
    sp.y = sp.homeY + Math.cos(sp.alive * 0.85) * bob * 0.45;
    sp.tx = sp.x;
    sp.ty = sp.y;
    sp.vx = 0;
    sp.vy = 0;
    const want = sp.homeH + Math.sin(sp.alive * 0.6) * 0.4;
    let a = want - sp.h;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    sp.h += a * Math.min(1, dt * 2.2);
  }

  function aliveTap(dt) {
    sp.legWait -= dt;
    if (sp.legWait > 0) return;
    sp.legWait = 0.8 + Math.random() * 1.1;
    const planted = sp.legs.filter((l) => l.t >= 1);
    if (!planted.length) return;
    const l = planted[(Math.random() * planted.length) | 0];
    const f = foothold(l.fx + (Math.random() - 0.5) * 16 * U, l.fy + (Math.random() - 0.5) * 12 * U);
    l.sx = l.fx;
    l.sy = l.fy;
    l.tx = f.x;
    l.ty = f.y;
    l.word = f.word;
    l.t = 0;
  }

  function update(dt) {
    const dx = sp.tx - sp.x, dy = sp.ty - sp.y, d = Math.hypot(dx, dy);
    if (d > 2) {
      clearHome();
      const v = Math.min(sp.speed, d * 5 + 20);
      sp.vx = (dx / d) * v;
      sp.vy = (dy / d) * v;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      if (Math.hypot(sp.tx - sp.x, sp.ty - sp.y) < 2 || v * dt >= d) {
        sp.x = sp.tx;
        sp.y = sp.ty;
        if (sp.mode === "rest") markArrived();
      }
      let a = Math.atan2(dy, dx) - sp.h;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      sp.h += a * Math.min(1, dt * 7);
    } else if (sp.mode === "rest" && !RM) {
      markArrived();
      settleAlive(dt);
    } else {
      arrive(dt);
      const still = Math.hypot(sp.tx - sp.x, sp.ty - sp.y) <= 2;
      if (sp.mode === "idle" && !RM && sp.wait > 0 && still) settleAlive(dt);
      else if (sp.mode !== "rest") clearHome();
    }
    stepLegs(dt);
    if (d <= 2 && (sp.mode === "rest" || sp.mode === "idle") && !RM) aliveTap(dt);
    keepSpiderInFrame();
  }

  /* Keep the spider on the part of the page that is on screen, so scrolling the PDF does not lose it. */
  function keepSpiderInFrame() {
    if (!S.pages.length || sp.mode === "go") return;
    if (mission && !mission.shown) return;
    const r = doc.getBoundingClientRect();
    const k = (r.width / S.baseW) || 1;
    const viewTop = Math.max(r.top, 8);
    const viewBot = Math.min(r.bottom, innerHeight - bar.offsetHeight - 8);
    if (viewBot - viewTop < 80) return;
    const screenY = r.top + sp.y * k;
    const margin = 56;
    if (screenY > viewTop + margin && screenY < viewBot - margin) return;
    const targetScreen = viewTop + (viewBot - viewTop) * 0.42;
    const y = clamp((targetScreen - r.top) / k, 8, Math.max(8, S.H - 8));
    const x = clamp(S.baseW * 0.1, 32 * U, S.baseW - 40 * U);
    sp.x = sp.tx = x;
    sp.y = sp.ty = y;
    sp.homeX = x;
    sp.homeY = y;
    if (sp.homeH == null) sp.homeH = sp.h;
  }

  /* Paint the passage only after the spider has reached it. The quote in the box below can show sooner. */
  function lightMission(m) {
    if (m.words) for (let i = m.words[0]; i <= m.words[1]; i++) S.lit.add(i);
    if (m.box) S.boxOn = true;
  }

  function markArrived() {
    if (!mission || mission.shown || !mission.rest) return;
    if (Math.hypot(sp.x - mission.rest[0], sp.y - mission.rest[1]) > 8) return;
    mission.shown = true;
    lightMission(mission);
  }

  function startMission(m) {
    mission = m;
    m.i = 0;
    m.shown = false;
    S.lit = new Set();
    S.box = m.box || null;
    S.boxOn = false;
    const park = m.rest;
    const focusY = m.focusY == null ? park[1] : m.focusY;
    const r = doc.getBoundingClientRect();
    window.scrollBy(0, r.top + focusY * (r.width / S.baseW) - (innerHeight - bar.offsetHeight) / 2);
    sp.path = [];
    sp.tx = park[0];
    sp.ty = park[1];
    sp.homeX = park[0];
    sp.homeY = park[1];
    sp.mode = "rest";
    const r2 = doc.getBoundingClientRect();
    const k = (r2.width / S.baseW) || 1;
    const screenY = r2.top + sp.y * k;
    const onScreen = screenY > 40 && screenY < innerHeight - bar.offsetHeight - 40;
    const alreadyThere = Math.hypot(sp.x - park[0], sp.y - park[1]) < 3;
    if (!onScreen || RM) {
      sp.x = park[0];
      sp.y = park[1];
      sp.h = -Math.PI / 2;
      initLegs();
      markArrived();
    } else if (alreadyThere) {
      markArrived();
    }
  }

  function parkBeside(x0, y0, y1) {
    const mid = (y0 + y1) / 2;
    const left = x0 - 84 * U;
    if (left > 30 * U) return [left, mid];
    const above = y0 - 58 * U;
    if (above > 18 * U) return [Math.min(S.baseW - 40 * U, x0 + 20 * U), above];
    return [Math.min(S.baseW - 40 * U, x0 + 20 * U), Math.min(S.H - 18, y1 + 58 * U)];
  }

  function missionFromWords(a, b) {
    const lines = [];
    let cur = null, top = Infinity, bottom = 0, x0 = Infinity;
    for (let i = a; i <= b; i++) {
      const w = S.words[i], cy = w.y + w.h / 2;
      top = Math.min(top, w.y);
      bottom = Math.max(bottom, w.y + w.h);
      x0 = Math.min(x0, w.x);
      if (cur && Math.abs(cy - cur.y) < w.h * 0.6) {
        cur.x0 = Math.min(cur.x0, w.x);
        cur.x1 = Math.max(cur.x1, w.x + w.w);
      } else lines.push((cur = { x0: w.x, x1: w.x + w.w, y: cy }));
    }
    return {
      words: [a, b],
      lines: lines,
      focusY: (top + bottom) / 2,
      rest: parkBeside(x0, top, bottom),
    };
  }

  function missionFromBox(bx) {
    const y = (bx.y0 + bx.y1) / 2;
    return {
      box: bx,
      lines: [{ x0: bx.x0, x1: bx.x1, y: y }],
      focusY: y,
      rest: parkBeside(bx.x0, bx.y0, bx.y1),
    };
  }

  /* ---------- drawing ---------- */
  let night = true;
  function setNight(v) {
    night = v;
    doc.classList.toggle("night", v);
    $("night").setAttribute("aria-pressed", String(v));
  }
  function sizeFx() {
    const d = Math.min(devicePixelRatio || 1, 2);
    fx.width = innerWidth * d;
    fx.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  function draw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!S.pages.length) return;
    const r = doc.getBoundingClientRect(), k = r.width / S.baseW;
    const X = (x) => r.left + x * k, Y = (y) => r.top + y * k;
    const cLine = night ? "#6fd6ee" : "#0b6f8a", cDot = night ? "#f0567a" : "#c81e4a", cBox = night ? "#8f9bff" : "#3b47c9";
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left, Math.max(0, r.top), r.width, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
    ctx.clip();
    ctx.fillStyle = night ? "rgba(240,86,122,.38)" : "rgba(200,30,74,.22)";
    for (const i of S.lit) {
      const w = S.words[i];
      ctx.fillRect(X(w.x) - 2, Y(w.y) - 2, w.w * k + 4, w.h * k + 5);
    }
    if (S.box && S.boxOn) {
      const b = S.box;
      ctx.fillRect(X(b.x0), Y(b.y0), (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
      ctx.strokeStyle = cDot;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(X(b.x0), Y(b.y0), (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
      ctx.setLineDash([]);
    }
    if (S.mode === "text") {
      ctx.strokeStyle = cBox;
      ctx.lineWidth = 1.2;
      for (const l of sp.legs) {
        if (l.word >= 0 && l.t >= 1) {
          const w = S.words[l.word];
          ctx.strokeRect(X(w.x) - 2, Y(w.y) - 2, w.w * k + 4, w.h * k + 5);
        }
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, innerWidth, innerHeight);
    for (const i of S.lit) {
      const w = S.words[i];
      ctx.rect(X(w.x) - 3, Y(w.y) - 3, w.w * k + 6, w.h * k + 8);
    }
    if (S.box && S.boxOn) {
      const b = S.box;
      ctx.rect(X(b.x0), Y(b.y0), (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
    }
    ctx.clip("evenodd");
    const s = U * k, fxv = Math.cos(sp.h), fyv = Math.sin(sp.h), rx = -fyv, ry = fxv;
    ctx.lineWidth = Math.max(1.4, 2.2 * s);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = cLine;
    const dots = [];
    for (const l of sp.legs) {
      const hx = sp.x + fxv * (1.5 - l.i) * 7 * U + rx * l.side * 6 * U;
      const hy = sp.y + fyv * (1.5 - l.i) * 7 * U + ry * l.side * 6 * U;
      const dx = l.fx - hx, dy = l.fy - hy, d = Math.hypot(dx, dy) || 1;
      const L = Math.max(l.reach * U * 0.62, d * 0.5 + 0.5);
      const hg = Math.sqrt(Math.max(0, L * L - (d * d) / 4));
      const mx = hx + dx / 2, my = hy + dy / 2;
      let px = -dy / d, py = dx / d;
      const want = l.i < 2 ? 1 : -1;
      if ((px * fxv + py * fyv) * want < 0) {
        px = -px;
        py = -py;
      }
      const kx = mx + px * hg * 0.75, ky = my + py * hg * 0.75;
      ctx.beginPath();
      ctx.moveTo(X(hx), Y(hy));
      ctx.lineTo(X(kx), Y(ky));
      ctx.lineTo(X(l.fx), Y(l.fy));
      ctx.stroke();
      dots.push([l.fx, l.fy], [kx, ky]);
    }
    ctx.fillStyle = cDot;
    for (const p of dots) {
      ctx.beginPath();
      ctx.arc(X(p[0]), Y(p[1]), Math.max(2.2, 3.4 * s), 0, 6.3);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(X(sp.x), Y(sp.y));
    ctx.rotate(sp.h);
    const bl = 40 * s, bw = 15 * s;
    ctx.fillStyle = night ? "#000" : "#fff";
    ctx.strokeStyle = cLine;
    ctx.lineWidth = Math.max(1.4, 2.2 * s);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-bl / 2, -bw / 2, bl, bw, 3 * s);
    else ctx.rect(-bl / 2, -bw / 2, bl, bw);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = night ? "#d8f6ff" : "#0b6f8a";
    ctx.beginPath();
    ctx.arc(bl / 2 - 6 * s, 0, 3.6 * s, 0, 6.3);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    ctx.restore();
  }

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (S.pages.length) {
      update(dt);
      draw();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- finding the passage ---------- */
  function locate(quote) {
    const nq = norm(quote || "");
    if (nq.length < 8 || !S.cw) return null;
    let i = S.big.indexOf(nq), j;
    if (i >= 0) j = i + nq.length - 1;
    else {
      const n = Math.min(30, nq.length >> 1);
      i = S.big.indexOf(nq.slice(0, n));
      if (i < 0) return null;
      const t = S.big.indexOf(nq.slice(-n), i);
      j = t >= 0 && t - i < nq.length * 1.5 ? t + n - 1 : Math.min(S.big.length - 1, i + nq.length - 1);
    }
    return [S.cw[i], S.cw[j]];
  }

  const STOP = new Set(
    "the a an of in on to and or for with this that is are was were be find most what which paper study article show me it its from by as at important main key".split(" ")
  );
  const CUES = /(significan|conclu|we found|found that|demonstrat|result|show(s|ed)? that|suggest|improv|associated|higher|lower|increase|decrease|reduc|survival|percent|%|p\s*[<=])/gi;

  function keywordMatch(q) {
    const terms = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !STOP.has(t));
    let best = null, bs = -1, a = 0;
    const W = S.words;
    for (let i = 0; i < W.length; i++) {
      const len = i - a + 1;
      if ((len >= 6 && /[.!?]["')\]]?$/.test(W[i].t)) || len >= 60 || i === W.length - 1) {
        if (foundRanges.some((r) => !(i < r[0] || a > r[1]))) {
          a = i + 1;
          continue;
        }
        const text = W.slice(a, i + 1).map((w) => w.t).join(" ");
        const low = text.toLowerCase();
        let s = 0;
        for (const t of terms) if (low.includes(t)) s += 2;
        s += (low.match(CUES) || []).length;
        if (len < 8) s -= 2;
        if ((text.match(/\d/g) || []).length > text.length * 0.25) s -= 3;
        if (s > bs) {
          bs = s;
          best = [a, i];
        }
        a = i + 1;
      }
    }
    return best;
  }

  const COPY = {
    not_granted: "Claude wasn't allowed. Check the API key in Replit Secrets.",
    rate_limited: "Claude is busy right now. Try again in a minute.",
    failed: "Claude couldn't answer.",
  };
  let busy = false, ctl = null, lastMission = null;
  let foundRanges = [], foundQuotes = [], currentPaperId = null;

  function rangesOverlap(a, b) {
    return a[0] <= b[1] && b[0] <= a[1];
  }

  function quoteAlreadyFound(quote) {
    const n = norm(quote || "");
    if (n.length < 8) return false;
    return foundQuotes.some((prev) => {
      const p = norm(prev);
      return p && (p === n || p.includes(n) || n.includes(p));
    });
  }

  function locateFresh(quote) {
    const range = locate(quote);
    if (!range || quoteAlreadyFound(quote) || foundRanges.some((prev) => rangesOverlap(range, prev))) return null;
    return range;
  }

  function status(t) {
    $("status").textContent = t;
  }

  function renderUses(left, max) {
    if (cfg.unlimited) {
      $("uses").textContent = "Unlimited";
      return;
    }
    $("uses").textContent = left + " of " + max + " searches left";
  }

  function lockUi() {
    cfg.locked = true;
    $("go").disabled = true;
    $("more").disabled = true;
    $("file").disabled = true;
    $("q").disabled = true;
    $("uses").textContent = "Locked";
    status("This account is locked. You have used all " + cfg.maxUses + " searches.");
  }

  function renderPast(items) {
    const list = $("pastList");
    list.replaceChildren();
    if (!items || !items.length) {
      $("past").hidden = true;
      return;
    }
    $("past").hidden = false;
    for (const item of items) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link";
      button.textContent = item.question;
      button.onclick = () => showSaved(item);
      const quote = document.createElement("p");
      quote.textContent = "“" + item.quote + "”";
      li.append(button, quote);
      if (item.why) {
        const why = document.createElement("p");
        why.textContent = item.why;
        li.append(why);
      }
      list.append(li);
    }
  }

  function showSaved(item) {
    const range = locate(item.quote);
    if (!range) {
      status("That saved passage is not on the pages open now.");
      return;
    }
    if (!quoteAlreadyFound(item.quote)) {
      foundQuotes.push(item.quote);
      foundRanges.push(range);
    }
    status("");
    showResult(item.quote, item.why, "Saved highlight.", missionFromWords(range[0], range[1]));
    $("more").hidden = cfg.locked;
  }

  function showResult(quote, why, src, m) {
    $("quote").textContent = "“" + quote + "”";
    $("why").textContent = why || "";
    $("srcText").textContent = src;
    $("result").hidden = false;
    lastMission = m;
    startMission(m);
  }

  async function rememberHighlight(question, quote, why) {
    if (!currentPaperId || !quote) return;
    try {
      const res = await fetch(cfg.saveHighlightUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": cfg.csrfToken },
        body: JSON.stringify({ paper_id: currentPaperId, question: question, quote: quote, why: why || "" }),
      });
      if (!res.ok) {
        console.error("[paper.js rememberHighlight] Could not save the highlight", res.status);
        return;
      }
      const item = { question: question, quote: quote, why: why || "" };
      const list = $("pastList");
      if ($("past").hidden) renderPast([item]);
      else {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "link";
        button.textContent = question;
        button.onclick = () => showSaved(item);
        const line = document.createElement("p");
        line.textContent = "“" + quote + "”";
        li.append(button, line);
        list.append(li);
        $("past").hidden = false;
      }
    } catch (e) {
      console.error("[paper.js rememberHighlight] Could not save the highlight", e);
    }
  }

  async function saveUploadedPdf(filename, buffer) {
    status("Saving your PDF…");
    const body = new FormData();
    body.append("file", new Blob([buffer], { type: "application/pdf" }), filename || "paper.pdf");
    try {
      const res = await fetch(cfg.savePaperUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRFToken": cfg.csrfToken },
        body: body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[paper.js saveUploadedPdf] Save failed", data);
        currentPaperId = null;
        status(data.message || "The PDF opened, but it could not be saved.");
        return;
      }
      currentPaperId = data.id;
      foundRanges = [];
      foundQuotes = [];
      renderPast([]);
      status("Saved as " + data.stored_name);
    } catch (e) {
      console.error("[paper.js saveUploadedPdf] Save failed", e);
      currentPaperId = null;
      status("The PDF opened, but it could not be saved.");
    }
  }

  function toBlob(c, type) {
    return new Promise((ok) => c.toBlob(ok, type, 0.85));
  }

  function blobToDataUrl(blob) {
    return new Promise((ok, no) => {
      const reader = new FileReader();
      reader.onerror = () => no(new Error("A page image could not be prepared."));
      reader.onload = () => ok(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  /* Asks the server to count this search, then optionally ask Claude. */
  async function askServer(body) {
    let res;
    try {
      res = await fetch(cfg.askUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": cfg.csrfToken,
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      console.error("[paper.js askServer] The search request failed", e);
      const err = new Error("The search could not reach the server.");
      err.code = "failed";
      throw err;
    }
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      console.error("[paper.js askServer] The server reply was not JSON", e);
    }
    if (res.status === 403 && data.locked) {
      lockUi();
      const err = new Error(data.message || "This account is locked.");
      err.code = "locked";
      throw err;
    }
    if (!res.ok) {
      const err = new Error(data.message || "The search could not be completed.");
      err.code = data.code || "failed";
      throw err;
    }
    if (data.unlimited) cfg.unlimited = true;
    cfg.usesLeft = data.uses_left;
    renderUses(data.uses_left, data.max_uses || cfg.maxUses);
    return data;
  }

  function keepFind(range, quote, why, src, mission) {
    foundRanges.push(range);
    foundQuotes.push(quote);
    status("");
    showResult(quote, why, src, mission);
    $("more").hidden = false;
    rememberHighlight($("q").value.trim() || "Find the most important finding in this paper", quote, why);
  }

  async function findInText(q, exclude) {
    status(cfg.claudeReady ? "Claude is reading. This can take up to a minute." : "Searching the page…");
    const data = await askServer({
      mode: "text",
      question: q,
      document_text: S.words.map((w) => w.t).join(" ").slice(0, 110000),
      exclude_quotes: exclude || [],
    });
    let range = null, why = "", src = "", note = "";
    const d = data.answer;
    if (d && d.quote) {
      range = locateFresh(d.quote);
      why = d.why || "";
      if (range) src = "Chosen by Claude.";
      else note = "Claude's quote couldn't be matched on a new part of the page. ";
    } else if (data.claude_error && data.claude_error !== "not_configured") {
      note = (COPY[data.claude_error] || "Claude couldn't answer.") + " ";
    } else {
      note = "Claude isn't set up on this server, so this search uses keyword matching. ";
    }
    if (!range) {
      range = keywordMatch(q);
      why = "Closest sentence by overlap with your words and result-style phrasing.";
      src = note + "Keyword match, not Claude.";
    }
    if (!range) {
      status(exclude && exclude.length ? "No other passage found for this question." : "No readable sentences found in this document.");
      sp.mode = "idle";
      if (data.locked) lockUi();
      return;
    }
    const quote = S.words.slice(range[0], range[1] + 1).map((w) => w.t).join(" ");
    keepFind(range, quote, why, src, missionFromWords(range[0], range[1]));
    if (data.locked) lockUi();
  }

  async function findInImage(q, exclude) {
    if (!cfg.claudeReady) {
      status("This file has no selectable text. Reading it as a picture needs a Claude API key on the server.");
      sp.mode = "idle";
      return;
    }
    status("Claude is looking at the page. This can take up to a minute.");
    const pages = S.pages;
    const images = [];
    for (const page of pages) {
      const blob = await toBlob(page.canvas, "image/jpeg");
      if (!blob) throw new Error("A page image could not be prepared.");
      images.push(await blobToDataUrl(blob));
    }
    const data = await askServer({ mode: "image", question: q, images: images, exclude_quotes: exclude || [] });
    const d = data.answer;
    if (d && quoteAlreadyFound(d.quote)) {
      status("No other passage found for this question.");
      sp.mode = "idle";
      if (data.locked) lockUi();
      return;
    }
    const b = d && Array.isArray(d.box) && d.box.length === 4 ? d.box.map(Number) : null;
    if (!b || b.some((v) => !isFinite(v))) {
      status(COPY[data.claude_error] || "Claude answered but gave no location. Try rewording the request.");
      sp.mode = "idle";
      if (data.locked) lockUi();
      return;
    }
    const pg = pages[clamp((parseInt(d.page, 10) || 1) - 1, 0, pages.length - 1)];
    const f = b.map((v) => clamp(v > 1.5 ? v / 1000 : v, 0, 1));
    const box = {
      x0: Math.min(f[0], f[2]) * S.baseW,
      x1: Math.max(f[0], f[2]) * S.baseW,
      y0: pg.y0 + Math.min(f[1], f[3]) * pg.h,
      y1: pg.y0 + Math.max(f[1], f[3]) * pg.h,
    };
    status("");
    const quote = String(d.quote || "");
    foundQuotes.push(quote);
    showResult(
      quote,
      String(d.why || ""),
      "Chosen by Claude from the picture. The box is approximate.",
      missionFromBox(box)
    );
    $("more").hidden = false;
    rememberHighlight(q, quote, d.why || "");
    if (data.locked) lockUi();
  }

  async function find(more) {
    const again = more === true;
    if (cfg.locked) {
      lockUi();
      return;
    }
    if (busy) {
      if (ctl) ctl.abort();
      return;
    }
    if (!S.pages.length) return;
    const q = $("q").value.trim() || "Find the most important finding in this paper";
    if (!again) {
      foundRanges = [];
      foundQuotes = [];
      $("more").hidden = true;
      $("result").hidden = true;
      S.lit = new Set();
      S.boxOn = false;
    }
    busy = true;
    $("go").textContent = "Stop";
    mission = null;
    sp.mode = "seek";
    sp.wait = 0;
    ctl = new AbortController();
    try {
      const exclude = again ? foundQuotes.slice() : [];
      if (S.mode === "text") await findInText(q, exclude);
      else await findInImage(q, exclude);
    } catch (e) {
      console.error("[paper.js find] Search failed", e);
      if (e && e.name === "AbortError") status("Stopped.");
      else if (!(e && e.code === "locked")) status((e && e.message) || "The search could not be completed.");
      sp.mode = "idle";
    } finally {
      busy = false;
      ctl = null;
      $("go").textContent = "Find it";
      if (cfg.locked) {
        $("go").disabled = true;
        $("more").disabled = true;
      }
    }
  }

  async function loadSavedPaper(url, id, detailUrl) {
    status("Opening your saved PDF…");
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Could not open the saved PDF.");
      await loadPdf(await res.arrayBuffer());
      setNight(true);
      currentPaperId = id;
      foundQuotes = [];
      foundRanges = [];
      let stored = "your saved PDF";
      if (detailUrl) {
        const info = await fetch(detailUrl, { credentials: "same-origin" });
        const data = await info.json().catch(() => ({}));
        if (info.ok && data.highlights) {
          renderPast(data.highlights);
          for (const item of data.highlights) {
            foundQuotes.push(item.quote);
            const range = locate(item.quote);
            if (range) foundRanges.push(range);
          }
        }
        if (data.stored_name) stored = data.stored_name;
      }
      status("Opened " + stored + ".");
    } catch (e) {
      console.error("[paper.js loadSavedPaper] Could not open the saved PDF", e);
      status("That saved PDF could not be opened.");
      if (!S.pages.length) loadSample();
    }
  }

  /* ---------- wiring ---------- */
  $("go").onclick = () => find(false);
  $("more").onclick = () => find(true);
  $("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.blur();
      find();
    }
  });
  $("again").onclick = () => {
    if (lastMission) startMission(lastMission);
  };
  $("night").onclick = () => setNight(!night);
  $("file").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || cfg.locked) return;
    if (busy && ctl) ctl.abort();
    try {
      foundRanges = [];
      foundQuotes = [];
      $("more").hidden = true;
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        status("Opening…");
        const buf = await f.arrayBuffer();
        await loadPdf(buf.slice(0));
        setNight(true);
        await saveUploadedPdf(f.name, buf);
      } else if (f.type.startsWith("image/")) {
        currentPaperId = null;
        renderPast([]);
        status("Opening…");
        await loadImage(f);
      } else {
        status("Choose a PDF or an image file.");
        return;
      }
      window.scrollTo(0, 0);
    } catch (err) {
      console.error("[paper.js file] Could not open the file", err);
      status(
        f.type.startsWith("image/")
          ? "This image couldn't be opened. Try a PNG or JPEG."
          : "This PDF couldn't be opened. If it has a password, save an unlocked copy and try again."
      );
      if (!S.pages.length) loadSample();
    }
  };
  doc.addEventListener("click", (e) => {
    if (!S.pages.length || sp.mode === "go" || sp.mode === "seek") return;
    const r = doc.getBoundingClientRect(), k = r.width / S.baseW;
    sp.tx = clamp((e.clientX - r.left) / k, 0, S.baseW);
    sp.ty = clamp((e.clientY - r.top) / k, 0, S.H);
    sp.speed = 300 * U;
    sp.mode = "idle";
    sp.wait = 4;
  });
  addEventListener("resize", sizeFx);
  sizeFx();
  requestAnimationFrame(frame);
  renderUses(cfg.usesLeft, cfg.maxUses);
  if (cfg.openPaperUrl) {
    loadSavedPaper(cfg.openPaperUrl, cfg.openPaperId, cfg.paperDetailUrl);
  } else {
    loadSample();
    if (!cfg.claudeReady) {
      status("Claude isn't set up on this server yet, so text searches use keyword matching.");
    }
  }
})();
