// The site sketch pad: a resident draws their project on screen, by mouse or finger, on a blank page or over their parcel map.
// The finished picture goes through the same path as an uploaded drawing: Muse Spark reads it and SAM 3.1 outlines it.
// CCSketch.open({ parcel, phone, onDone(image) }). textContent only; styles go through element.style.
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
  var TOOLS = [["pen", "Pen", "Draw freely"], ["line", "Line", "A straight line, such as a property line"], ["proposed", "New line", "A dashed red line for something new, such as a proposed lot line"], ["box", "Box", "A building, shed or other structure"], ["label", "Label", "Write a name or a distance, such as 80 ft"]];

  /** How far to zoom so the whole lot fills the page. */
  function metersFor(parcel) {
    return Math.round(Math.min(300, Math.max(35, Math.sqrt((parcel.areaSqft || 10000) / 10.76) * 0.85)));
  }

  function open(opts) {
    var W = opts.phone ? 900 : 1200, H = opts.phone ? 1000 : 900;
    var marks = [], current = null, tool = "pen", background = null, useMap = !!opts.parcel;
    var canvas = el("canvas", { width: String(W), height: String(H), class: "sk-canvas", "aria-label": "Drawing area. Draw your site sketch here." });
    var ctx = canvas.getContext("2d");

    function drawMark(m) {
      ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = m.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.setLineDash(m.dash ? [26, 18] : []);
      if (m.type === "label") {
        ctx.font = "600 34px system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.lineWidth = 8; ctx.strokeStyle = "#fff"; ctx.setLineDash([]);
        ctx.strokeText(m.text, m.x, m.y); ctx.fillText(m.text, m.x, m.y);
        return;
      }
      ctx.beginPath();
      if (m.type === "box") ctx.rect(Math.min(m.a[0], m.b[0]), Math.min(m.a[1], m.b[1]), Math.abs(m.b[0] - m.a[0]), Math.abs(m.b[1] - m.a[1]));
      else if (m.type === "line") { ctx.moveTo(m.a[0], m.a[1]); ctx.lineTo(m.b[0], m.b[1]); }
      else m.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.stroke();
    }
    function redraw() {
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      if (useMap && background) {
        var s = Math.min(W / background.naturalWidth, H / background.naturalHeight), w = background.naturalWidth * s, h = background.naturalHeight * s;
        ctx.drawImage(background, (W - w) / 2, (H - h) / 2, w, h);
      }
      marks.forEach(drawMark);
      if (current) drawMark(current);
      undo.disabled = clear.disabled = !marks.length;
      use.disabled = !marks.length;
    }
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
    }
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var p = pos(e);
      if (tool === "label") {
        var text = labelBox.value.trim();
        if (!text) { labelBox.focus(); return; }
        marks.push({ type: "label", text: text, x: p[0], y: p[1], color: INK, width: 1 });
        labelBox.value = "";
        redraw();
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      if (tool === "pen") current = { type: "pen", pts: [p], color: INK, width: 6 };
      else if (tool === "box") current = { type: "box", a: p, b: p, color: INK, width: 7 };
      else current = { type: "line", a: p, b: p, color: tool === "proposed" ? NEW : INK, width: 7, dash: tool === "proposed" };
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!current) return;
      e.preventDefault();
      var p = pos(e);
      if (current.type === "pen") current.pts.push(p); else current.b = p;
      redraw();
    });
    function finish() {
      if (!current) return;
      var c = current, big = c.type === "pen" ? c.pts.length > 1 : Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]) > 8;
      current = null;
      if (big) marks.push(c);
      redraw();
    }
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    var labelBox = el("input", { type: "text", class: "sk-label hidden", maxlength: "40", placeholder: "Type a label, then tap the drawing", "aria-label": "Label text" });
    var toolRow = el("div", { class: "sk-tools", role: "toolbar", "aria-label": "Drawing tools" });
    TOOLS.forEach(function (t) {
      var b = el("button", { type: "button", class: "sk-tool" + (t[0] === tool ? " on" : ""), text: t[1], title: t[2], "data-tool": t[0] });
      b.addEventListener("click", function () {
        tool = t[0];
        Array.prototype.forEach.call(toolRow.querySelectorAll(".sk-tool"), function (x) { x.classList.toggle("on", x.dataset.tool === tool); });
        labelBox.classList.toggle("hidden", tool !== "label");
        if (tool === "label") labelBox.focus();
      });
      toolRow.appendChild(b);
    });
    var undo = el("button", { type: "button", class: "quiet sk-small", text: "Undo" });
    var clear = el("button", { type: "button", class: "quiet sk-small", text: "Clear" });
    undo.addEventListener("click", function () { marks.pop(); redraw(); });
    clear.addEventListener("click", function () { marks = []; redraw(); });
    toolRow.appendChild(undo); toolRow.appendChild(clear);

    var mapChoice = null;
    if (opts.parcel) {
      var box = el("input", { type: "checkbox", id: "skMap" });
      box.checked = true;
      box.addEventListener("change", function () { useMap = box.checked; redraw(); });
      mapChoice = el("label", { class: "sk-map" }, [box, el("span", { text: " Start from my parcel map (" + (opts.parcel.address || opts.parcel.id) + ")" })]);
      background = new Image();
      background.onload = redraw;
      background.src = "/api/map/parcel/" + encodeURIComponent(opts.parcel.id) + ".svg?m=" + metersFor(opts.parcel) + (opts.phone ? "&phone=1" : "");
    }

    var cancel = el("button", { type: "button", class: "quiet", text: "Cancel" });
    var use = el("button", { type: "button", text: "Use this sketch" });
    var overlay = el("div", { class: "sk-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Draw a site sketch" }, [
      el("div", { class: "sk-panel" }, [
        el("h2", { text: "Draw a site sketch" }),
        el("p", { class: "small sk-tip", text: "Show your lot lines, buildings and the road. Use New line for what you want to change, and Label for distances in feet. It doesn't need to be perfect; staff check every measurement." }),
        mapChoice, toolRow, labelBox,
        el("div", { class: "sk-stage" }, [canvas]),
        el("div", { class: "sk-actions" }, [cancel, use]),
      ]),
    ]);
    function close() { document.removeEventListener("keydown", onKey); overlay.remove(); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    cancel.addEventListener("click", close);
    use.addEventListener("click", function () {
      var image = { mime: "image/jpeg", base64: canvas.toDataURL("image/jpeg", 0.88).split(",")[1] };
      close();
      opts.onDone(image);
    });
    document.body.appendChild(overlay);
    redraw();
  }

  window.CCSketch = { open: open };
})();
