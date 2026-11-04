// The site sketch pad: a resident draws their project on screen, by mouse or finger, on a blank page or over a GIS map of their lot.
// The finished picture goes through the same path as an uploaded drawing: Muse Spark reads it and SAM 3.1 outlines it.
// Marks are kept in "base" coordinates: the page as it first opened, or the map's first view of the lot. Zooming and moving only change
// how base coordinates land on the screen, so a mark stays on its spot on the ground, and the site plan reads it as if nothing had moved.
// CCSketch.open({ parcel, phone, onDone(image, marks, address) }). textContent only; styles go through element.style.
(function () {
  "use strict";
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var INK = "#16233a", NEW = "#c62828";
  var TOOLS = [["pen", "Pen", "Draw freely"], ["line", "Line", "A straight line, such as a property line"], ["proposed", "New line", "A dashed red line for something new, such as a proposed lot line"], ["arrow", "Arrow", "Point at something"], ["box", "Box", "A building or other rectangle"], ["circle", "Circle", "A circle, such as a tree or a well"], ["label", "Label", "Words or a distance in feet"], ["erase", "Erase", "Touch a mark to remove it"], ["move", "Move map", "Drag the map"]];
  var COLORS = [[INK, "Dark blue"], [NEW, "Red"], ["#1f5fbf", "Blue"], ["#2e7d32", "Green"], ["#ef6c00", "Orange"], ["#ffffff", "White"]];
  var SIZES = [["Thin", 4], ["Medium", 7], ["Thick", 12]];
  var LAYERS = [["aerial", "Aerial photo"], ["parcels", "Parcel lines"], ["streets", "Streets"], ["zoning", "Zoning"]];
  var M_PER_DEG = 110574, FEET_PER_M = 3.28084, MIN_METERS = 15, MAX_METERS = 1500;

  /** How far to zoom so the whole lot fills the page. */
  function metersFor(parcel) {
    return Math.round(Math.min(300, Math.max(35, Math.sqrt((parcel.areaSqft || 10000) / 10.76) * 0.85)));
  }
  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    var t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  }
  function arrowHead(a, b, size) {
    var t = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return [[b[0] - size * Math.cos(t - 0.45), b[1] - size * Math.sin(t - 0.45)], [b[0] - size * Math.cos(t + 0.45), b[1] - size * Math.sin(t + 0.45)]];
  }

  function open(opts) {
    var W = opts.phone ? 900 : 1200, H = opts.phone ? 1000 : 900;
    var marks = [], past = [], future = [], current = null, tool = "pen", color = INK, size = 7;
    var base = null;                                  // the map's first view: { lon, lat, meters, parcelId, address }
    var view = { cx: W / 2, cy: H / 2, z: 1 };        // the base point at the middle of the screen, and the zoom
    var layers = { aerial: true, parcels: true, streets: true, zoning: false };
    var photo = null, lines = null, loadId = 0, loadTimer = null, drag = null, erased = false;
    var canvas = el("canvas", { width: String(W), height: String(H), class: "sk-canvas", "aria-label": "Drawing area. Draw your site sketch here." });
    var ctx = canvas.getContext("2d");

    function toScreen(p) { return [(p[0] - view.cx) * view.z + W / 2, (p[1] - view.cy) * view.z + H / 2]; }
    function toBase(p) { return [(p[0] - W / 2) / view.z + view.cx, (p[1] - H / 2) / view.z + view.cy]; }

    function drawMark(m) {
      ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = m.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.setLineDash(m.dash ? [26, 18] : []);
      if (m.type === "label") {
        var at = toScreen([m.x, m.y]);
        ctx.font = "600 34px system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.lineWidth = 8; ctx.strokeStyle = m.color === "#ffffff" ? INK : "#fff"; ctx.setLineDash([]);
        ctx.strokeText(m.text, at[0], at[1]); ctx.fillText(m.text, at[0], at[1]);
        return;
      }
      ctx.beginPath();
      if (m.type === "pen") m.pts.forEach(function (p, i) { var s = toScreen(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      else {
        var a = toScreen(m.a), b = toScreen(m.b);
        if (m.type === "box") ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        else if (m.type === "circle") ctx.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]), 0, Math.PI * 2);
        else {
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
          if (m.type === "arrow") arrowHead(a, b, 18 + m.width * 2).forEach(function (w) { ctx.moveTo(b[0], b[1]); ctx.lineTo(w[0], w[1]); });
        }
      }
      ctx.stroke();
      if (base && m.type !== "pen") drawSize(m);
    }
    // On the map every mark's true size is known, so it shows its own measurement.
    function drawSize(m) {
      var feet = 2 * base.meters / H * FEET_PER_M, dx = Math.abs(m.b[0] - m.a[0]) * feet, dy = Math.abs(m.b[1] - m.a[1]) * feet;
      var text = m.type === "box" ? Math.round(dx) + " x " + Math.round(dy) + " ft" : m.type === "circle" ? Math.round(2 * Math.hypot(dx, dy)) + " ft across" : Math.round(Math.hypot(dx, dy)) + " ft";
      if (Math.hypot(dx, dy) < 1) return;
      var a = toScreen(m.a), b = toScreen(m.b), at = m.type === "circle" ? a : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ctx.setLineDash([]);
      ctx.font = "700 26px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 7; ctx.lineJoin = "round";
      ctx.strokeStyle = "#fff"; ctx.fillStyle = m.color === "#ffffff" ? INK : m.color;
      ctx.strokeText(text, at[0], at[1]); ctx.fillText(text, at[0], at[1]);
      ctx.textAlign = "start";
    }
    // A picture was made for one view; while a new one loads, the old one slides and scales with the map.
    function drawLayer(layer) {
      if (!layer) return;
      var v = layer.view, tl = toScreen([v.cx - W / 2 / v.z, v.cy - H / 2 / v.z]), r = view.z / v.z;
      ctx.drawImage(layer.img, tl[0], tl[1], W * r, H * r);
    }
    function redraw() {
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      if (base) { drawLayer(photo); drawLayer(lines); }
      marks.forEach(drawMark);
      if (current) drawMark(current);
      undo.disabled = !past.length; redo.disabled = !future.length; clear.disabled = use.disabled = !marks.length;
    }
    function remember() { past.push(marks.slice()); if (past.length > 100) past.shift(); future = []; }

    // ---------- the map ----------
    function windowOf(v) {
      var perPx = 2 * base.meters / H / M_PER_DEG, k = Math.cos(base.lat * Math.PI / 180);
      return "lon=" + (base.lon + (v.cx - W / 2) * perPx / k).toFixed(6) + "&lat=" + (base.lat - (v.cy - H / 2) * perPx).toFixed(6) + "&m=" + (base.meters / v.z).toFixed(2) + "&w=" + W + "&h=" + H;
    }
    function picture(src, done, failed) {
      var img = new Image();
      img.onload = function () { done(img); };
      img.onerror = failed || function () {};
      img.src = src;
    }
    function loadMap() {
      if (!base) return;
      var id = ++loadId, v = { cx: view.cx, cy: view.cy, z: view.z }, spot = windowOf(v);
      var names = ["parcels", "streets", "zoning"].filter(function (n) { return layers[n]; }).join(",");
      note.textContent = "Loading the map…";
      var waiting = layers.aerial ? 2 : 1;
      function landed() { if (--waiting === 0 && id === loadId && note.dataset.bad !== "1") note.textContent = ""; }
      note.dataset.bad = "";
      picture("/api/map/sketch.svg?" + spot + "&layers=" + names + (base.parcelId ? "&parcel=" + encodeURIComponent(base.parcelId) : "") + (layers.aerial ? "&photo=1" : ""), function (img) {
        if (id === loadId) { lines = { img: img, view: v }; redraw(); }
        landed();
      }, landed);
      if (layers.aerial) picture("/api/map/aerial.jpg?" + spot, function (img) {
        if (id === loadId) { photo = { img: img, view: v }; redraw(); }
        landed();
      }, function () {
        if (id === loadId) { note.dataset.bad = "1"; note.textContent = "The aerial photo isn't available right now. The other layers still work."; }
        landed();
      });
      else { photo = null; redraw(); }
    }
    function loadSoon() { clearTimeout(loadTimer); loadTimer = setTimeout(loadMap, 250); }
    function zoomBy(f, at) {
      if (!base) return;
      var z = Math.min(base.meters / MIN_METERS, Math.max(base.meters / MAX_METERS, view.z * f)), spot = at || [W / 2, H / 2], keep = toBase(spot);
      view.z = z;
      view.cx = keep[0] - (spot[0] - W / 2) / z; view.cy = keep[1] - (spot[1] - H / 2) / z;
      redraw(); loadSoon();
    }
    function showMap(parcel, why) {
      base = { lon: parcel.centroid[0], lat: parcel.centroid[1], meters: metersFor(parcel), parcelId: parcel.id, address: parcel.address || parcel.id };
      view = { cx: W / 2, cy: H / 2, z: 1 };
      photo = lines = null;
      addressBox.value = parcel.address || "";
      choices.replaceChildren();
      hint.textContent = why || "";
      startRow.classList.add("hidden"); mapRow.classList.remove("hidden"); findRow.classList.remove("hidden");
      moveTool.classList.remove("hidden");
      canvas.setAttribute("aria-label", "Map of " + base.address + ". Draw your site sketch on it.");
      loadMap();
    }
    function blankPage() {
      base = null; photo = lines = null; loadId++;
      view = { cx: W / 2, cy: H / 2, z: 1 };
      note.textContent = ""; hint.textContent = ""; choices.replaceChildren();
      startRow.classList.remove("hidden"); mapRow.classList.add("hidden"); findRow.classList.add("hidden");
      moveTool.classList.add("hidden");
      if (tool === "move") pick("pen");
      redraw();
    }
    async function find() {
      var q = addressBox.value.trim();
      if (!q) { note.textContent = "Type your street address first."; addressBox.focus(); return; }
      note.textContent = "Looking up that address…";
      choices.replaceChildren();
      try {
        var r = await fetch("/api/parcels/lookup?q=" + encodeURIComponent(q));
        var found = await r.json();
        if (found.parcel) { note.textContent = ""; showMap(found.parcel); return; }
        if (found.candidates && found.candidates.length) {
          note.textContent = "Which one is yours?";
          found.candidates.forEach(function (c) {
            var b = el("button", { type: "button", class: "quiet sk-small", text: c.address + " (" + c.areaAcres + " acres)" });
            b.addEventListener("click", function () { note.textContent = ""; showMap(c); });
            choices.appendChild(b);
          });
          return;
        }
        note.textContent = "That address wasn't found in Trust City. Check the street name and number.";
      } catch (e) { note.textContent = "The address lookup didn't work. Please try again."; }
    }

    async function exampleLot() {
      note.textContent = "Finding an example lot…";
      try {
        var r = await fetch("/api/parcels/example" + (base ? "?not=" + encodeURIComponent(base.parcelId) : ""));
        var found = await r.json();
        if (!found.parcel) throw new Error("none");
        note.textContent = "";
        showMap(found.parcel, "Example lot, picked at random for its size and street frontage. Only real City Officials can decide whether a lot can be split.");
      } catch (e) { note.textContent = "No example lot is available right now."; }
    }

    // ---------- drawing ----------
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    }
    function touching(m, p, reach) {
      if (m.type === "label") return Math.abs(p[1] - m.y) < 22 / view.z && p[0] > m.x - reach && p[0] < m.x + m.text.length * 19 / view.z;
      if (m.type === "pen") return m.pts.some(function (q, i) { return i && segDist(p, m.pts[i - 1], q) < reach; });
      if (m.type === "circle") return Math.abs(Math.hypot(p[0] - m.a[0], p[1] - m.a[1]) - Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1])) < reach;
      if (m.type === "box") {
        var c = [m.b[0], m.a[1]], d = [m.a[0], m.b[1]];
        return segDist(p, m.a, c) < reach || segDist(p, c, m.b) < reach || segDist(p, m.b, d) < reach || segDist(p, d, m.a) < reach;
      }
      return segDist(p, m.a, m.b) < reach;
    }
    function eraseAt(p) {
      var left = marks.filter(function (m) { return !touching(m, p, 18 / view.z); });
      if (left.length === marks.length) return;
      if (!erased) { remember(); erased = true; }
      marks = left;
      redraw();
    }
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var s = pos(e), p = toBase(s);
      if (tool === "label") {
        var text = labelBox.value.trim();
        if (!text) { labelBox.focus(); return; }
        remember();
        marks.push({ type: "label", text: text, x: p[0], y: p[1], color: color, width: 1 });
        labelBox.value = "";
        redraw();
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      if (tool === "move") { drag = { at: s, cx: view.cx, cy: view.cy }; return; }
      if (tool === "erase") { drag = { erase: true }; erased = false; eraseAt(p); return; }
      if (tool === "pen") current = { type: "pen", pts: [p], color: color, width: size };
      else if (tool === "proposed") current = { type: "line", a: p, b: p, color: NEW, width: size, dash: true };
      else current = { type: tool, a: p, b: p, color: color, width: size };
    });
    canvas.addEventListener("pointermove", function (e) {
      if (drag && drag.erase) { e.preventDefault(); eraseAt(toBase(pos(e))); return; }
      if (drag) {
        e.preventDefault();
        var s = pos(e);
        view.cx = drag.cx - (s[0] - drag.at[0]) / view.z; view.cy = drag.cy - (s[1] - drag.at[1]) / view.z;
        redraw();
        return;
      }
      if (!current) return;
      e.preventDefault();
      var p = toBase(pos(e));
      if (current.type === "pen") current.pts.push(p); else current.b = p;
      redraw();
    });
    function finish() {
      if (drag) { var moved = !drag.erase; drag = null; if (moved) loadSoon(); return; }
      if (!current) return;
      var c = current, big = c.type === "pen" ? c.pts.length > 1 : Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]) * view.z > 8;
      current = null;
      if (big) { remember(); marks.push(c); }
      redraw();
    }
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("wheel", function (e) {
      if (!base) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.25 : 0.8, pos(e));
    }, { passive: false });

    // ---------- the controls ----------
    var labelBox = el("input", { type: "text", class: "sk-label hidden", maxlength: "40", placeholder: "Type a label, then tap the drawing", "aria-label": "Label text" });
    var toolRow = el("div", { class: "sk-tools", role: "toolbar", "aria-label": "Drawing tools" });
    function pick(name) {
      tool = name;
      Array.prototype.forEach.call(toolRow.querySelectorAll(".sk-tool"), function (x) { x.classList.toggle("on", x.dataset.tool === tool); });
      labelBox.classList.toggle("hidden", tool !== "label");
      canvas.style.cursor = tool === "move" ? "grab" : "";
      if (tool === "label") labelBox.focus();
    }
    TOOLS.forEach(function (t) {
      var b = el("button", { type: "button", class: "sk-tool" + (t[0] === tool ? " on" : "") + (t[0] === "move" ? " hidden" : ""), text: t[1], title: t[2], "data-tool": t[0] });
      b.addEventListener("click", function () { pick(t[0]); });
      toolRow.appendChild(b);
    });
    var moveTool = toolRow.querySelector('[data-tool="move"]');

    var styleRow = el("div", { class: "sk-tools", role: "toolbar", "aria-label": "Color and line thickness" });
    COLORS.forEach(function (c) {
      var b = el("button", { type: "button", class: "sk-swatch" + (c[0] === color ? " on" : ""), title: c[1], "aria-label": c[1] });
      b.style.background = c[0];
      b.addEventListener("click", function () {
        color = c[0];
        Array.prototype.forEach.call(styleRow.querySelectorAll(".sk-swatch"), function (x) { x.classList.toggle("on", x === b); });
      });
      styleRow.appendChild(b);
    });
    SIZES.forEach(function (z) {
      var b = el("button", { type: "button", class: "sk-tool sk-size" + (z[1] === size ? " on" : ""), text: z[0] });
      b.addEventListener("click", function () {
        size = z[1];
        Array.prototype.forEach.call(styleRow.querySelectorAll(".sk-size"), function (x) { x.classList.toggle("on", x === b); });
      });
      styleRow.appendChild(b);
    });
    var undo = el("button", { type: "button", class: "quiet sk-small", text: "Undo" });
    var redo = el("button", { type: "button", class: "quiet sk-small", text: "Redo" });
    var clear = el("button", { type: "button", class: "quiet sk-small", text: "Clear" });
    undo.addEventListener("click", function () { future.push(marks); marks = past.pop(); redraw(); });
    redo.addEventListener("click", function () { past.push(marks); marks = future.pop(); redraw(); });
    clear.addEventListener("click", function () { remember(); marks = []; redraw(); });
    styleRow.appendChild(undo); styleRow.appendChild(redo); styleRow.appendChild(clear);

    var start = el("button", { type: "button", text: "Start with GIS Map" });
    var startRow = el("div", { class: "sk-mapbar" }, [start]);
    var addressBox = el("input", { type: "text", maxlength: "120", placeholder: "Your street address", "aria-label": "Street address" });
    var findBtn = el("button", { type: "button", class: "quiet sk-small", text: "Find" });
    var exampleBtn = el("button", { type: "button", class: "quiet sk-small", text: "Example lot", title: "Show a random lot with room to split" });
    var findRow = el("div", { class: "sk-find hidden" }, [addressBox, findBtn, exampleBtn]);
    var note = el("p", { class: "sk-note", role: "status" });
    var hint = el("p", { class: "sk-note" });
    var choices = el("div", { class: "sk-choices" });
    start.addEventListener("click", function () {
      if (opts.parcel) return showMap(opts.parcel);
      startRow.classList.add("hidden"); findRow.classList.remove("hidden");
      note.textContent = "Type your street address to find your lot.";
      addressBox.focus();
    });
    findBtn.addEventListener("click", find);
    exampleBtn.addEventListener("click", exampleLot);
    addressBox.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); find(); } });

    var zoomOut = el("button", { type: "button", class: "quiet sk-small", text: "− Zoom out" });
    var zoomIn = el("button", { type: "button", class: "quiet sk-small", text: "+ Zoom in" });
    var blank = el("button", { type: "button", class: "quiet sk-small", text: "Back to blank page" });
    zoomOut.addEventListener("click", function () { zoomBy(0.7); });
    zoomIn.addEventListener("click", function () { zoomBy(1 / 0.7); });
    blank.addEventListener("click", blankPage);
    var layerRow = el("div", { class: "sk-layers", role: "group", "aria-label": "Map layers" });
    LAYERS.forEach(function (l) {
      var box = el("input", { type: "checkbox" });
      box.checked = layers[l[0]];
      box.addEventListener("change", function () { layers[l[0]] = box.checked; loadMap(); });
      layerRow.appendChild(el("label", null, [box, el("span", { text: l[1] })]));
    });
    var mapRow = el("div", { class: "sk-mapbar hidden" }, [zoomOut, zoomIn, layerRow, blank]);

    var cancel = el("button", { type: "button", class: "quiet", text: "Cancel" });
    var use = el("button", { type: "button", text: "Use this sketch" });
    var overlay = el("div", { class: "sk-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Draw a site sketch" }, [
      el("div", { class: "sk-panel" }, [
        el("h2", { text: "Draw a site sketch" }),
        el("p", { class: "small sk-tip", text: "Show your lot lines, buildings and the road. Use New line for what you want to change. On the GIS map, what you draw measures itself. It doesn't need to be perfect; staff will check every measurement." }),
        startRow, findRow, mapRow, note, hint, choices, toolRow, styleRow, labelBox,
        el("div", { class: "sk-stage" }, [canvas]),
        el("div", { class: "sk-actions" }, [cancel, use]),
      ]),
    ]);
    function close() { clearTimeout(loadTimer); document.removeEventListener("keydown", onKey); overlay.remove(); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    cancel.addEventListener("click", close);
    use.addEventListener("click", function () {
      var image = { mime: "image/jpeg", base64: canvas.toDataURL("image/jpeg", 0.88).split(",")[1] };
      // The site plan knows lines, boxes and free drawing, so circles and arrows go to it as free drawing.
      var items = marks.map(function (m) {
        if (m.type === "circle") {
          var r = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]), pts = [];
          for (var i = 0; i <= 32; i++) pts.push([m.a[0] + r * Math.cos(i * Math.PI / 16), m.a[1] + r * Math.sin(i * Math.PI / 16)]);
          return { type: "pen", pts: pts };
        }
        if (m.type === "arrow") { var w = arrowHead(m.a, m.b, 30 / view.z); return { type: "pen", pts: [m.a, m.b, w[0], m.b, w[1]] }; }
        return m;
      });
      // Over the map, each mark's real position is known. That is what lets the site plan be exact.
      var map = base ? { meters: base.meters, svg: [W, H], box: [0, 0, W, H], parcel: base.parcelId } : null;
      var address = base ? base.address : "";
      close();
      opts.onDone(image, { items: items, map: map }, address);
    });
    document.body.appendChild(overlay);
    redraw();
  }

  window.CCSketch = { open: open };
})();
