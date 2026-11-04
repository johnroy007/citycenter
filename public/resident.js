// Resident counter: the office scene. Everything from the server is rendered with textContent (never innerHTML), so model output can't inject HTML.
// Layout: conversation history on the left, the character in the middle, a TV on the right with a four-button remote
// (Parcel Map, Code Review, Information You Uploaded, Submission Paperwork). The TV changes channel on its own as work finishes.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "style") n.style.cssText = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function chip(status, label) { return el("span", { class: "chip " + status, text: label || String(status).replace(/_/g, " ") }); }
  function modelChip(text) { return el("span", { class: "chip model", text: text }); }
  function fmt(iso) { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } }
  function fmtDate(iso) { try { return new Date(iso || Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); } catch (e) { return ""; } }
  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: opts && opts.raw ? {} : { "Content-Type": "application/json" } }, opts || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { var err = new Error(data.error || ("Request failed (" + res.status + ")")); err.status = res.status; throw err; }
    return data;
  }

  // The phone app. Everything guarded by isPhone() stays off on a desktop-sized window.
  var phoneMq = window.matchMedia("(max-width: 700px), (max-height: 500px) and (max-width: 950px)");
  function isPhone() { return phoneMq.matches; }
  function phoneShow(view) {
    state.phoneView = view;
    document.body.classList.toggle("pv-chat", view === "chat");
    document.body.classList.toggle("pv-screen", view === "screen");
    if (view === "chat" && isPhone()) { var c = $("chat"); c.scrollTop = c.scrollHeight; }
  }
  function showOnPhone(channel) {
    state.channel = channel; state.manual = true; state.fresh[channel] = false;
    if (state.session) state.seen[channel] = contentSig(state.session)[channel];
    phoneShow("screen");
    renderScreen(state.session); renderRemote(state.session);
    $("screen").scrollTop = 0;
  }
  var town = null;
  var state = {
    ref: null, key: null, timer: null, lastMsgCount: 0, session: null, typing: null, voiceOn: true, editing: false, demo: null,
    progress: { active: false, shown: 0, nextAt: 0, reveal: null, timer: null }, channel: "welcome", manual: false, seen: { map: null, code: null, submissions: null, paperwork: null }, fresh: {}, lastParcelId: null,
    zoom: { welcome: 1, map: 1, code: 1, submissions: 1, paperwork: 1 }, expanded: false, mapView: "block",
  };
  try { var z0 = JSON.parse(localStorage.getItem("cc_zoom") || "{}"); Object.keys(z0).forEach(function (k) { if (state.zoom[k] !== undefined && z0[k] >= 0.5 && z0[k] <= 2) state.zoom[k] = z0[k]; }); } catch (e) {}
  var STEP_LABEL = { sketch: "Reading your drawing", route: "Finding the right desk", understand: "Understanding your request", locate: "Finding your parcel on the county map", research: "Reading the city code", draft: "Preparing your paperwork" };
  var STEP_MODEL = { sketch: "Muse Spark · image", route: "Muse Spark · structured", understand: "Muse Spark · structured", locate: "county GIS (no AI)", research: "Muse Spark · tools", draft: "Muse Spark · structured" };
  var STATUS_LABEL = { open: "Talking", ready: "Paperwork ready to submit", referred: "Referred to another desk", submitted: "Submitted to planning", needs_info: "Staff asked for more", in_review: "Forwarded for decision", answered: "Staff answered", error: "Problem" };
  function isService(s) { return !!(s && s.packet && ["service_request", "certified_question"].includes(s.packet.packet_type)); }
  function needsPin(s) { return !!(s && s.research && s.research.service && s.research.service.location === "pin"); }
  function signatureFree(s) { return isService(s) && s.packet.signature_required === false; }
  function deskName(s) { return s.department && s.department !== "planning" ? characterFor(s.department).name : "the planning department"; }
  function statusLabel(s) { return s.changed_since_submit ? "Updated; not resubmitted yet" : s.status === "submitted" && isService(s) ? "Submitted to " + deskName(s) : (STATUS_LABEL[s.status] || s.status); }
  var CHANNEL_LABEL = { welcome: "Welcome", map: "Parcel Map", code: "Code Review", submissions: "Information You Uploaded", paperwork: "Submission Paperwork" };

  // ---------- voice out (browser) ----------
  // A phone stays quiet until asked: a voice starting up in public is a surprise.
  try { var savedVoice = localStorage.getItem("cc_voice"); state.voiceOn = savedVoice ? savedVoice !== "off" : !isPhone(); } catch (e) {}
  function updateMuteBtn() { $("muteBtn").textContent = state.voiceOn ? "🔊 Voice on" : "🔇 Voice off"; }
  function rememberVisit() { if (isPhone()) try { localStorage.setItem("cc_last", JSON.stringify({ ref: state.ref, key: state.key })); } catch (e) {} }
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
  function departmentForCharacter(name) {
    var d = (town && town.departments || []).find(function (x) { return String(x.character).toLowerCase() === String(name || "").toLowerCase(); });
    return d ? d.id : null;
  }
  function portraitSrc(department, pose) {
    var d = characterFor(department);
    return "/public/characters/" + String(d.character || "marlowe").toLowerCase() + "-" + (pose || "neutral") + ".webp";
  }
  function setPortrait(department, pose) {
    var d = characterFor(department);
    var img = $("portraitImg");
    var src = portraitSrc(department, pose);
    if (img.getAttribute("src") !== src) {
      img.onerror = function () { img.onerror = null; img.src = "/public/characters/fallback.svg"; };
      img.src = src;
    }
    $("portrait").className = "portrait " + (pose || "");
    $("nametag").textContent = "";
    $("nametag").appendChild(document.createTextNode(d.character));
    $("nametag").appendChild(el("span", { text: "AI assistant · " + (d.role || d.name) }));
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
  // The character's newest line types itself out in the conversation panel while the portrait "talks".
  function say(department, text, opts) {
    opts = opts || {};
    setPortrait(department, "talking");
    var last = $("chat").querySelector("li.msg.desk:last-of-type .text");
    if (last && !opts.silent) typeInto(last, text, function () { setPortrait(department, opts.keepWorking ? "thinking" : "neutral"); $("chat").scrollTop = $("chat").scrollHeight; });
    else setPortrait(department, opts.keepWorking ? "thinking" : "neutral");
    if (!opts.silent) speak(text);
  }
  function think(department, text) {
    state.workingText = text;
    if (state.typing) { var w0 = $("chat").querySelector("li.working .small"); if (w0) w0.textContent = characterFor(department).character + ": " + text; return; }
    setPortrait(department, "thinking");
    var w = $("chat").querySelector("li.working .small");
    if (w) w.textContent = characterFor(department).character + ": " + text;
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
  // A sketch drawn here takes the same path as an uploaded drawing.
  function openSketchPad(keepDrawing) {
    CCSketch.open({
      parcel: state.session && state.session.parcel ? state.session.parcel : null,
      marks: keepDrawing === true && state.session ? state.session.sketch_marks : null,
      phone: isPhone(),
      onDone: function (image, marks, address) { sendMessage($("text").value.trim() || (address ? "Here is my site sketch for " + address + "." : "Here is my site sketch."), image, marks); },
    });
  }
  $("drawBtn").addEventListener("click", openSketchPad);
  $("attachBtn").addEventListener("click", function () { $("image").click(); });
  $("image").addEventListener("change", async function () {
    var f = $("image").files[0];
    if (!f) return;
    try {
      pendingImage = await shrinkImage(f);
      if (state.sendOnPick) { state.sendOnPick = false; sendMessage($("text").value.trim() || "Here is my drawing."); $("image").value = ""; return; }
      $("formMsg").textContent = "Drawing attached: " + f.name + " (sent with your next message)."; $("attachBtn").textContent = "📎✓";
    }
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
    if (rec.ctx.state === "suspended") rec.ctx.resume();
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
  // Released anywhere: the "Listening" line moves the button out from under the mouse, so leaving it can't count as letting go.
  document.addEventListener("mouseup", stopRecording);
  mic.addEventListener("touchend", function (e) { e.preventDefault(); stopRecording(); });

  // ---------- sending ----------
  $("text").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } });
  $("form").addEventListener("submit", function (ev) { ev.preventDefault(); sendMessage($("text").value.trim()); });
  async function sendMessage(text, imagePayload, marks) {
    var image = imagePayload || pendingImage;
    if (!text && !image) return;
    $("send").disabled = true;
    $("formMsg").textContent = "";
    try {
      if (!state.ref) {
        var data = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: text, image: image || undefined, marks: marks || undefined, demo_id: state.demo ? state.demo.example.id : undefined }) });
        state.ref = data.ref; state.key = data.view_key; state.lastMsgCount = 0;
        rememberVisit();
        history.replaceState(null, "", "/?ref=" + encodeURIComponent(state.ref) + "&key=" + encodeURIComponent(state.key));
      } else {
        await api("/api/sessions/" + encodeURIComponent(state.ref) + "/messages?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify({ text: text, image: image || undefined, marks: marks || undefined }) });
      }
      addPendingResident(text, !!image);
      document.body.classList.remove("no-visit"); phoneShow("chat");
      $("text").value = ""; $("text").style.height = ""; pendingImage = null; $("attachBtn").textContent = "📎";
      think(state.session ? state.session.department : "front_desk", "Let me look into that…");
      poll();
    } catch (e) { $("formMsg").textContent = e.message || "Something went wrong."; }
    $("send").disabled = false;
  }
  // Show the resident's line in the log right away, before the server's copy arrives.
  function addPendingResident(text, hasSketch) {
    var chat = $("chat");
    chat.appendChild(chatItem({ role: "resident", text: text, has_sketch: hasSketch, at: new Date().toISOString() }));
    chat.scrollTop = chat.scrollHeight;
  }

  $("lookup").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var code = $("lookupRef").value.trim().replace(/\s+/g, "");
    var m = code.match(/^([A-Za-z]+-\d{4}-\d{4})-?([A-Za-z0-9_-]{6,})?$/);
    if (!m || !m[2]) { $("formMsg").textContent = "A visit code looks like " + ((town && town.refPrefix) || "TC") + "-2026-0107-xzUHULux: the reference plus the part after it. It was in the desk's message when you submitted, and in this page's address."; return; }
    openSession(m[1].toUpperCase(), m[2]);
  });
  function openSession(ref, key) {
    state.ref = ref; state.key = key; state.lastMsgCount = 0;
    document.body.classList.remove("no-visit"); rememberVisit();
    history.replaceState(null, "", "/?ref=" + encodeURIComponent(ref) + "&key=" + encodeURIComponent(key));
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
    renderSteps(s);
    renderHead(s);
    renderChat(s);
    // Newest desk line: animate it in the conversation panel and read it aloud
    var deskMsgs = (s.messages || []).filter(function (m) { return m.role === "desk"; });
    if (s.messages.length !== state.lastMsgCount) {
      var last = deskMsgs[deskMsgs.length - 1];
      var lastIsNewest = last && s.messages[s.messages.length - 1] === last;
      if (last && lastIsNewest && state.lastMsgCount > 0) say(last.department || s.department || "front_desk", last.text, { keepWorking: s.busy });
      else if (!s.busy) setPortrait(s.department || "front_desk", "neutral");
      state.lastMsgCount = s.messages.length;
    } else if (!s.busy && $("portrait").classList.contains("thinking")) {
      setPortrait(s.department || "front_desk", "neutral");
    }
    trackProgress(s);
    autoChannel(s);
    renderScreen(s);
    renderRemote(s);
    settleProgress(s);
  }
  function renderSteps(s) {
    var steps = $("steps"); steps.textContent = "";
    if (!s.busy) return;
    (s.steps || []).forEach(function (st) {
      if (st.status === "skipped" || st.status === "pending") return;
      steps.appendChild(chip(st.status, STEP_LABEL[st.name] || st.name));
    });
    var running = (s.steps || []).find(function (st) { return st.status === "running"; });
    think(s.department || "front_desk", running ? (STEP_LABEL[running.name] || running.name) + "… (" + (STEP_MODEL[running.name] || "") + ")" : "Thinking…");
  }
  function renderHead(s) {
    $("refline").textContent = "";
    $("refline").appendChild(document.createTextNode("Reference " + s.ref));
    if (s.visit_code) $("refline").appendChild(el("div", { class: "small code", text: "Visit code " + s.visit_code, title: "Type this under Come back to an earlier visit to return here" }));
    var sc = $("statusChip"); sc.textContent = ""; sc.appendChild(chip(s.changed_since_submit ? "unclear" : s.status, statusLabel(s)));
  }
  // Tappable replies under the newest desk message: the app's own (consent, submit) and the planner's (short answer sets).
  function quickReplies(m, s) {
    var row = el("div", { class: "quick" });
    var any = false;
    function chip(label, onClick, cls) {
      var b = el("button", { type: "button", class: "qchip" + (cls ? " " + cls : ""), text: label });
      b.addEventListener("click", onClick);
      row.appendChild(b); any = true;
    }
    (m.quick_replies || []).forEach(function (q) { chip(q, function () { sendMessage(q); }); });
    if (m.offers_sketch && s && !s.has_sketch && !state.skipSketch) {
      chip("Draw a site sketch", function () { openSketchPad(); }, "primary");
      chip("Upload a drawing", function () { state.sendOnPick = true; $("image").click(); });
      chip("Skip for now", function () { state.skipSketch = true; renderChat(state.session); });
    }
    if (s && s.has_sketch && !s.site_plan && m.role === "desk") chip("Make a to-scale site plan", function () { makeSitePlan(); }, "primary");
    if (m.offers_plan_check && s && s.site_plan && !s.site_plan.confirmed_at) {
      chip("Looks right", confirmPlan, "primary");
      chip("Change the drawing", function () { openSketchPad(true); });
    }
    if (m.offers_pin && s && !s.submitted_at) chip("Mark it on the map", function () { state.channel = "map"; state.manual = true; phoneShow("screen"); renderScreen(state.session); renderRemote(state.session); }, "primary");
    if (m.offers_submit && s && ["open", "ready"].includes(s.status) && s.packet && (s.parcel || isService(s)) && !s.submitted_at) {
      if (signatureFree(s)) chip("Send it", function () { sendWithoutSignature(); }, "primary");
      else chip("Sign and submit", function () { openSignPanel(); }, "primary");
      chip("Edit it myself", function () { state.channel = "paperwork"; state.manual = true; state.editing = true; phoneShow("screen"); renderScreen(state.session); renderRemote(state.session); });
      chip("I want to change something", function () { $("text").placeholder = "Tell " + characterFor(s.department || "planning").character + " what to change…"; $("text").focus(); });
    } else if (s && isService(s) && !s.submitted_at && (m.questions || []).length) {
      chip("Edit it myself", function () { state.channel = "paperwork"; state.manual = true; state.editing = true; phoneShow("screen"); renderScreen(state.session); renderRemote(state.session); });
    }
    if (m.offers_submit && s && s.submitted_at && s.changed_since_submit) {
      if (signatureFree(s)) chip("Send the update", function () { sendWithoutSignature(); }, "primary");
      else chip("Sign and resubmit", function () { openSignPanel(); }, "primary");
    }
    // On a phone the other screens are a tap away, so the chat points to whatever is ready.
    if (isPhone() && s && m.role === "desk") {
      if (s.packet && s.packet.packet_type !== "referral") chip("View paperwork", function () { showOnPhone("paperwork"); }, "view");
      if (s.research) chip("See the code", function () { showOnPhone("code"); }, "view");
      if ((s.parcel || s.pin) && !m.offers_pin) chip("See the map", function () { showOnPhone("map"); }, "view");
    }
    return any ? row : null;
  }
  function chatItem(m, opts) {
    opts = opts || {};
    var li = el("li", { class: "msg " + m.role + (m.letter ? " has-letter" : "") + (m.emergency ? " emergency" : "") });
    var dept = m.role === "desk" ? (m.department || departmentForCharacter(m.character) || "planning") : null;
    var avatar;
    if (m.role === "desk" && !m.letter) {
      avatar = el("img", { class: "avatar", src: portraitSrc(dept, "neutral"), alt: "" });
      avatar.onerror = function () { avatar.onerror = null; avatar.src = "/public/characters/fallback.svg"; };
    } else if (m.letter) avatar = el("span", { class: "avatar seal", text: "✉" });
    else avatar = el("span", { class: "avatar you", text: "You" });
    var who = m.role === "resident" ? "You" : (m.character || "Desk");
    var d = dept ? characterFor(dept) : null;
    var body = el("div", { class: "body" }, [
      el("div", { class: "who" }, [el("b", { text: who }), d && !m.letter ? el("span", { class: "small", text: " · " + d.name }) : null, el("span", { class: "time", text: m.at ? new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "" })]),
      m.certified ? el("div", { class: "certified-tag", text: "Certified answer from city staff · demo, no legal effect" }) : null,
      m.letter ? el("div", { class: "letter", text: m.text }) : el("div", { class: "text", text: m.text }),
      m.has_sketch ? el("div", { class: "small attach", text: "📎 drawing attached" }) : null,
      opts.newest && m.role === "desk" && opts.session && !opts.session.busy ? quickReplies(m, opts.session) : null,
    ]);
    li.appendChild(avatar); li.appendChild(body);
    return li;
  }
  // Every visit starts at the front desk, so Marlowe's greeting is always the first line.
  function greetingText() {
    var d = characterFor("front_desk");
    return "Hello, I'm " + d.character + ", the AI assistant at the " + (town ? town.name + " " : "") + "Virtual City Help Desk. Tell me what you need, or ask me anything. I'll find the right department, read the city code, and prepare the paperwork. City staff make every decision.";
  }
  function greetingItem(at) { return chatItem({ role: "desk", department: "front_desk", character: characterFor("front_desk").character, text: greetingText(), at: at }); }
  function renderChat(s) {
    var chat = $("chat");
    var atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60;
    chat.textContent = "";
    chat.appendChild(greetingItem(s.created_at));
    (s.messages || []).forEach(function (m, i) { chat.appendChild(chatItem(m, { newest: i === s.messages.length - 1, session: s })); });
    if (s.busy) chat.appendChild(el("li", { class: "msg working" }, [el("span", { class: "avatar dots", text: "…" }), el("div", { class: "body" }, [el("div", { class: "small", text: characterFor(s.department || "front_desk").character + ": " + (state.workingText || "working…") })])]));
    if (s.status === "error") chat.appendChild(el("li", { class: "msg system" }, [el("div", { class: "notice error", text: "The desk hit a problem: " + (s.error || "") + ". Your conversation is saved; send another message to try again." })]));
    if (atBottom || s.messages.length !== state.lastMsgCount) chat.scrollTop = chat.scrollHeight;
  }

  // While a desk works, all four buttons on the remote show a spinner. They turn green strictly left to right, one at a time,
  // however the work really finishes, and the TV follows them, so a new resident can see the order of things.
  var PROGRESS = [["map", "locate"], ["code", "research"], ["submissions", "understand"], ["paperwork", "draft"]];
  var PROGRESS_GAP = 900;
  function stepFinished(s, name) {
    if (!s.busy) return true;
    var st = (s.steps || []).filter(function (x) { return x.name === name; })[0];
    return !!st && st.status !== "pending" && st.status !== "running";
  }
  function deskAtWork(s) {
    return !!s.busy && (s.steps || []).some(function (x) { return ["understand", "locate", "research", "draft"].indexOf(x.name) >= 0 && (x.status === "running" || x.status === "done"); });
  }
  function trackProgress(s) {
    var p = state.progress;
    if (!p.active && deskAtWork(s)) { p.active = true; p.shown = 0; p.nextAt = 0; p.reveal = null; }
    if (!p.active || p.shown >= PROGRESS.length || !stepFinished(s, PROGRESS[p.shown][1])) return;
    var wait = p.nextAt - Date.now();
    if (wait > 0) return;
    p.reveal = PROGRESS[p.shown][0]; p.shown++; p.nextAt = Date.now() + PROGRESS_GAP;
  }
  function settleProgress(s) {
    var p = state.progress;
    clearTimeout(p.timer);
    if (!p.active) return;
    if (p.shown >= PROGRESS.length) { if (!s.busy) { p.active = false; renderRemote(s); } return; }
    if (!stepFinished(s, PROGRESS[p.shown][1])) return;
    p.timer = setTimeout(function () {
      if (!state.session) return;
      trackProgress(state.session); autoChannel(state.session); renderScreen(state.session); renderRemote(state.session); settleProgress(state.session);
    }, Math.max(50, p.nextAt - Date.now()));
  }

  // The TV changes channel when new work appears, unless the resident is mid-edit.
  function contentSig(s) {
    return {
      map: s.pin ? s.pin.lat + "," + s.pin.lon : s.parcel ? s.parcel.id : needsPin(s) ? "needs-pin" : null,
      code: s.research ? (s.research.process_tier + "|" + (s.research.applicable_sections || []).length + "|" + (s.steps || []).filter(function (x) { return x.name === "research" && x.status === "done"; }).length + "|" + s.updated_at) : null,
      submissions: (s.has_sketch ? "sketch" : "") + "|" + (s.understanding ? JSON.stringify(s.understanding).length : 0),
      paperwork: s.packet ? (s.packet.title + "|" + (s.packet.documents || []).length + "|" + s.updated_at) : null,
    };
  }
  function autoChannel(s) {
    var sig = contentSig(s);
    var order = ["map", "submissions", "code", "paperwork"];
    var changed = order.filter(function (c) { return sig[c] && sig[c] !== state.seen[c]; });
    changed.forEach(function (c) { state.fresh[c] = true; });
    // Which channel to show: the latest finished piece of work in pipeline order.
    var target = null;
    if (changed.indexOf("paperwork") >= 0) target = "paperwork";
    else if (changed.indexOf("code") >= 0) target = "code";
    else if (changed.indexOf("map") >= 0) target = "map";
    else if (changed.indexOf("submissions") >= 0 && s.has_sketch && state.seen.submissions === null) target = "submissions";
    var p = state.progress;
    if (p.active) {
      target = p.reveal && changed.indexOf(p.reveal) >= 0 && (p.reveal !== "submissions" || s.has_sketch) ? p.reveal : null;
      p.reveal = null;
    }
    // A phone never jumps away from the chat by itself; the tab shows a dot instead.
    if (target && !state.editing && !state.lockOnce && !isPhone()) { state.channel = target; state.manual = false; }
    state.lockOnce = false;
    if (state.channel === "welcome" && s.ref && !p.active) state.channel = s.packet ? "paperwork" : s.research ? "code" : s.parcel ? "map" : (s.has_sketch || s.understanding) ? "submissions" : "welcome";
    var looking = !isPhone() || state.phoneView === "screen";
    order.forEach(function (c) { if (c === state.channel && looking) { state.seen[c] = sig[c]; state.fresh[c] = false; } else if (!sig[c]) state.seen[c] = sig[c]; });
  }
  function hasContent(s, c) {
    if (!s) return false;
    if (c === "map") return !!(s.parcel || s.pin || needsPin(s));
    if (c === "code") return !!s.research;
    if (c === "submissions") return !!(s.has_sketch || s.understanding || (s.messages && s.messages.length));
    if (c === "paperwork") return !!s.packet;
    return false;
  }
  function renderRemote(s) {
    Array.prototype.forEach.call(document.querySelectorAll(".rbtn"), function (b) {
      var c = b.dataset.channel;
      b.classList.toggle("active", state.channel === c);
      b.classList.toggle("empty", !hasContent(s, c));
      b.classList.toggle("fresh", isPhone() && !!state.fresh[c] && (state.channel !== c || state.phoneView !== "screen"));
      var i = PROGRESS.map(function (x) { return x[0]; }).indexOf(c), loading = state.progress.active && i >= state.progress.shown;
      b.classList.toggle("loading", loading);
      b.classList.toggle("done", !loading && !!s && (c === "submissions" ? !!(s.has_sketch || s.understanding) : hasContent(s, c)));
      b.setAttribute("aria-busy", loading ? "true" : "false");
      b.setAttribute("aria-selected", state.channel === c ? "true" : "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".rbtn"), function (b) {
    b.addEventListener("click", function () {
      state.channel = b.dataset.channel; state.manual = true; state.fresh[state.channel] = false;
      phoneShow("screen");
      if (state.session) { state.seen[state.channel] = contentSig(state.session)[state.channel]; renderScreen(state.session); renderRemote(state.session); }
      else { renderScreen(null); renderRemote(null); }
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    var map = { 1: "map", 2: "code", 3: "submissions", 4: "paperwork" };
    if (map[e.key]) { var b = document.querySelector('.rbtn[data-channel="' + map[e.key] + '"]'); if (b) b.click(); }
  });

  function applyZoom() {
    var z = state.zoom[state.channel] || 1;
    var inner = $("screenInner");
    if (inner) inner.style.zoom = String(z);
    $("zoomReset").textContent = Math.round(z * 100) + "%";
  }
  function setZoom(z) {
    z = Math.round(Math.min(2, Math.max(0.5, z)) * 20) / 20;
    state.zoom[state.channel] = z;
    try { localStorage.setItem("cc_zoom", JSON.stringify(state.zoom)); } catch (e) {}
    applyZoom();
  }
  $("zoomIn").addEventListener("click", function () { setZoom((state.zoom[state.channel] || 1) + 0.1); });
  $("zoomOut").addEventListener("click", function () { setZoom((state.zoom[state.channel] || 1) - 0.1); });
  $("zoomReset").addEventListener("click", function () { setZoom(1); });
  function setExpanded(on) {
    state.expanded = !!on;
    document.body.classList.toggle("tv-expanded", state.expanded);
    $("expandBtn").textContent = state.expanded ? "\u2715 Close" : "\u2922 Expand";
  }
  $("expandBtn").addEventListener("click", function () { setExpanded(!state.expanded); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.expanded) setExpanded(false); });
  function renderScreen(s) {
    var outer = $("screen"); outer.textContent = "";
    var screen = el("div", { class: "screen-inner", id: "screenInner" });
    outer.appendChild(screen);
    $("tvLabel").textContent = CHANNEL_LABEL[state.channel] || "";
    $("tvModel").textContent = "";
    outer.className = "screen ch-" + state.channel;
    applyZoom();
    if (state.channel === "welcome" || !s) return renderWelcome(screen);
    if (state.channel === "map" && (s.pin || needsPin(s))) return renderPinMap(screen, s);
    if (state.channel === "map") return hasContent(s, "map") ? renderParcel(screen, s) : renderEmpty(screen, "No parcel yet", "Tell " + characterFor(s.department || "front_desk").character + " the property address or tax parcel number and the county map will zoom in here.");
    if (state.channel === "code") return hasContent(s, "code") ? renderResearch(screen, s) : renderEmpty(screen, "No code review yet", "Once the desk has read the city code for your request, the review appears here with every section quoted.");
    if (state.channel === "submissions") return renderSubmissions(screen, s);
    if (state.channel === "paperwork") return hasContent(s, "paperwork") ? renderPaperwork(screen, s) : renderEmpty(screen, "No paperwork yet", "When the desk has what it needs, the paperwork is drafted here, in a city-style format, for you to review.");
  }
  function renderEmpty(screen, title, text) {
    screen.classList.add("is-empty");
    screen.appendChild(el("div", { class: "empty" }, [el("div", { class: "big", text: title }), el("p", { text: text })]));
  }
  // Every desk at a glance. Choosing one asks the front desk for it, so the resident's consent step still happens.
  function directory() {
    var grid = el("div", { class: "dir-grid" });
    ((town && town.departments) || []).filter(function (d) { return d.id !== "front_desk"; }).forEach(function (d) {
      var pic = el("img", { src: portraitSrc(d.id, "neutral"), alt: "", loading: "lazy" });
      pic.onerror = function () { pic.onerror = null; pic.src = "/public/characters/fallback.svg"; };
      var b = el("button", { type: "button", class: "dir-item", title: d.character + ", AI assistant with " + d.name }, [pic, el("span", { class: "dir-name", text: d.short || d.name }), el("span", { class: "dir-who", text: d.character })]);
      b.addEventListener("click", function () { sendMessage("I'd like to talk to " + d.name + "."); });
      grid.appendChild(b);
    });
    return el("div", { class: "directory" }, [el("div", { class: "dir-title", text: "Directory" }), grid]);
  }
  function renderWelcome(screen) {
    var w = el("div", { class: "welcome" }, [
      el("h1", { text: "Welcome to the " + (town ? town.name : "city") + " help desk." }),
      el("p", { text: "Tell me what you need, in your own words: a permit, a pothole, a utility bill, a pavilion for a party. I'll find the right department, read the city code, and prepare the paperwork. City staff make every decision." }),
      el("p", { class: "notice" }, [(town && town.wording.exampleCity || "") + " ", el("a", { href: "/about", text: "How this site works" })]),
      el("div", { class: "examples", id: "welcomeExamples" }),
      el("p", { class: "small", text: "This screen shows the work as it happens. Use the remote to look at the parcel map, the code review, what you've given us, and the paperwork." }),
      el("p", { class: "small", text: "This is a public demo: the staff workspace is open to everyone, so anything you type here can be seen there. Please use made-up names and details." }),
      el("p", { class: "small" }, ["The desk characters are AI assistants. They can make mistakes, and nothing here is legal advice. You must be 18 or older to use this demo. ", el("a", { href: "/privacy", text: "Privacy and terms" })]),
      el("p", { class: "small", id: "demoNote", text: "" }),
    ]);
    screen.appendChild(w);
    w.insertBefore(directory(), w.querySelector(".examples").nextSibling);
    [["I want to split my lot and sell the back half to my son.", "lot split"], ["There's a big pothole on my street.", "pothole"], ["I need a burn permit for my weed pile.", "burn"], ["Why is my water bill so high?", "bill"], ["I'd like to reserve a park pavilion.", "pavilion"], ["We need police standby at our festival.", "standby"]].forEach(function (x) {
      var b = el("button", { type: "button", class: "quiet", text: x[0] });
      b.addEventListener("click", function () { $("text").value = x[0]; $("text").focus(); });
      $("welcomeExamples").appendChild(b);
    });
  }

  // ---------- the clickable map: a resident marks a spot on a real street ----------
  function pinWindow(v) {
    var dLat = v.m / 110574, dLon = dLat * (isPhone() ? 480 / 600 : 1000 / 750) / Math.cos(v.lat * Math.PI / 180);
    return [v.lon - dLon, v.lat - dLat, v.lon + dLon, v.lat + dLat];
  }
  function pinImageSrc(v, spot) {
    return "/api/map/area.svg?lon=" + v.lon.toFixed(6) + "&lat=" + v.lat.toFixed(6) + "&m=" + Math.round(v.m) + (isPhone() ? "&tall=1" : "") + (spot ? "&pin=" + spot.lon.toFixed(6) + "," + spot.lat.toFixed(6) : "");
  }
  function renderPinMap(screen, s) {
    $("tvLabel").textContent = "Mark the Spot";
    $("tvModel").textContent = "state street and parcel layers · no AI";
    var saved = s.pin;
    if (!state.pinView) {
      var c = saved ? [saved.lon, saved.lat] : town.mapCenter;
      state.pinView = { lon: c[0], lat: c[1], m: saved ? 150 : 500 };
    }
    var v = state.pinView;
    var spot = function () { return state.pinDraft || saved || null; };
    screen.appendChild(el("p", { class: "lead", text: saved && !state.pinDraft ? "Spot marked" + (saved.road ? " near " + saved.road : "") + (saved.address ? ", closest address " + saved.address : "") + ". " + (isPhone() ? "Tap" : "Click") + " the map to move it." : (isPhone() ? "Tap" : "Click") + " the map to mark the spot. Drag to move around." }));
    var img = el("img", { class: "pinpic", alt: "Street map. Click to mark the spot.", draggable: "false", src: pinImageSrc(v, spot()) });
    var wrap = el("div", { class: "pinmap" }, [img]);
    function zoom(f) { v.m = Math.min(3600, Math.max(60, v.m * f)); img.src = pinImageSrc(v, spot()); }
    var zin = el("button", { type: "button", class: "quiet", text: "Zoom in" }), zout = el("button", { type: "button", class: "quiet", text: "Zoom out" });
    zin.addEventListener("click", function () { zoom(0.6); });
    zout.addEventListener("click", function () { zoom(1 / 0.6); });
    screen.appendChild(el("div", { class: "mapviews" }, [zin, zout]));
    screen.appendChild(wrap);
    var down = null;
    wrap.addEventListener("pointerdown", function (e) { e.preventDefault(); wrap.setPointerCapture(e.pointerId); down = { x: e.clientX, y: e.clientY }; });
    wrap.addEventListener("pointerup", function (e) {
      if (!down) return;
      var r = img.getBoundingClientRect(), box = pinWindow(v), dx = e.clientX - down.x, dy = e.clientY - down.y;
      down = null;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        v.lon -= dx / r.width * (box[2] - box[0]);
        v.lat += dy / r.height * (box[3] - box[1]);
      } else {
        state.pinDraft = { lon: box[0] + (e.clientX - r.left) / r.width * (box[2] - box[0]), lat: box[3] - (e.clientY - r.top) / r.height * (box[3] - box[1]) };
        go.disabled = false;
      }
      img.src = pinImageSrc(v, spot());
    });
    var note = el("input", { type: "text", id: "pinNote", maxlength: "300", placeholder: "Anything that helps the crew find it (optional)" });
    var go = el("button", { type: "button", text: "Use this spot" });
    go.disabled = !state.pinDraft;
    var msg = el("div", { class: "small" });
    go.addEventListener("click", async function () {
      go.disabled = true;
      try {
        await api("/api/sessions/" + encodeURIComponent(state.ref) + "/pin?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify({ lon: state.pinDraft.lon, lat: state.pinDraft.lat, note: note.value }) });
        state.pinDraft = null;
        phoneShow("chat");
        poll();
      } catch (e) { msg.textContent = e.message; go.disabled = false; }
    });
    screen.appendChild(el("div", { class: "actions" }, [note, go]));
    screen.appendChild(msg);
    screen.appendChild(el("p", { class: "small", text: "Prefer words? Just tell " + characterFor(s.department || "front_desk").character + " the closest address in the chat." }));
  }

  function renderParcel(screen, s) {
    var p = s.parcel;
    $("tvModel").textContent = "county zoning layer + state parcels · no AI";
    var VIEWS = { parcel: 80, block: 160, area: 400, city: 0 };
    var bar = el("div", { class: "mapviews" }, [el("span", { class: "small", text: "View" })]);
    [["parcel", "Parcel"], ["block", "Block"], ["area", "Area"], ["city", "Whole city"]].forEach(function (v) {
      var b = el("button", { type: "button", class: "quiet" + (state.mapView === v[0] ? " active" : ""), text: v[1] });
      b.addEventListener("click", function () { state.mapView = v[0]; renderScreen(state.session); });
      bar.appendChild(b);
    });
    screen.appendChild(bar);
    var firstTime = state.lastParcelId !== p.id;
    var wrap = el("div", { class: "mapwrap" + (!firstTime && state.mapView !== "city" ? " zoomed" : "") });
    var zo = el("img", { class: "zoomout", src: "/api/map/city.svg", alt: "City zoning map" });
    var zi = el("img", { class: "zoomin", src: "/api/map/parcel/" + encodeURIComponent(p.id) + ".svg?m=" + (VIEWS[state.mapView] || 160) + (isPhone() ? "&phone=1" : ""), alt: "Zoning map around the parcel" });
    wrap.appendChild(zo); wrap.appendChild(zi);
    screen.appendChild(wrap);
    if (firstTime) { state.lastParcelId = p.id; if (state.mapView === "city") state.mapView = "block"; setTimeout(function () { wrap.classList.add("zoomed"); }, 400); }
    var zoneColor = town && town.zones && town.zones[p.zone] ? town.zones[p.zone].color : "#eee";
    screen.appendChild(el("p", { class: "lead", text: "It looks like you are talking about this parcel located at " + (p.address || "(no address on record)") + ", with tax parcel number " + p.id + "." }));
    var facts = el("div", { class: "parcel-facts" }, [
      el("div", null, [el("b", { text: "Address" }), p.address || "(none on record)"]),
      el("div", null, [el("b", { text: "Tax parcel number" }), p.id || "(none)"]),
      el("div", null, [el("b", { text: "Zone" }), el("span", { class: "zonepill", style: "background:" + zoneColor, text: p.zone || "?" }), " ", el("span", { class: "small", text: p.zoneName || "" })]),
      el("div", null, [el("b", { text: "Size" }), (p.areaAcres || "?") + " acres" + (p.areaSqft ? " (" + p.areaSqft.toLocaleString() + " sq ft)" : "")]),
      el("div", null, [el("b", { text: "On the tax roll" }), (p.propertyClass || "?") + (p.houses != null ? ", " + p.houses + " dwelling(s)" : "") + (p.yearBuilt ? ", built " + p.yearBuilt : "")]),
      el("div", null, [el("b", { text: "Owner of record" }), (s.owner ? s.owner.name : "?") + " ", el("span", { class: "small", text: "(fictional demo name)" })]),
    ]);
    screen.appendChild(facts);
    if (p.straddlesZones) screen.appendChild(el("div", { class: "notice warn", text: "This parcel touches more than one zone (" + p.zonesTouched.join(", ") + "). Staff confirm the zone from the official map." }));
    if (p.assumed) screen.appendChild(el("div", { class: "notice warn", text: "Several parcels share this address. I used " + p.id + "; tell me if yours is different." }));
    screen.appendChild(el("p", { class: "small", text: town ? town.notes.fictionalOwners : "" }));
  }

  function drawingWithOutline(src, reading) {
    var wrap = el("div", { class: "drawing" });
    var img = el("img", { src: src, alt: "Resident's drawing" });
    wrap.appendChild(img);
    var o = reading && reading.outline;
    if (o && o.width && o.height && o.objects && o.objects.length) {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 " + o.width + " " + o.height);
      svg.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none";
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
  function kv(rows) {
    var tb = el("tbody");
    rows.forEach(function (r) { if (r[1] == null || r[1] === "") return; tb.appendChild(el("tr", null, [el("th", { text: r[0] }), el("td", { text: String(r[1]) })])); });
    return el("table", { class: "kv" }, [tb]);
  }
  // ---------- the concept site plan ----------
  async function makeSitePlan() {
    state.channel = "submissions"; state.manual = true; state.planBusy = true; state.planError = "";
    phoneShow("screen"); renderScreen(state.session); renderRemote(state.session);
    try { await api("/api/sessions/" + encodeURIComponent(state.ref) + "/siteplan?key=" + encodeURIComponent(state.key), { method: "POST", body: "{}" }); }
    catch (e) { state.planError = e.message; }
    state.planBusy = false; state.lockOnce = true; $("screen").scrollTop = 0; // stay on the plan; don't jump to what else changed
    poll();
  }
  async function answerPlan(id, option, value) {
    try {
      await api("/api/sessions/" + encodeURIComponent(state.ref) + "/siteplan/answer?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify({ id: id, option: option, value: value }) });
      state.lockOnce = true;
      poll();
    } catch (e) { state.planError = e.message; renderScreen(state.session); }
  }
  async function confirmPlan() {
    try {
      await api("/api/sessions/" + encodeURIComponent(state.ref) + "/siteplan/confirm?key=" + encodeURIComponent(state.key), { method: "POST", body: "{}" });
      poll();
    } catch (e) { $("formMsg").textContent = e.message; }
  }
  // The plan, right above the application, with the one question that matters.
  function planCheck(screen, s) {
    var sp = s.site_plan && s.site_plan.plan;
    if (!sp) return;
    var src = "/api/sessions/" + encodeURIComponent(s.ref) + "/siteplan.svg?key=" + encodeURIComponent(state.key) + "&t=" + encodeURIComponent(s.updated_at);
    var wrap = el("div", { class: "plan-check" });
    screen.appendChild(wrap);
    wrap.appendChild(el("h2", { text: "Your concept site plan" }));
    wrap.appendChild(el("a", { href: "/site-plan?ref=" + encodeURIComponent(s.ref), target: "_blank", rel: "noopener" }, [el("img", { class: "planimg", src: src, alt: "Concept site plan, drawn to scale" })]));
    if (s.site_plan.confirmed_at) { wrap.appendChild(el("p", { class: "small", text: "You confirmed this plan. It stays with your application." })); return; }
    var yes = el("button", { type: "button", text: "Looks right" });
    var change = el("button", { type: "button", class: "quiet", text: "Change the drawing" });
    yes.addEventListener("click", confirmPlan);
    change.addEventListener("click", function () { openSketchPad(true); });
    wrap.appendChild(el("p", { text: "Does this look right? It is a concept, not a survey." }));
    wrap.appendChild(el("div", { class: "row" }, [yes, change]));
  }

  // ---------- what's left to do, as a checklist ----------
  function ticks(ref) { try { return JSON.parse(localStorage.getItem("cc_ticks_" + ref)) || {}; } catch (e) { return {}; } }
  function stillNeeded(screen, s, p, blanks) {
    var mine = ticks(s.ref), items = [];
    items.push({ text: "Application prepared", done: true });
    if (s.site_plan) items.push({ text: "Check your concept site plan", done: !!s.site_plan.confirmed_at });
    (blanks || []).forEach(function (b) { items.push({ text: "Fill in: " + b, done: false }); });
    (p.questions || []).forEach(function (q) { items.push({ text: q, tick: true, done: !!mine[q] }); });
    items.push({ text: signatureFree(s) ? "Send it to " + deskName(s) : "Sign and submit to " + deskName(s), done: false });
    var count = el("span", { class: "small" });
    var list = el("ul", { class: "checklist-items" });
    function refresh() { count.textContent = items.filter(function (i) { return i.done; }).length + " of " + items.length + " done"; }
    items.forEach(function (it) {
      var box = el("input", { type: "checkbox", "aria-label": it.text });
      box.checked = it.done;
      // Only the items the resident handles can be ticked by hand; the app ticks the others itself.
      box.disabled = !it.tick;
      var row = el("li", { class: it.done ? "done" : "" }, [el("label", null, [box, el("span", { text: it.text })])]);
      box.addEventListener("change", function () {
        it.done = box.checked; row.className = it.done ? "done" : "";
        var now = ticks(s.ref); if (it.done) now[it.text] = true; else delete now[it.text];
        try { localStorage.setItem("cc_ticks_" + s.ref, JSON.stringify(now)); } catch (e) {}
        refresh();
      });
      list.appendChild(row);
    });
    refresh();
    screen.appendChild(el("div", { class: "checklist" }, [
      el("div", { class: "checklist-head" }, [el("h3", { text: "Still needed" }), count]),
      list,
      el("p", { class: "small", text: "Your ticks are only a reminder for you. Tell " + characterFor(s.department || "planning").character + " the answers so they go in your application." }),
    ]));
  }

  // ---------- the printed packet: the application, then every attachment ticked on it ----------
  function attachmentPages(s) {
    var pack = el("div", { class: "print-pack" }), n = 0, key = "?key=" + encodeURIComponent(state.key);
    var picked = CCForm.attachments(s, isService(s)).filter(function (a) { return a.on; });
    function page(a, children) { n++; pack.appendChild(el("section", { class: "pack-page" }, [el("h2", { text: "Attachment " + n + ": " + a.label })].concat(children))); }
    picked.forEach(function (a) {
      if (a.id === "sketch") page(a, [el("img", { class: "pack-img", src: "/api/sessions/" + encodeURIComponent(s.ref) + "/sketch" + key, alt: a.label })]);
      if (a.id === "plan") { n++; pack.appendChild(el("section", { class: "pack-plan" }, [el("img", { src: "/api/sessions/" + encodeURIComponent(s.ref) + "/siteplan.svg" + key, alt: "Attachment " + n + ": " + a.label })])); }
      if (a.id === "map") {
        var src = s.pin ? "/api/map/area.svg?lon=" + s.pin.lon + "&lat=" + s.pin.lat + "&m=300&pin=" + s.pin.lon + "," + s.pin.lat : "/api/map/parcel/" + encodeURIComponent(s.parcel.id) + ".svg?m=160";
        page(a, [el("img", { class: "pack-img", src: src, alt: a.label })]);
      }
      if (a.id === "record") page(a, s.messages.map(function (m) {
        var who = m.role === "resident" ? "Resident" : characterFor(m.department || s.department || "front_desk").character + " (AI assistant)";
        return el("div", { class: "pack-msg" }, [el("b", { text: who + (m.at ? " · " + new Date(m.at).toLocaleString() : "") }), el("p", { text: m.text || "" })]);
      }));
      if (a.id === "code") {
        var r = s.research || {};
        page(a, [r.process_explanation ? el("p", { text: r.process_explanation }) : null].concat((r.applicable_sections || []).map(function (x) {
          return el("div", { class: "pack-msg" }, [el("b", { text: "Section " + x.section + (x.title ? ": " + x.title : "") }), x.quote ? el("p", { text: "“" + x.quote + "”" }) : null, x.why ? el("p", { class: "small", text: x.why }) : null]);
        })));
      }
    });
    return pack;
  }
  async function printPacket(s) {
    var old = document.querySelector(".print-pack");
    if (old) old.remove();
    var pack = attachmentPages(s);
    $("screen").appendChild(pack);
    await Promise.all(Array.prototype.map.call(pack.querySelectorAll("img"), function (img) {
      return new Promise(function (done) { if (img.complete) return done(); img.onload = img.onerror = done; setTimeout(done, 15000); });
    }));
    window.addEventListener("afterprint", function gone() { window.removeEventListener("afterprint", gone); pack.remove(); });
    window.print();
  }
  function sitePlanBlock(screen, s) {
    var sp = s.site_plan && s.site_plan.plan;
    screen.appendChild(el("h2", { text: "Concept site plan" }));
    if (state.planError) screen.appendChild(el("div", { class: "notice error", text: state.planError }));
    if (state.planBusy) { screen.appendChild(el("p", { class: "small", text: "Drawing your plan to scale…" })); return; }
    if (!sp) {
      screen.appendChild(el("p", { class: "small", text: "Turn your sketch into a clean drawing, true to one scale. It is a concept, not a survey." }));
      var go = el("button", { type: "button", text: "Make a to-scale site plan" });
      go.addEventListener("click", makeSitePlan);
      screen.appendChild(go);
      return;
    }
    var src = "/api/sessions/" + encodeURIComponent(s.ref) + "/siteplan.svg?key=" + encodeURIComponent(state.key) + "&t=" + encodeURIComponent(s.updated_at);
    (sp.conflicts || []).filter(function (c) { return !c.answer; }).forEach(function (c) {
      var box = el("div", { class: "notice warn plan-q" }, [el("b", { text: c.title }), el("div", { text: c.detail })]);
      var row = el("div", { class: "row" });
      (c.options || []).forEach(function (o) {
        var b = el("button", { type: "button", class: "quiet", text: o.label });
        b.addEventListener("click", function () { answerPlan(c.id, o.id); });
        row.appendChild(b);
      });
      if (c.edit) {
        var input = el("input", { type: "text", inputmode: "decimal", class: "plan-num", "aria-label": c.edit.label, placeholder: c.edit.label });
        var save = el("button", { type: "button", class: "quiet", text: "Use this number" });
        save.addEventListener("click", function () { answerPlan(c.id, "number", input.value); });
        row.appendChild(input); row.appendChild(save);
      }
      box.appendChild(row);
      screen.appendChild(box);
    });
    var open = el("a", { href: "/site-plan?ref=" + encodeURIComponent(s.ref), target: "_blank", rel: "noopener" }, [el("img", { class: "planimg", src: src, alt: "Concept site plan, drawn to scale" })]);
    screen.appendChild(open);
    screen.appendChild(el("p", { class: "small", text: "To scale at 1 inch = " + sp.feetPerInch + " feet when printed from the button below. Measurements marked ≈ are estimates: tell " + characterFor(s.department || "front_desk").character + " if one is wrong." }));
    var print = el("a", { class: "planprint", href: "/site-plan?ref=" + encodeURIComponent(s.ref), target: "_blank", rel: "noopener", text: "Print at true scale" });
    var redo = el("button", { type: "button", class: "quiet", text: "Redraw from my sketch" });
    redo.addEventListener("click", makeSitePlan);
    screen.appendChild(el("div", { class: "row" }, [print, redo]));
  }
  function renderSubmissions(screen, s) {
    var u = s.understanding;
    var any = false;
    if (s.has_sketch) {
      any = true;
      var st = (s.steps || []).find(function (x) { return x.name === "sketch"; });
      var reading = st && st.status === "done" ? st.output : null;
      $("tvModel").textContent = "Muse Spark · image  +  SAM 3.1 · outlines";
      screen.appendChild(el("h2", { text: "Your drawing" }));
      screen.appendChild(drawingWithOutline("/api/sessions/" + encodeURIComponent(s.ref) + "/sketch?key=" + encodeURIComponent(state.key), reading));
      if (reading) {
        screen.appendChild(el("p", { class: "small", text: "Read as: " + String(reading.drawing_type || "").replace(/_/g, " ") + ", " + reading.readability + "." + (reading.building_code_site_plan_note ? " " + reading.building_code_site_plan_note : "") }));
        if (reading.dimensions && reading.dimensions.length) screen.appendChild(kv(reading.dimensions.map(function (d) { return [d.what, d.value_text]; })));
        if (reading.outline && reading.outline.objects) screen.appendChild(el("p", { class: "small", text: "SAM 3.1 outlined " + reading.outline.objects.length + " shape(s) for staff to check against your words." }));
      } else if (st && st.status === "running") screen.appendChild(el("p", { class: "small", text: "Reading the drawing…" }));
      sitePlanBlock(screen, s);
    }
    if (u) {
      any = true;
      screen.appendChild(el("h2", { text: "What you've told us" }));
      var rows = [["Request", u.summary], ["What you want to do", u.proposal && u.proposal.what], ["Use or structure", u.proposal && u.proposal.use_or_structure]];
      if (u.location) rows.push(["Property", [u.location.address_text, u.location.parcel_id_text].filter(Boolean).join(" · ")], ["Your own property", u.location.is_own_property === true ? "yes" : u.location.is_own_property === false ? "no" : ""]);
      if (u.applicant) rows.push(["Name", u.applicant.name], ["Phone", u.applicant.phone], ["Email", u.applicant.email]);
      screen.appendChild(kv(rows));
      if (u.proposal && u.proposal.numbers && u.proposal.numbers.length) {
        screen.appendChild(el("h3", { text: "Numbers you gave, exactly as written" }));
        screen.appendChild(kv(u.proposal.numbers.map(function (n) { return [n.label, n.value]; })));
      }
    }
    if (s.packet && s.packet.documents) {
      var given = [];
      s.packet.documents.forEach(function (d) { (d.fields || []).forEach(function (f) { if (f.source === "resident" && f.value) given.push([f.label, f.value]); }); });
      if (given.length) { any = true; screen.appendChild(el("h3", { text: "Entries on the paperwork that came from you" })); screen.appendChild(kv(given)); }
    }
    var residentTurns = (s.messages || []).filter(function (m) { return m.role === "resident"; }).length;
    if (residentTurns) { any = true; screen.appendChild(el("p", { class: "small", text: residentTurns + " message(s) from you so far. Everything above comes from your words, your drawing, and the public parcel record; nothing is invented." })); }
    if (!any) renderEmpty(screen, "Nothing yet", "Your drawings and the details you give will be listed here as you go.");
  }

  function tierInfo(id) { return (town && town.processTiers || []).find(function (t) { return t.id === id; }); }
  // A department desk's research: the answer, the real code it read, and the sample procedure, kept visibly apart.
  function renderDeskResearch(screen, s) {
    var r = s.research;
    var svc = r.service ? (town.services || []).find(function (x) { return x.id === r.service.id; }) : null;
    $("tvModel").textContent = "Muse Spark · " + (r.tool_log ? r.tool_log.length : 0) + " tool calls on the code and the service catalog";
    screen.appendChild(el("div", { class: "tier" }, [el("div", null, [el("div", { class: "small", text: "What " + characterFor(r.department).character + " found" }), el("div", { class: "big", text: svc ? svc.name : characterFor(r.department).name }), el("div", { class: "small", text: svc ? svc.decider + " decides" : "" }), el("div", { style: "margin-top:6px", text: r.process_explanation })])]));
    if ((r.applicable_sections || []).length) {
      screen.appendChild(el("h3", { text: "Real city code (quotes checked against the code text)" }));
      r.applicable_sections.forEach(function (x) {
        var q = el("div", { class: "quote" }, [x.quote ? el("span", { text: "“" + x.quote + "”" }) : el("span", { class: "small", text: "(no verified quote; " + x.why + ")" })]);
        q.appendChild(el("span", { class: "cite" }, [el("a", { href: x.url || "#", target: "_blank", rel: "noopener", text: "Section " + x.section + (x.title ? " " + x.title : "") }), " · " + (x.quote_verified ? "quote verified" : "paraphrase") + " · " + x.why]));
        screen.appendChild(q);
      });
    }
    if (svc) {
      var box = el("div", { class: "sample" }, [el("div", { class: "sample-tag", text: "Sample procedure · example city, not law" })]);
      box.appendChild(el("ol", null, (svc.procedure || []).map(function (p) { return el("li", { text: p }); })));
      if (svc.timing) box.appendChild(el("p", null, [el("b", { text: "Sample timing: " }), svc.timing]));
      if (svc.fees) box.appendChild(el("p", null, [el("b", { text: "Sample fees: " }), svc.fees]));
      if ((svc.sources || []).length) box.appendChild(el("p", { class: "small" }, ["Written after reading: "].concat(svc.sources.reduce(function (acc, x, i) { if (i) acc.push("; "); acc.push(el("a", { href: x.url, target: "_blank", rel: "noopener", text: x.government })); return acc; }, []))));
      screen.appendChild(box);
    }
    if (r.tool_log && r.tool_log.length) {
      var det = el("details", null, [el("summary", { class: "small", text: "What the desk looked up (" + r.tool_log.length + " tool calls)" })]);
      det.appendChild(el("ul", { class: "toollog" }, r.tool_log.map(function (x) { return el("li", { text: x.summary || x.tool }); })));
      screen.appendChild(det);
    }
    screen.appendChild(el("p", { class: "small", text: town ? town.wording.staffDecide : "" }));
  }
  function renderResearch(screen, s) {
    var r = s.research;
    if (r.desk) return renderDeskResearch(screen, s);
    $("tvModel").textContent = "Muse Spark · " + (r.tool_log ? r.tool_log.length : 0) + " tool calls on the real code";
    var t = tierInfo(r.process_tier);
    screen.appendChild(el("div", { class: "tier" }, [el("div", null, [el("div", { class: "small", text: "Process the code provides" }), el("div", { class: "big", text: t ? t.label : r.process_tier }), el("div", { class: "small", text: t ? t.screenDecider || "Decided by " + t.decider : "" }), el("div", { style: "margin-top:6px", text: r.process_explanation })])]));
    if (r.required_applications && r.required_applications.length) {
      screen.appendChild(el("h3", { text: "You would file" }));
      screen.appendChild(el("ul", null, r.required_applications.map(function (id) { var a = town.applicationTypes[id] || {}; return el("li", { text: (a.name || id) + " (section " + (a.section || "?") + ")" }); })));
    }
    if (r.path_if_blocked) screen.appendChild(el("div", { class: "notice warn" }, [el("strong", { text: "Where the code blocks something, it also provides a path: " }), r.path_if_blocked]));
    screen.appendChild(el("h3", { text: "Use under the zone's table" }));
    screen.appendChild(el("div", null, [chip(r.use_status, "Table entry: " + String(r.use_status).replace(/_/g, " ") + " (not a decision)"), " ", r.use_table_row ? el("span", { class: "small", text: r.use_table_row }) : null]));
    if (r.standards && r.standards.length) {
      screen.appendChild(el("h3", { text: "Numbers checked" }));
      var tb = el("tbody");
      r.standards.forEach(function (x) { tb.appendChild(el("tr", null, [el("td", { text: x.section }), el("td", { text: x.requirement }), el("td", { text: x.required_value }), el("td", { text: x.proposed_value }), el("td", null, [chip(x.status)])])); });
      screen.appendChild(el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Section" }), el("th", { text: "Rule" }), el("th", { text: "Code says" }), el("th", { text: "You said" }), el("th", { text: "" })])]), tb]));
    }
    if (r.missing_information && r.missing_information.length) {
      screen.appendChild(el("h3", { text: "Still needed" }));
      screen.appendChild(el("ul", null, r.missing_information.map(function (m) { return el("li", null, [el("b", { text: m.question + " " }), el("span", { class: "small", text: m.why })]); })));
    }
    screen.appendChild(el("h3", { text: "Sections cited (quotes checked against the code text)" }));
    (r.applicable_sections || []).forEach(function (x) {
      var q = el("div", { class: "quote" }, [x.quote ? el("span", { text: "“" + x.quote + "”" }) : el("span", { class: "small", text: "(no verified quote; " + x.why + ")" })]);
      q.appendChild(el("span", { class: "cite" }, [el("a", { href: x.url || "#", target: "_blank", rel: "noopener", text: "Section " + x.section + (x.title ? " " + x.title : "") }), " · " + (x.quote_verified ? "quote verified" : "paraphrase") + " · " + x.why]));
      screen.appendChild(q);
    });
    if (r.tool_log && r.tool_log.length) {
      var det = el("details", null, [el("summary", { class: "small", text: "What the planner looked up (" + r.tool_log.length + " tool calls)" })]);
      det.appendChild(el("ul", { class: "toollog" }, r.tool_log.map(function (x) { return el("li", { text: x.summary || x.tool }); })));
      screen.appendChild(det);
    }
    screen.appendChild(el("p", { class: "small", text: town ? town.wording.staffDecide : "" }));
  }

  // ---------- paperwork, in the city's application format ----------
  function renderPaperwork(screen, s) {
    var p = s.packet;
    var office = (town && town.office) || {};
    $("tvModel").textContent = "Muse Spark · drafted from your words only";
    var pt = (town && town.packetTypes && town.packetTypes[p.packet_type]) || "Packet";
    screen.appendChild(el("p", { class: "lead", text: pt + ": " + (p.title || "") + ". " + (p.one_line_summary || "") }));
    if (p.process_summary) screen.appendChild(el("div", { class: "notice", text: p.process_summary }));
    planCheck(screen, s);
    var pages = el("div", { class: "pages" });
    var sigSrc = s.signature ? "/api/sessions/" + encodeURIComponent(state.ref) + "/signature?key=" + encodeURIComponent(state.key) + "&t=" + encodeURIComponent(s.signature.signed_at) : null;
    (p.documents || []).forEach(function (d, di) {
      pages.appendChild(CCForm.page(town, s, d, di, p.documents.length, { editing: state.editing, sigSrc: sigSrc }));
    });
    screen.appendChild(pages);
    var actions = el("div", { class: "actions" });
    var hasDocs = (s.parcel || isService(s)) && p.documents && p.documents.length && p.packet_type !== "referral";
    var blanks = isService(s) ? (p.documents[0].fields || []).filter(function (f) { return f.required && !String(f.value || "").trim(); }).map(function (f) { return f.label; }) : [];
    var canSubmit = ["open", "ready"].includes(s.status) && hasDocs && !s.submitted_at;
    var canResubmit = !!s.submitted_at && s.changed_since_submit && hasDocs;
    if (s.submitted_at && !s.changed_since_submit && !state.editing) actions.appendChild(el("span", { class: "small", text: "Submitted " + fmt(s.submitted_at) + (s.resubmit_count ? " (update " + s.resubmit_count + ")" : "") + ". You can keep talking or edit; any change can be resubmitted." }));
    if ((canSubmit || canResubmit) && !state.editing && !state.signing) {
      if (!blanks.length) {
        var free = signatureFree(s);
        var submit = el("button", { type: "button", text: canResubmit ? (free ? "Send the update" : "Sign and resubmit") : (free ? "Send to " + deskName(s) : "Sign and submit to " + deskName(s)) });
        submit.addEventListener("click", function () { if (free) sendWithoutSignature(); else openSignPanel(); });
        actions.appendChild(submit);
      }
    }
    if (state.signing && !state.editing) screen.insertBefore(signPanel(s), screen.firstChild);
    if (hasDocs && !state.editing && !s.busy) {
      var edit = el("button", { type: "button", class: "secondary", text: "Edit it myself" });
      edit.addEventListener("click", function () { state.editing = true; renderScreen(state.session); });
      actions.appendChild(edit);
      actions.appendChild(el("span", { class: "small", text: "Or just tell " + characterFor(s.department || "planning").character + " what to change." }));
    }
    if (canResubmit && !state.editing && !state.signing) screen.insertBefore(el("div", { class: "notice warn", text: signatureFree(s) ? "You have made changes since you sent this. Send the update so staff see it." : "You have made changes since you submitted. Sign the updated application and resubmit to send it to " + deskName(s) + "." }), screen.firstChild);
    if (state.editing) {
      var save = el("button", { type: "button", text: "Save my edits" });
      save.addEventListener("click", async function () {
        var docs = JSON.parse(JSON.stringify(p.documents));
        screen.querySelectorAll("input.field").forEach(function (inp) { docs[+inp.dataset.doc].fields[+inp.dataset.field].value = inp.value; docs[+inp.dataset.doc].fields[+inp.dataset.field].source = "resident"; });
        screen.querySelectorAll("textarea[data-narrative]").forEach(function (ta) { docs[+ta.dataset.doc].narrative = ta.value; });
        try { await api("/api/sessions/" + state.ref + "/packet?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify({ documents: docs }) }); state.editing = false; poll(); } catch (e) { $("formMsg").textContent = e.message; }
      });
      var cancel = el("button", { type: "button", class: "quiet", text: "Cancel" });
      cancel.addEventListener("click", function () { state.editing = false; renderScreen(state.session); });
      actions.appendChild(save); actions.appendChild(cancel);
    }
    var print = el("button", { type: "button", class: "quiet", text: "Print / save PDF" });
    print.addEventListener("click", function () { printPacket(s); });
    actions.appendChild(print);
    screen.appendChild(actions);
    if (s.submitted_at && !s.changed_since_submit) screen.appendChild(el("p", { class: "small", text: "Staff will write back in this conversation." }));
    if (hasDocs && !s.submitted_at) stillNeeded(screen, s, p, blanks);
  }

  async function sendWithoutSignature() {
    try {
      await api("/api/sessions/" + state.ref + "/submit?key=" + encodeURIComponent(state.key), { method: "POST", body: "{}" });
      phoneShow("chat");
      poll();
    } catch (e) { $("formMsg").textContent = e.message; }
  }

  // ---------- signing panel (draw or type, then submit) ----------
  var pad = { canvas: null, ctx: null, drawing: false, strokes: 0, last: null };
  function openSignPanel() {
    state.signing = true; state.channel = "paperwork"; state.manual = true;
    phoneShow("screen");
    renderScreen(state.session); renderRemote(state.session);
    $("screen").scrollTop = 0; // the panel is the first thing on the screen; scroll only the TV, never the whole page
  }
  function signPanel(s) {
    var u = s.understanding || {};
    var suggested = (u.applicant && u.applicant.name) || "";
    var panel = el("div", { class: "signpanel" });
    panel.appendChild(el("h2", { text: s.submitted_at ? "Sign the updated application" : "Sign your application" }));
    panel.appendChild(el("p", { class: "consent", text: CONSENT_TEXT }));
    var name = el("input", { type: "text", id: "sigName", placeholder: "Your full name", autocomplete: "name", maxlength: "120" });
    name.value = suggested;
    panel.appendChild(el("label", { class: "small", text: "Full name" }));
    panel.appendChild(name);
    var tabs = el("div", { class: "row tabs" });
    var drawTab = el("button", { type: "button", class: "quiet active", text: "Draw it" });
    var typeTab = el("button", { type: "button", class: "quiet", text: "Type it" });
    tabs.appendChild(drawTab); tabs.appendChild(typeTab);
    panel.appendChild(tabs);
    var method = "drawn";
    var drawBox = el("div", { class: "drawbox" });
    var canvas = el("canvas", { width: "640", height: "180", class: "sigpad", "aria-label": "Draw your signature here" });
    drawBox.appendChild(canvas);
    var clear = el("button", { type: "button", class: "quiet", text: "Clear" });
    drawBox.appendChild(el("div", { class: "row", style: "justify-content:space-between;margin-top:6px" }, [el("span", { class: "small", text: "Sign with your mouse or finger" }), clear]));
    panel.appendChild(drawBox);
    var typeBox = el("div", { class: "typebox hidden" });
    var preview = el("div", { class: "sigpreview", text: suggested || "Your name" });
    typeBox.appendChild(preview);
    typeBox.appendChild(el("div", { class: "small", text: "Your typed name becomes your signature." }));
    panel.appendChild(typeBox);
    setupPad(canvas);
    clear.addEventListener("click", function () { clearPad(); });
    drawTab.addEventListener("click", function () { method = "drawn"; drawTab.classList.add("active"); typeTab.classList.remove("active"); drawBox.classList.remove("hidden"); typeBox.classList.add("hidden"); });
    typeTab.addEventListener("click", function () { method = "typed"; typeTab.classList.add("active"); drawTab.classList.remove("active"); typeBox.classList.remove("hidden"); drawBox.classList.add("hidden"); preview.textContent = name.value || "Your name"; });
    name.addEventListener("input", function () { preview.textContent = name.value || "Your name"; });
    var agree = el("input", { type: "checkbox", id: "sigAgree" });
    panel.appendChild(el("label", { class: "agree" }, [agree, el("span", { text: " I agree to sign this application electronically. My signature will be recorded with the date, time and the exact text of the application." })]));
    var msg = el("div", { class: "small notice error hidden" });
    var go = el("button", { type: "button", text: s.submitted_at ? "Sign and resubmit" : "Sign and submit" });
    var cancel = el("button", { type: "button", class: "quiet", text: "Cancel" });
    cancel.addEventListener("click", function () { state.signing = false; renderScreen(state.session); });
    go.addEventListener("click", async function () {
      msg.classList.add("hidden");
      var n = name.value.trim();
      if (n.length < 2) { msg.textContent = "Please type your full name."; msg.classList.remove("hidden"); return; }
      if (!agree.checked) { msg.textContent = "Please tick the box to agree to sign electronically."; msg.classList.remove("hidden"); return; }
      if (method === "drawn" && pad.strokes === 0) { msg.textContent = "Draw your signature in the box, or choose Type it."; msg.classList.remove("hidden"); return; }
      go.disabled = true;
      try {
        var body = { name: n, method: method, agree: true };
        if (method === "drawn") body.png = canvas.toDataURL("image/png").split(",")[1];
        await api("/api/sessions/" + state.ref + "/sign?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify(body) });
        await api("/api/sessions/" + state.ref + "/submit?key=" + encodeURIComponent(state.key), { method: "POST", body: "{}" });
        state.signing = false;
        phoneShow("chat");
        poll();
      } catch (e) { msg.textContent = e.message; msg.classList.remove("hidden"); go.disabled = false; }
    });
    panel.appendChild(msg);
    panel.appendChild(el("div", { class: "actions" }, [go, cancel]));
    return panel;
  }
  var CONSENT_TEXT = "I certify that the information in this application is true and complete to the best of my knowledge, I authorize city staff to visit the property for the purpose of reviewing this application, and I agree that my electronic signature has the same effect as my handwritten signature.";
  function setupPad(canvas) {
    pad.canvas = canvas; pad.ctx = canvas.getContext("2d"); pad.strokes = 0; pad.last = null;
    var ctx = pad.ctx;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#9aa4b2"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(24, 140); ctx.lineTo(616, 140); ctx.stroke();
    ctx.strokeStyle = "#1a237e"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; }
    canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); pad.drawing = true; pad.last = pos(e); ctx.beginPath(); ctx.moveTo(pad.last.x, pad.last.y); });
    canvas.addEventListener("pointermove", function (e) { if (!pad.drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); pad.last = p; pad.strokes++; });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { canvas.addEventListener(ev, function () { pad.drawing = false; }); });
  }
  function clearPad() { if (pad.canvas) setupPad(pad.canvas); }


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
      var note = $("demoNote"); if (note) note.textContent = d.note || "";
    } catch (e) { $("demoList").appendChild(el("li", { text: e.message })); }
  });
  $("demoClose").addEventListener("click", function () { $("demoPanel").classList.add("hidden"); });
  // Clicking anything else closes the list.
  document.addEventListener("click", function (e) {
    if ($("demoPanel").classList.contains("hidden") || $("demoPanel").contains(e.target) || $("demoBtn").contains(e.target)) return;
    $("demoPanel").classList.add("hidden");
  });
  async function startDemo(ex) {
    $("demoPanel").classList.add("hidden");
    if (state.ref) resetVisit();
    var sketch = null;
    if (ex.sketch) { try { var b = await (await fetch("/public/sketches/" + ex.sketch)).blob(); sketch = await shrinkImage(b); } catch (e) {} }
    state.demo = { example: ex, turn: 0, paused: false, waiting: false, sketch: sketch };
    $("demoBar").classList.remove("hidden");
    demoNextTurn();
  }
  function resetVisit() {
    clearTimeout(state.progress.timer); state.progress.active = false;
    state.ref = null; state.key = null; state.session = null; state.lastMsgCount = 0; state.lastParcelId = null; state.pinView = null; state.pinDraft = null; document.body.classList.add("no-visit"); phoneShow("chat"); state.channel = "welcome"; state.seen = { map: null, code: null, submissions: null, paperwork: null }; state.fresh = {};
    $("chat").textContent = ""; $("chat").appendChild(greetingItem(new Date().toISOString())); $("refline").textContent = "New visit"; $("statusChip").textContent = "";
    history.replaceState(null, "", "/");
    renderScreen(null); renderRemote(null);
    setPortrait("front_desk", "neutral");
  }
  function demoNextTurn() {
    var d = state.demo; if (!d || d.paused) return;
    var lastMsg = state.session && state.session.messages && state.session.messages[state.session.messages.length - 1];
    var consentTurn = !!(lastMsg && lastMsg.role === "desk" && lastMsg.asks_consent);
    if (consentTurn) {
      $("demoStatus").textContent = d.example.persona + " says yes…";
      var yesBox = $("text"); yesBox.value = ""; var yi = 0; var yesText = "Yes, please.";
      var yiv = setInterval(function () {
        if (!state.demo || state.demo.paused) { clearInterval(yiv); return; }
        yi += 1; yesBox.value = yesText.slice(0, yi);
        if (yi >= yesText.length) { clearInterval(yiv); setTimeout(function () { if (!state.demo) return; d.waiting = true; sendMessage(yesText, null); $("demoStatus").textContent = "Waiting for the desk…"; }, 500); }
      }, 40);
      return;
    }
    if (d.turn >= d.example.turns.length) { $("demoStatus").textContent = "Example finished. If " + characterFor((state.session && state.session.department) || "planning").character + " still has questions, answer them yourself in the box below, edit the paperwork, or press Submit."; return; }
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

  // ---------- the phone app: start screen, menu, install ----------
  var START_TILES = [["🚧", "Report a pothole", "Mark it on a map", "There's a pothole on my street."], ["💧", "Water bill", "Questions and outages", "I have a question about my water bill."], ["🔥", "Burn permit", "Weeds and brush", "I need a burn permit for my weed pile."], ["🏡", "My property", "Zoning, lots, fences", "I have a question about what I can do on my property."], ["🌳", "Reserve a pavilion", "Parks and events", "I'd like to reserve a park pavilion."], ["🚓", "Police request", "Reports, records, events", "I need something from the Police Department. It isn't an emergency."]];
  function renderPhoneStart() {
    var box = $("phoneStart"); box.textContent = "";
    var last = null;
    try { last = JSON.parse(localStorage.getItem("cc_last") || "null"); } catch (e) {}
    if (last && last.ref && last.key) {
      var again = el("button", { type: "button", class: "ps-resume", text: "Continue your last visit (" + last.ref + ")" });
      again.addEventListener("click", function () { openSession(last.ref, last.key); });
      box.appendChild(again);
    }
    box.appendChild(el("div", { class: "ps-title", text: "What do you need?" }));
    var grid = el("div", { class: "ps-grid" });
    START_TILES.forEach(function (t) {
      var b = el("button", { type: "button", class: "ps-tile" }, [el("span", { class: "ps-emoji", text: t[0] }), el("span", { text: t[1] }), el("small", { text: t[2] })]);
      b.addEventListener("click", function () { sendMessage(t[3]); });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    box.appendChild(directory());
    box.appendChild(el("div", { class: "ps-notes" }, [
      el("p", null, [(town && town.wording.exampleCity || "") + " ", el("a", { href: "/about", text: "How this site works" })]),
      el("p", { text: "This is a public demo: others can read what you type, so please use made-up names and details." }),
      el("p", null, ["The desk characters are AI assistants and can make mistakes. Nothing here is legal advice. You must be 18 or older. ", el("a", { href: "/privacy", text: "Privacy and terms" })]),
      el("p", { text: "In an emergency, call 911. This app cannot send help." }),
    ]));
  }
  function setMenu(open) { document.body.classList.toggle("menu-open", open); $("menuBtn").setAttribute("aria-expanded", open ? "true" : "false"); }
  $("menuBtn").addEventListener("click", function (e) { e.stopPropagation(); setMenu(!document.body.classList.contains("menu-open")); });
  document.addEventListener("click", function (e) { if (document.body.classList.contains("menu-open") && !e.target.closest("#menuBtn")) setMenu(false); });
  $("chatTab").addEventListener("click", function () { phoneShow("chat"); if (state.session) renderRemote(state.session); });
  $("newVisitBtn").addEventListener("click", function () { try { localStorage.removeItem("cc_last"); } catch (e) {} location.href = "/"; });
  $("text").addEventListener("input", function () { var t = $("text"); t.style.height = "auto"; t.style.height = Math.min(120, t.scrollHeight + 2) + "px"; });
  var installEvent = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); installEvent = e; $("installBtn").classList.remove("hidden"); });
  $("installBtn").addEventListener("click", async function () {
    if (installEvent) { installEvent.prompt(); await installEvent.userChoice; installEvent = null; $("installBtn").classList.add("hidden"); }
  });
  if (isPhone()) {
    $("text").placeholder = "Message";
    var standalone = window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $("installHelp").classList.remove("hidden");
    if ("serviceWorker" in navigator && window.top === window) navigator.serviceWorker.register("/sw.js").catch(function () {});
  }

  // ---------- phone version preview (desktop): the real phone layout, live, in a phone frame ----------
  function openPreview() {
    var ref = state.ref && state.key ? "?ref=" + encodeURIComponent(state.ref) + "&key=" + encodeURIComponent(state.key) : "";
    var frame = el("iframe", { class: "pp-screen", src: "/" + ref, title: "Phone version preview", allow: "microphone" });
    var phone = el("div", { class: "pp-phone" }, [el("div", { class: "pp-notch" }), frame]);
    var closeBtn = el("button", { type: "button", class: "quiet pp-close", text: "Close preview" });
    var overlay = el("div", { class: "pp-overlay", role: "dialog", "aria-modal": "true", "aria-label": "Phone version preview" }, [
      el("div", { class: "pp-side" }, [
        el("h2", { text: "Phone version preview" }),
        el("p", { text: "This is the real phone app, running live. Tap and type as you would on a phone." }),
        el("p", { class: "small", text: "On a phone, open this same address and add it to your home screen to install it." }),
        closeBtn,
      ]),
      phone,
    ]);
    function fit() { phone.style.transform = "scale(" + Math.min(1, (window.innerHeight - 32) / 890) + ")"; }
    function close() { window.removeEventListener("resize", fit); document.removeEventListener("keydown", onKey); overlay.remove(); if (state.ref) poll(); }
    function onKey(e) { if (e.key === "Escape") close(); }
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    window.addEventListener("resize", fit);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    fit();
  }
  $("previewBtn").addEventListener("click", openPreview);

  // ---------- boot ----------
  (async function boot() {
    try {
      town = await api("/api/town");
      $("townName").textContent = town.name + " · Virtual City Help Desk";
      $("credits").textContent = (town.notes.dataCredits || "") + " · " + (town.notes.fictionalOwners || "") + " · Built during the Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026. Models: " + town.models.desk + ", " + town.models.voice + ", " + town.models.image + ". Office scene and characters generated with " + town.models.image + ".";
      setPortrait("front_desk", "neutral");
      $("menuCredits").textContent = $("credits").textContent;
      if (window.speechSynthesis) speechSynthesis.getVoices();
    } catch (e) { $("formMsg").textContent = "Could not load the town: " + e.message; }
    renderScreen(null); renderRemote(null);
    var params = new URLSearchParams(location.search);
    phoneShow("chat");
    if (!(params.get("ref") && params.get("key"))) { document.body.classList.add("no-visit"); renderPhoneStart(); }
    if (!(params.get("ref") && params.get("key"))) {
      $("chat").appendChild(greetingItem(new Date().toISOString()));
      say("front_desk", greetingText());
    }
    if (params.get("ch") && CHANNEL_LABEL[params.get("ch")]) { state.channel = params.get("ch"); state.manual = true; state.lockOnce = true; phoneShow("screen"); }
    if (params.get("expand") === "1") setExpanded(true);
    if (params.get("sign") === "1") { state.signing = true; state.channel = "paperwork"; state.manual = true; state.lockOnce = true; }
    if (params.get("ref") && params.get("key")) openSession(params.get("ref"), params.get("key"));
  })();
})();
