// Resident counter. Everything from the server is rendered with textContent (never innerHTML), so model output can't inject HTML.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
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
  function chip(status, label) { return el("span", { class: "chip " + status, text: label || String(status).replace(/_/g, " ") }); }
  function modelChip(text) { return el("span", { class: "chip model", text: text }); }
  function fmt(iso) { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } }
  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: opts && opts.raw ? {} : { "Content-Type": "application/json" } }, opts || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { var err = new Error(data.error || ("Request failed (" + res.status + ")")); err.status = res.status; throw err; }
    return data;
  }

  var town = null;
  var state = { ref: null, key: null, timer: null, lastMsgCount: 0, session: null, typing: null, voiceOn: true, editing: false, demo: null, lastParcelId: null };
  var STEP_LABEL = { sketch: "Reading your drawing", route: "Finding the right desk", understand: "Understanding your request", locate: "Finding your parcel on the county map", research: "Reading the city code", draft: "Preparing your paperwork" };
  var STEP_MODEL = { sketch: "Muse Spark · image", route: "Muse Spark · structured", understand: "Muse Spark · structured", locate: "county GIS (no AI)", research: "Muse Spark · tools", draft: "Muse Spark · structured" };

  // ---------- voice out (browser) ----------
  try { state.voiceOn = localStorage.getItem("cc_voice") !== "off"; } catch (e) {}
  function updateMuteBtn() { $("muteBtn").textContent = state.voiceOn ? "🔊 Voice on" : "🔇 Voice off"; }
  updateMuteBtn();
  $("muteBtn").addEventListener("click", function () {
    state.voiceOn = !state.voiceOn;
    try { localStorage.setItem("cc_voice", state.voiceOn ? "on" : "off"); } catch (e) {}
    if (!state.voiceOn && window.speechSynthesis) speechSynthesis.cancel();
    updateMuteBtn();
  });
  function speak(text) {
    if (!state.voiceOn || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace(/[•*_#]/g, ""));
      u.rate = 1.02; u.pitch = 1;
      var voices = speechSynthesis.getVoices();
      var v = voices.find(function (x) { return /en[-_]US/i.test(x.lang) && /Natural|Online|Google|Samantha|Aria|Jenny/i.test(x.name); }) || voices.find(function (x) { return /en/i.test(x.lang); });
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------- character ----------
  function characterFor(department) {
    var d = (town && town.departments || []).find(function (x) { return x.id === department; });
    return d || { character: "Marlowe", role: "front desk", id: "front_desk", name: "Virtual City Help Desk" };
  }
  function setPortrait(department, pose) {
    var d = characterFor(department);
    var name = String(d.character || "marlowe").toLowerCase();
    var img = $("portraitImg");
    var src = "/public/characters/" + name + "-" + (pose || "neutral") + ".webp";
    if (img.getAttribute("src") !== src) {
      img.onerror = function () { img.onerror = null; img.src = "/public/characters/fallback.svg"; };
      img.src = src;
    }
    $("portrait").className = "portrait " + (pose || "");
    $("nametag").textContent = "";
    $("nametag").appendChild(document.createTextNode(d.character));
    $("nametag").appendChild(el("span", { text: d.role || d.name }));
    $("bubbleWho").textContent = d.character + " · " + d.name;
  }
  function typeInto(node, text, done) {
    if (state.typing) clearInterval(state.typing);
    node.textContent = "";
    var i = 0;
    var step = Math.max(1, Math.round(text.length / 120));
    state.typing = setInterval(function () {
      i += step;
      node.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(state.typing); state.typing = null; if (done) done(); }
    }, 18);
  }
  function say(department, text, opts) {
    opts = opts || {};
    setPortrait(department, "talking");
    $("bubble").classList.remove("thinking");
    typeInto($("bubbleText"), text, function () { setPortrait(department, "neutral"); });
    if (!opts.silent) speak(text);
  }
  function think(department, text) {
    setPortrait(department, "thinking");
    if (state.typing) { clearInterval(state.typing); state.typing = null; }
    $("bubbleText").textContent = "";
    $("bubbleText").appendChild(el("span", { class: "thinking", text: text }));
  }

  // ---------- image shrink ----------
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight, scale = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ mime: "image/jpeg", base64: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file could not be read as an image.")); };
      img.src = url;
    });
  }
  var pendingImage = null;
  $("attachBtn").addEventListener("click", function () { $("image").click(); });
  $("image").addEventListener("change", async function () {
    var f = $("image").files[0];
    if (!f) return;
    try { pendingImage = await shrinkImage(f); $("formMsg").textContent = "Drawing attached: " + f.name + " (sent with your next message)."; $("attachBtn").textContent = "📎✓"; }
    catch (e) { $("formMsg").textContent = e.message; }
  });

  // ---------- voice in (Muse Voice Transcribe) ----------
  var rec = { stream: null, ctx: null, chunks: [], processor: null, active: false };
  function floatTo16BitPCM(output, offset, input) { for (var i = 0; i < input.length; i++, offset += 2) { var s = Math.max(-1, Math.min(1, input[i])); output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); } }
  function downsample(buffer, fromRate, toRate) {
    if (toRate >= fromRate) return buffer;
    var ratio = fromRate / toRate, newLen = Math.round(buffer.length / ratio), out = new Float32Array(newLen), o = 0, i = 0;
    while (o < newLen) { var next = Math.round((o + 1) * ratio), acc = 0, n = 0; for (; i < next && i < buffer.length; i++) { acc += buffer[i]; n++; } out[o++] = n ? acc / n : 0; }
    return out;
  }
  function encodeWav(samples, rate) {
    var buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples.length * 2, true);
    floatTo16BitPCM(v, 44, samples);
    return new Blob([v], { type: "audio/wav" });
  }
  async function startRecording() {
    if (rec.active) return;
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { $("formMsg").textContent = "Microphone not available: " + e.message; return; }
    rec.ctx = new (window.AudioContext || window.webkitAudioContext)();
    var src = rec.ctx.createMediaStreamSource(rec.stream);
    rec.processor = rec.ctx.createScriptProcessor(4096, 1, 1);
    rec.chunks = [];
    rec.processor.onaudioprocess = function (e) { rec.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(rec.processor); rec.processor.connect(rec.ctx.destination);
    rec.active = true;
    $("micBtn").classList.add("recording");
    $("formMsg").textContent = "Listening… release to send to Muse Voice Transcribe.";
  }
  async function stopRecording() {
    if (!rec.active) return;
    rec.active = false;
    $("micBtn").classList.remove("recording");
    try { rec.processor.disconnect(); rec.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    var total = rec.chunks.reduce(function (n, c) { return n + c.length; }, 0);
    var all = new Float32Array(total), off = 0;
    rec.chunks.forEach(function (c) { all.set(c, off); off += c.length; });
    var rate = rec.ctx.sampleRate;
    try { rec.ctx.close(); } catch (e) {}
    if (total < rate * 0.4) { $("formMsg").textContent = "That was too short. Hold the microphone while you talk."; return; }
    var wav = encodeWav(downsample(all, rate, 16000), 16000);
    $("formMsg").textContent = "Transcribing with Muse Voice Transcribe…";
    try {
      var res = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      $("text").value = ($("text").value ? $("text").value + " " : "") + (data.transcript || "");
      $("formMsg").textContent = data.transcript ? "Heard you. Edit if needed, then Send." : "I didn't catch that.";
      $("text").focus();
    } catch (e) { $("formMsg").textContent = e.message; }
  }
  var mic = $("micBtn");
  mic.addEventListener("mousedown", startRecording); mic.addEventListener("touchstart", function (e) { e.preventDefault(); startRecording(); });
  ["mouseup", "mouseleave"].forEach(function (ev) { mic.addEventListener(ev, stopRecording); });
  mic.addEventListener("touchend", function (e) { e.preventDefault(); stopRecording(); });

  // ---------- sending ----------
  $("text").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } });
  $("form").addEventListener("submit", function (ev) { ev.preventDefault(); sendMessage($("text").value.trim()); });
  async function sendMessage(text, imagePayload) {
    var image = imagePayload || pendingImage;
    if (!text && !image) return;
    $("send").disabled = true;
    $("formMsg").textContent = "";
    try {
      if (!state.ref) {
        var data = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: text, image: image || undefined, demo_id: state.demo ? state.demo.example.id : undefined }) });
        state.ref = data.ref; state.key = data.view_key; state.lastMsgCount = 0;
        history.replaceState(null, "", "/?ref=" + encodeURIComponent(state.ref) + "&key=" + encodeURIComponent(state.key));
        $("welcome").classList.add("hidden");
      } else {
        await api("/api/sessions/" + encodeURIComponent(state.ref) + "/messages?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify({ text: text, image: image || undefined }) });
      }
      $("text").value = ""; pendingImage = null; $("attachBtn").textContent = "📎";
      think(state.session ? state.session.department : "front_desk", "Let me look into that…");
      poll();
    } catch (e) { $("formMsg").textContent = e.message || "Something went wrong."; }
    $("send").disabled = false;
  }

  $("lookup").addEventListener("submit", function (ev) { ev.preventDefault(); openSession($("lookupRef").value.trim().toUpperCase(), $("lookupKey").value.trim()); });
  function openSession(ref, key) {
    state.ref = ref; state.key = key; state.lastMsgCount = 0;
    history.replaceState(null, "", "/?ref=" + encodeURIComponent(ref) + "&key=" + encodeURIComponent(key));
    $("welcome").classList.add("hidden");
    poll();
  }

  async function poll() {
    clearTimeout(state.timer);
    try {
      var s = await api("/api/sessions/" + encodeURIComponent(state.ref) + "?key=" + encodeURIComponent(state.key));
      state.session = s;
      render(s);
      if (s.busy) state.timer = setTimeout(poll, 1500);
      else if (state.demo && state.demo.waiting) demoContinue();
    } catch (e) {
      $("formMsg").textContent = e.message || "Lost contact with the server. Retrying…";
      state.timer = setTimeout(poll, 4000);
    }
  }

  // ---------- rendering ----------
  function render(s) {
    // Steps
    var steps = $("steps"); steps.textContent = "";
    if (s.busy) {
      (s.steps || []).forEach(function (st) {
        if (st.status === "skipped") return;
        steps.appendChild(chip(st.status, STEP_LABEL[st.name] || st.name));
      });
      var running = (s.steps || []).find(function (st) { return st.status === "running"; });
      think(s.department || "front_desk", running ? (STEP_LABEL[running.name] || running.name) + "… (" + (STEP_MODEL[running.name] || "") + ")" : "Thinking…");
    }
    // Latest desk message
    var deskMsgs = (s.messages || []).filter(function (m) { return m.role === "desk"; });
    if (s.messages.length !== state.lastMsgCount) {
      var last = deskMsgs[deskMsgs.length - 1];
      if (last && !s.busy) say(last.department || s.department || "front_desk", last.text);
      state.lastMsgCount = s.messages.length;
    } else if (!s.busy && deskMsgs.length && $("bubbleText").querySelector(".thinking")) {
      say(s.department || "front_desk", deskMsgs[deskMsgs.length - 1].text, { silent: true });
    }
    var out = $("results"); out.textContent = "";

    // Reference + status
    var head = el("div", { class: "card" }, [
      el("div", { class: "row", style: "justify-content:space-between" }, [el("div", null, [el("span", { class: "small", text: "Reference " }), el("span", { class: "refbox", text: s.ref })]), chip(s.status, STATUS_LABEL[s.status] || s.status)]),
      el("div", { class: "small", text: "Keep this page's address to come back: " + location.href }),
    ]);
    out.appendChild(head);

    // Parcel + map
    if (s.parcel) renderParcel(out, s);
    // Drawing
    if (s.has_sketch) renderDrawing(out, s);
    // Research
    if (s.research && s.department === "planning") renderResearch(out, s);
    // Packet
    if (s.packet) renderPacket(out, s);
    // Transcript
    var tl = el("ul", { class: "transcript" });
    (s.messages || []).forEach(function (m) {
      tl.appendChild(el("li", { class: m.role }, [el("strong", { text: (m.role === "resident" ? "You" : (m.character || "Desk")) + ": " }), m.letter ? el("div", { class: "letter", text: m.text }) : m.text]));
    });
    out.appendChild(el("div", { class: "card" }, [el("h2", { text: "Conversation" }), tl]));
    if (s.status === "error") out.appendChild(el("div", { class: "notice error", text: "The desk hit a problem: " + (s.error || "") + ". Your conversation is saved; send another message to try again." }));
  }
  var STATUS_LABEL = { open: "Talking", ready: "Packet ready to submit", referred: "Referred to another desk", submitted: "Submitted to planning", needs_info: "Staff asked for more", in_review: "Forwarded for decision", answered: "Staff answered", error: "Problem" };

  function renderParcel(out, s) {
    var p = s.parcel;
    var card = el("div", { class: "card" }, [el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "Your parcel on the county map" }), modelChip("county GIS + state parcels · no AI")])]);
    var wrap = el("div", { class: "mapwrap" + (state.lastParcelId === p.id ? " zoomed" : "") });
    var zo = el("img", { class: "zoomout", src: "/api/map/city.svg", alt: "City zoning map" });
    var zi = el("img", { class: "zoomin", src: "/api/map/parcel/" + encodeURIComponent(p.id) + ".svg", alt: "Zoning map around the parcel" });
    wrap.appendChild(zo); wrap.appendChild(zi);
    card.appendChild(wrap);
    if (state.lastParcelId !== p.id) { state.lastParcelId = p.id; setTimeout(function () { wrap.classList.add("zoomed"); }, 350); }
    var zoneColor = town && town.zones && town.zones[p.zone] ? town.zones[p.zone].color : "#eee";
    var facts = el("div", { class: "parcel-facts" }, [
      el("div", null, [el("b", { text: "Address" }), p.address || "(none on record)"]),
      el("div", null, [el("b", { text: "Tax parcel number" }), p.id || "(none)"]),
      el("div", null, [el("b", { text: "Zone" }), el("span", { class: "zonepill", style: "background:" + zoneColor, text: p.zone || "?" }), " ", el("span", { class: "small", text: p.zoneName || "" })]),
      el("div", null, [el("b", { text: "Size" }), (p.areaAcres || "?") + " acres" + (p.areaSqft ? " (" + p.areaSqft.toLocaleString() + " sq ft)" : "")]),
      el("div", null, [el("b", { text: "On the tax roll" }), (p.propertyClass || "?") + (p.houses != null ? ", " + p.houses + " dwelling(s)" : "") + (p.yearBuilt ? ", built " + p.yearBuilt : "")]),
      el("div", null, [el("b", { text: "Owner of record" }), (s.owner ? s.owner.name : "?") + " ", el("span", { class: "small", text: "(fictional demo name)" })]),
    ]);
    card.appendChild(facts);
    if (p.straddlesZones) card.appendChild(el("div", { class: "notice warn", text: "This parcel touches more than one zone (" + p.zonesTouched.join(", ") + "). Staff confirm the zone from the official map." }));
    if (p.assumed) card.appendChild(el("div", { class: "notice warn", text: "Several parcels share this address. I used " + p.id + "; tell me if yours is different." }));
    card.appendChild(el("p", { class: "small", text: town ? town.notes.fictionalOwners : "" }));
    out.appendChild(card);
  }

  function drawingWithOutline(src, reading) {
    var wrap = el("div", { style: "position:relative;display:inline-block;max-width:100%" });
    var img = el("img", { src: src, alt: "Resident's drawing", style: "max-width:100%;max-height:420px;display:block;border-radius:10px;border:1px solid var(--line)" });
    wrap.appendChild(img);
    var o = reading && reading.outline;
    if (o && o.width && o.height && o.objects && o.objects.length) {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + o.width + " " + o.height);
      svg.setAttribute("style", "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none");
      var colors = { rectangle: "#1f5fbf", "dashed line": "#a02020", building: "#1d6b35", house: "#1d6b35", road: "#8a5a00" };
      o.objects.forEach(function (b) {
        var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("x", b.x1); r.setAttribute("y", b.y1); r.setAttribute("width", Math.max(2, b.x2 - b.x1)); r.setAttribute("height", Math.max(2, b.y2 - b.y1));
        r.setAttribute("fill", "none"); r.setAttribute("stroke", colors[b.label] || "#1f5fbf"); r.setAttribute("stroke-width", Math.max(2, o.width / 250)); r.setAttribute("stroke-dasharray", b.label === "dashed line" ? "8 6" : "");
        svg.appendChild(r);
        var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", b.x1 + 4); t.setAttribute("y", Math.max(14, b.y1 - 4)); t.setAttribute("fill", colors[b.label] || "#1f5fbf"); t.setAttribute("font-size", Math.max(12, o.width / 60)); t.setAttribute("font-family", "system-ui, sans-serif");
        t.textContent = b.label + (b.confidence ? " " + Math.round(b.confidence * 100) + "%" : "");
        svg.appendChild(t);
      });
      wrap.appendChild(svg);
    }
    return wrap;
  }
  function renderDrawing(out, s) {
    var st = (s.steps || []).find(function (x) { return x.name === "sketch"; });
    var reading = st && st.status === "done" ? st.output : null;
    var card = el("div", { class: "card" }, [el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "Your drawing" }), el("span", null, [modelChip("Muse Spark · image"), " ", modelChip("SAM 3.1 · outlines")])])]);
    card.appendChild(drawingWithOutline("/api/sessions/" + encodeURIComponent(s.ref) + "/sketch?key=" + encodeURIComponent(state.key), reading));
    if (reading) {
      card.appendChild(el("p", { class: "small", text: "Read as: " + reading.drawing_type.replace(/_/g, " ") + ", " + reading.readability + "." + (reading.building_code_site_plan_note ? " " + reading.building_code_site_plan_note : "") }));
      if (reading.dimensions && reading.dimensions.length) card.appendChild(el("ul", null, reading.dimensions.map(function (d) { return el("li", { text: d.what + ": " + d.value_text }); })));
      if (reading.outline && reading.outline.objects) card.appendChild(el("p", { class: "small", text: "SAM 3.1 outlined " + reading.outline.objects.length + " shape(s) for staff to check against your words." }));
    } else if (st && st.status === "running") card.appendChild(el("p", { class: "small", text: "Reading the drawing…" }));
    out.appendChild(card);
  }
  function tierInfo(id) { return (town && town.processTiers || []).find(function (t) { return t.id === id; }); }
  function renderResearch(out, s) {
    var r = s.research;
    var card = el("div", { class: "card" }, [el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "What the city code says" }), modelChip("Muse Spark · " + (r.tool_log ? r.tool_log.length : 0) + " tool calls on the real code")])]);
    var t = tierInfo(r.process_tier);
    card.appendChild(el("div", { class: "tier" }, [el("div", null, [el("div", { class: "small", text: "Process the code provides" }), el("div", { class: "big", text: t ? t.label : r.process_tier }), el("div", { class: "small", text: t ? "Decided by " + t.decider : "" }), el("div", { style: "margin-top:6px", text: r.process_explanation })])]));
    if (r.required_applications && r.required_applications.length) {
      card.appendChild(el("h3", { text: "You would file" }));
      card.appendChild(el("ul", null, r.required_applications.map(function (id) { var a = town.applicationTypes[id] || {}; return el("li", { text: (a.name || id) + " (section " + (a.section || "?") + ")" }); })));
    }
    if (r.path_if_blocked) card.appendChild(el("div", { class: "notice warn" }, [el("strong", { text: "Where the code blocks something, it also provides a path: " }), r.path_if_blocked]));
    card.appendChild(el("h3", { text: "Use under the zone's table" }));
    card.appendChild(el("div", null, [chip(r.use_status), " ", r.use_table_row ? el("span", { class: "small", text: r.use_table_row }) : null]));
    if (r.standards && r.standards.length) {
      card.appendChild(el("h3", { text: "Numbers checked" }));
      var tb = el("tbody");
      r.standards.forEach(function (x) { tb.appendChild(el("tr", null, [el("td", { text: x.section }), el("td", { text: x.requirement }), el("td", { text: x.required_value }), el("td", { text: x.proposed_value }), el("td", null, [chip(x.status)])])); });
      card.appendChild(el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Section" }), el("th", { text: "Rule" }), el("th", { text: "Code says" }), el("th", { text: "You said" }), el("th", { text: "" })])]), tb]));
    }
    card.appendChild(el("h3", { text: "Sections cited (quotes checked against the code text)" }));
    r.applicable_sections.forEach(function (x) {
      var q = el("div", { class: "quote" }, [x.quote ? el("span", { text: "“" + x.quote + "”" }) : el("span", { class: "small", text: "(no verified quote; " + x.why + ")" })]);
      q.appendChild(el("span", { class: "cite" }, [el("a", { href: x.url || "#", target: "_blank", rel: "noopener", text: "Section " + x.section + (x.title ? " " + x.title : "") }), " · " + (x.quote_verified ? "quote verified" : "paraphrase") + " · " + x.why]));
      card.appendChild(q);
    });
    if (r.tool_log && r.tool_log.length) {
      var det = el("details", null, [el("summary", { class: "small", text: "What the planner looked up (" + r.tool_log.length + " tool calls)" })]);
      det.appendChild(el("ul", { class: "toollog" }, r.tool_log.map(function (x) { return el("li", { text: x.summary || x.tool }); })));
      card.appendChild(det);
    }
    card.appendChild(el("p", { class: "small", text: town ? town.wording.staffDecide : "" }));
    out.appendChild(card);
  }

  function renderPacket(out, s) {
    var p = s.packet;
    var title = { zoning_verification_request: "Zoning verification request", application_set: "Your application", complaint_report: "Complaint report", referral: "Referral" }[p.packet_type] || "Packet";
    var card = el("div", { class: "card" }, [el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: title + ": " + (p.title || "") }), modelChip("Muse Spark · drafted from your words only")])]);
    card.appendChild(el("p", { text: p.one_line_summary || "" }));
    if (p.process_summary) card.appendChild(el("div", { class: "notice", text: p.process_summary }));
    (p.documents || []).forEach(function (d, di) {
      var doc = el("div", { class: "doc" }, [el("div", { class: "doc-title" }, [el("span", { text: d.name }), el("span", { class: "small", text: d.section ? "Section " + d.section : "" })])]);
      var tb = el("tbody");
      (d.fields || []).forEach(function (f, fi) {
        var valCell = el("td", { class: "val" });
        if (state.editing) { var inp = el("input", { class: "field", type: "text", value: f.value || "", "data-doc": String(di), "data-field": String(fi) }); valCell.appendChild(inp); }
        else valCell.appendChild(f.value ? document.createTextNode(f.value) : el("span", { class: "blank", text: "[blank]" }));
        tb.appendChild(el("tr", null, [el("td", { text: f.label }), valCell, el("td", { class: "small", text: f.source === "blank" ? "" : f.source.replace("_", " ") })]));
      });
      doc.appendChild(el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Field" }), el("th", { text: "Value" }), el("th", { text: "From" })])]), tb]));
      doc.appendChild(el("h3", { text: "Statement" }));
      if (state.editing) { var ta = el("textarea", { "data-doc": String(di), "data-narrative": "1" }); ta.value = d.narrative || ""; doc.appendChild(ta); }
      else doc.appendChild(el("div", { class: "narrative", text: d.narrative || "" }));
      (d.code_basis || []).forEach(function (c) {
        if (!c.quote) return;
        doc.appendChild(el("div", { class: "quote" }, [el("span", { text: "“" + c.quote + "”" }), el("span", { class: "cite" }, [el("a", { href: c.url || "#", target: "_blank", rel: "noopener", text: "Section " + c.section }), " · " + (c.quote_verified ? "verified" : "unverified")])]));
      });
      card.appendChild(doc);
    });
    var actions = el("div", { class: "actions" });
    var canSubmit = ["open", "ready"].includes(s.status) && s.parcel && p.documents && p.documents.length && p.packet_type !== "referral";
    if (canSubmit && !state.editing) {
      var submit = el("button", { type: "button", text: "Submit to the planning department" });
      submit.addEventListener("click", async function () { submit.disabled = true; try { await api("/api/sessions/" + state.ref + "/submit?key=" + encodeURIComponent(state.key), { method: "POST", body: "{}" }); poll(); } catch (e) { $("formMsg").textContent = e.message; submit.disabled = false; } });
      actions.appendChild(submit);
      var edit = el("button", { type: "button", class: "secondary", text: "Edit it myself" });
      edit.addEventListener("click", function () { state.editing = true; render(state.session); });
      actions.appendChild(edit);
      actions.appendChild(el("span", { class: "small", text: "Or just tell " + characterFor("planning").character + " what to change." }));
    }
    if (state.editing) {
      var save = el("button", { type: "button", text: "Save my edits" });
      save.addEventListener("click", async function () {
        var docs = JSON.parse(JSON.stringify(p.documents));
        card.querySelectorAll("input.field").forEach(function (inp) { docs[+inp.dataset.doc].fields[+inp.dataset.field].value = inp.value; docs[+inp.dataset.doc].fields[+inp.dataset.field].source = "resident"; });
        card.querySelectorAll("textarea[data-narrative]").forEach(function (ta) { docs[+ta.dataset.doc].narrative = ta.value; });
        try { await api("/api/sessions/" + state.ref + "/packet?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify({ documents: docs }) }); state.editing = false; poll(); } catch (e) { $("formMsg").textContent = e.message; }
      });
      var cancel = el("button", { type: "button", class: "quiet", text: "Cancel" });
      cancel.addEventListener("click", function () { state.editing = false; render(state.session); });
      actions.appendChild(save); actions.appendChild(cancel);
    }
    var print = el("button", { type: "button", class: "quiet", text: "Print / save PDF" });
    print.addEventListener("click", function () { window.print(); });
    actions.appendChild(print);
    card.appendChild(actions);
    if (s.submitted_at) card.appendChild(el("p", { class: "small", text: "Submitted " + fmt(s.submitted_at) + ". Staff will write back in this conversation." }));
    out.appendChild(card);
  }

  // ---------- demo mode ----------
  $("demoBtn").addEventListener("click", async function () {
    $("demoPanel").classList.toggle("hidden");
    if ($("demoList").children.length) return;
    try {
      var d = await api("/api/demo");
      d.examples.forEach(function (ex) {
        var li = el("li", null, [el("div", null, [el("strong", { text: ex.title })]), el("div", { class: "small", text: ex.turns.length + " turn(s)" + (ex.sketch ? " · with a drawing" : "") })]);
        li.addEventListener("click", function () { startDemo(ex); });
        $("demoList").appendChild(li);
      });
      $("demoNote").textContent = d.note || "";
    } catch (e) { $("demoList").appendChild(el("li", { text: e.message })); }
  });
  $("demoClose").addEventListener("click", function () { $("demoPanel").classList.add("hidden"); });
  async function startDemo(ex) {
    $("demoPanel").classList.add("hidden");
    if (state.ref) { state.ref = null; state.key = null; state.session = null; state.lastMsgCount = 0; state.lastParcelId = null; $("results").textContent = ""; history.replaceState(null, "", "/"); }
    var sketch = null;
    if (ex.sketch) { try { var b = await (await fetch("/public/sketches/" + ex.sketch)).blob(); sketch = await shrinkImage(b); } catch (e) {} }
    state.demo = { example: ex, turn: 0, paused: false, waiting: false, sketch: sketch };
    $("demoBar").classList.remove("hidden");
    $("welcome").classList.add("hidden");
    demoNextTurn();
  }
  function demoNextTurn() {
    var d = state.demo; if (!d || d.paused) return;
    if (d.turn >= d.example.turns.length) { $("demoStatus").textContent = "Example finished. You can keep talking, edit, or submit."; return; }
    var text = d.example.turns[d.turn];
    $("demoStatus").textContent = d.example.persona + " is typing (turn " + (d.turn + 1) + " of " + d.example.turns.length + ")…";
    var box = $("text"); box.value = ""; var i = 0;
    var iv = setInterval(function () {
      if (!state.demo || state.demo.paused) { clearInterval(iv); return; }
      i += 2; box.value = text.slice(0, i); box.scrollTop = box.scrollHeight;
      if (i >= text.length) { clearInterval(iv); setTimeout(function () { if (!state.demo) return; d.waiting = true; d.turn++; var img = (d.sketch && (d.turn === d.example.turns.length || /sketch|drawing|attached/i.test(text))) ? d.sketch : null; if (img) d.sketch = null; sendMessage(text, img); $("demoStatus").textContent = "Waiting for the desk…"; }, 500); }
    }, 22);
  }
  function demoContinue() { var d = state.demo; if (!d) return; d.waiting = false; setTimeout(function () { demoNextTurn(); }, 2200); }
  $("demoPause").addEventListener("click", function () { var d = state.demo; if (!d) return; d.paused = !d.paused; $("demoPause").textContent = d.paused ? "Resume" : "Pause"; if (!d.paused) demoNextTurn(); });
  $("demoSkip").addEventListener("click", function () { var d = state.demo; if (!d) return; if (d.waiting) return; var t = d.example.turns[d.turn]; if (t) { d.turn++; d.waiting = true; sendMessage(t, d.sketch && d.turn === d.example.turns.length ? d.sketch : null); } });
  $("demoTakeOver").addEventListener("click", function () { state.demo = null; $("demoBar").classList.add("hidden"); $("text").value = ""; $("text").focus(); });

  // ---------- boot ----------
  (async function boot() {
    try {
      town = await api("/api/town");
      $("townName").textContent = town.name + " · Virtual City Help Desk";
      $("credits").textContent = (town.notes.dataCredits || "") + " · " + (town.notes.fictionalOwners || "") + " · Built during the Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026. Models: " + town.models.desk + ", " + town.models.voice + ", " + town.models.image + ".";
      $("stageBg").style.backgroundImage = "url(/api/map/city.svg)";
      [["I want to split my lot and sell the back half to my son.", "lot split"], ["Can I keep a rooster at my house?", "rooster"], ["I need a building permit for a mother-in-law suite.", "casita"], ["My bank needs a zoning verification letter.", "bank letter"]].forEach(function (x) {
        var b = el("button", { type: "button", class: "quiet", text: x[0] });
        b.addEventListener("click", function () { $("text").value = x[0]; $("text").focus(); });
        $("welcomeExamples").appendChild(b);
      });
      setPortrait("front_desk", "neutral");
      if (window.speechSynthesis) speechSynthesis.getVoices();
    } catch (e) { $("formMsg").textContent = "Could not load the town: " + e.message; }
    var params = new URLSearchParams(location.search);
    if (params.get("ref") && params.get("key")) openSession(params.get("ref"), params.get("key"));
  })();
})();
