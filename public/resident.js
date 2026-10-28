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

  var town = null;
  var state = {
    ref: null, key: null, timer: null, lastMsgCount: 0, session: null, typing: null, voiceOn: true, editing: false, demo: null,
    channel: "welcome", manual: false, seen: { map: null, code: null, submissions: null, paperwork: null }, fresh: {}, lastParcelId: null,
    zoom: { welcome: 1, map: 1, code: 1, submissions: 1, paperwork: 1 }, expanded: false, mapView: "block",
  };
  try { var z0 = JSON.parse(localStorage.getItem("cc_zoom") || "{}"); Object.keys(z0).forEach(function (k) { if (state.zoom[k] !== undefined && z0[k] >= 0.5 && z0[k] <= 2) state.zoom[k] = z0[k]; }); } catch (e) {}
  var STEP_LABEL = { sketch: "Reading your drawing", route: "Finding the right desk", understand: "Understanding your request", locate: "Finding your parcel on the county map", research: "Reading the city code", draft: "Preparing your paperwork" };
  var STEP_MODEL = { sketch: "Muse Spark · image", route: "Muse Spark · structured", understand: "Muse Spark · structured", locate: "county GIS (no AI)", research: "Muse Spark · tools", draft: "Muse Spark · structured" };
  var STATUS_LABEL = { open: "Talking", ready: "Paperwork ready to submit", referred: "Referred to another desk", submitted: "Submitted to planning", needs_info: "Staff asked for more", in_review: "Forwarded for decision", answered: "Staff answered", error: "Problem" };
  function statusLabel(s) { return s.changed_since_submit ? "Updated; not resubmitted yet" : (STATUS_LABEL[s.status] || s.status); }
  var CHANNEL_LABEL = { welcome: "Welcome", map: "Parcel Map", code: "Code Review", submissions: "Information You Uploaded", paperwork: "Submission Paperwork" };

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
    $("nametag").appendChild(el("span", { text: d.role || d.name }));
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
      } else {
        await api("/api/sessions/" + encodeURIComponent(state.ref) + "/messages?key=" + encodeURIComponent(state.key), { method: "POST", body: JSON.stringify({ text: text, image: image || undefined }) });
      }
      addPendingResident(text, !!image);
      $("text").value = ""; pendingImage = null; $("attachBtn").textContent = "📎";
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
    if (!m || !m[2]) { $("formMsg").textContent = "A visit code looks like HC-2026-0107-xzUHULux: the reference plus the part after it. It was in the desk's message when you submitted, and in this page's address."; return; }
    openSession(m[1].toUpperCase(), m[2]);
  });
  function openSession(ref, key) {
    state.ref = ref; state.key = key; state.lastMsgCount = 0;
    history.replaceState(null, "", "/?ref=" + encodeURIComponent(ref) + "&key=" + encodeURIComponent(key));
    poll();
  }

  async function poll() {
    clearTimeout(state.timer);
    try {
      var s = await api("/api/sessions/" + encodeURIComponent(state.ref) + "?key=" + encodeURIComponent(state.key));
      if (!state.session || state.session.status !== s.status || (!!state.session.changed_since_submit) !== (!!s.changed_since_submit)) { if (account.signed_in) loadAccount(); }
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
    autoChannel(s);
    renderScreen(s);
    renderRemote(s);
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
    if (m.offers_submit && s && ["open", "ready"].includes(s.status) && s.packet && s.parcel && !s.submitted_at) {
      chip("Sign and submit", function () { openSignPanel(); }, "primary");
      chip("Edit it myself", function () { state.channel = "paperwork"; state.manual = true; state.editing = true; renderScreen(state.session); renderRemote(state.session); });
      chip("I want to change something", function () { $("text").placeholder = "Tell " + characterFor("planning").character + " what to change…"; $("text").focus(); });
    }
    if (m.offers_submit && s && s.submitted_at && s.changed_since_submit) {
      chip("Sign and resubmit", function () { openSignPanel(); }, "primary");
    }
    return any ? row : null;
  }
  function chatItem(m, opts) {
    opts = opts || {};
    var li = el("li", { class: "msg " + m.role + (m.letter ? " has-letter" : "") });
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
    return "Hello, I'm " + d.character + " at the " + (town ? town.name + " " : "") + "Virtual City Help Desk. Tell me what you're trying to do with your property, or ask me anything. I'll find the right desk, pull up your parcel, read the city code, and prepare the paperwork. City staff make every decision.";
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

  // The TV changes channel when new work appears, unless the resident is mid-edit.
  function contentSig(s) {
    return {
      map: s.parcel ? s.parcel.id : null,
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
    if (target && !state.editing && !state.lockOnce) { state.channel = target; state.manual = false; }
    state.lockOnce = false;
    if (state.channel === "welcome" && s.ref) state.channel = s.packet ? "paperwork" : s.research ? "code" : s.parcel ? "map" : (s.has_sketch || s.understanding) ? "submissions" : "welcome";
    order.forEach(function (c) { if (c === state.channel) { state.seen[c] = sig[c]; state.fresh[c] = false; } else if (!sig[c]) state.seen[c] = sig[c]; });
  }
  function hasContent(s, c) {
    if (!s) return false;
    if (c === "map") return !!s.parcel;
    if (c === "code") return !!(s.research && s.department === "planning");
    if (c === "submissions") return !!(s.has_sketch || s.understanding || (s.messages && s.messages.length));
    if (c === "paperwork") return !!s.packet;
    return false;
  }
  function renderRemote(s) {
    Array.prototype.forEach.call(document.querySelectorAll(".rbtn"), function (b) {
      var c = b.dataset.channel;
      b.classList.toggle("active", state.channel === c);
      b.classList.toggle("empty", !hasContent(s, c));
      b.classList.toggle("fresh", !!state.fresh[c] && state.channel !== c);
      b.setAttribute("aria-selected", state.channel === c ? "true" : "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".rbtn"), function (b) {
    b.addEventListener("click", function () {
      state.channel = b.dataset.channel; state.manual = true; state.fresh[state.channel] = false;
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
    if (state.channel === "map") return hasContent(s, "map") ? renderParcel(screen, s) : renderEmpty(screen, "No parcel yet", "Tell " + characterFor(s.department || "front_desk").character + " the property address or tax parcel number and the county map will zoom in here.");
    if (state.channel === "code") return hasContent(s, "code") ? renderResearch(screen, s) : renderEmpty(screen, "No code review yet", "Once the planner has read the city code for your request, the review appears here with every section quoted.");
    if (state.channel === "submissions") return renderSubmissions(screen, s);
    if (state.channel === "paperwork") return hasContent(s, "paperwork") ? renderPaperwork(screen, s) : renderEmpty(screen, "No paperwork yet", "When the planner has what the code asks for, the application is drafted here, in the city's format, for you to review.");
  }
  function renderEmpty(screen, title, text) {
    screen.classList.add("is-empty");
    screen.appendChild(el("div", { class: "empty" }, [el("div", { class: "big", text: title }), el("p", { text: text })]));
  }
  function renderWelcome(screen) {
    var w = el("div", { class: "welcome" }, [
      el("h1", { text: "Welcome to the " + (town ? town.name : "city") + " help desk." }),
      el("p", { text: "Tell me what you're trying to do, in your own words. I'll find the right desk, pull up your parcel on the county map, read the real city code, and prepare the paperwork. City staff make every decision." }),
      el("div", { class: "examples", id: "welcomeExamples" }),
      el("p", { class: "small", text: "This screen shows the work as it happens. Use the remote to look at the parcel map, the code review, what you've given us, and the paperwork." }),
      el("p", { class: "small", id: "demoNote", text: "" }),
    ]);
    screen.appendChild(w);
    if (account.signed_in && account.visits && account.visits.length) {
      var box = el("div", { class: "visits" }, [el("h2", { text: "Your visits" })]);
      account.visits.slice(0, 8).forEach(function (v) { box.appendChild(visitRow(v)); });
      w.insertBefore(box, w.children[2]);
    }
    [["I want to split my lot and sell the back half to my son.", "lot split"], ["Can I keep a rooster at my house?", "rooster"], ["I need a building permit for a mother-in-law suite.", "casita"], ["My bank needs a zoning verification letter.", "bank letter"]].forEach(function (x) {
      var b = el("button", { type: "button", class: "quiet", text: x[0] });
      b.addEventListener("click", function () { $("text").value = x[0]; $("text").focus(); });
      $("welcomeExamples").appendChild(b);
    });
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
    var zi = el("img", { class: "zoomin", src: "/api/map/parcel/" + encodeURIComponent(p.id) + ".svg?m=" + (VIEWS[state.mapView] || 160), alt: "Zoning map around the parcel" });
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
  function renderResearch(screen, s) {
    var r = s.research;
    $("tvModel").textContent = "Muse Spark · " + (r.tool_log ? r.tool_log.length : 0) + " tool calls on the real code";
    var t = tierInfo(r.process_tier);
    screen.appendChild(el("div", { class: "tier" }, [el("div", null, [el("div", { class: "small", text: "Process the code provides" }), el("div", { class: "big", text: t ? t.label : r.process_tier }), el("div", { class: "small", text: t ? "Decided by " + t.decider : "" }), el("div", { style: "margin-top:6px", text: r.process_explanation })])]));
    if (r.required_applications && r.required_applications.length) {
      screen.appendChild(el("h3", { text: "You would file" }));
      screen.appendChild(el("ul", null, r.required_applications.map(function (id) { var a = town.applicationTypes[id] || {}; return el("li", { text: (a.name || id) + " (section " + (a.section || "?") + ")" }); })));
    }
    if (r.path_if_blocked) screen.appendChild(el("div", { class: "notice warn" }, [el("strong", { text: "Where the code blocks something, it also provides a path: " }), r.path_if_blocked]));
    screen.appendChild(el("h3", { text: "Use under the zone's table" }));
    screen.appendChild(el("div", null, [chip(r.use_status), " ", r.use_table_row ? el("span", { class: "small", text: r.use_table_row }) : null]));
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
  function formField(label, value, opts) {
    opts = opts || {};
    var box = el("div", { class: "ff" + (opts.wide ? " wide" : "") }, [el("label", null, [el("span", { text: label }), opts.src ? el("span", { class: "src", text: "from " + opts.src.replace("_", " ") }) : null])]);
    if (opts.input) box.appendChild(opts.input);
    else box.appendChild(el("div", { class: "fv" + (value ? "" : " blank"), text: value || "" }));
    return box;
  }
  function checkbox(label, checked) {
    return el("div", { class: "cb" }, [el("span", { class: "box" + (checked ? " on" : ""), text: checked ? "✓" : "" }), el("span", { text: label })]);
  }
  function renderPaperwork(screen, s) {
    var p = s.packet;
    var office = (town && town.office) || {};
    $("tvModel").textContent = "Muse Spark · drafted from your words only";
    var pt = (town && town.packetTypes && town.packetTypes[p.packet_type]) || "Packet";
    screen.appendChild(el("p", { class: "lead", text: pt + ": " + (p.title || "") + ". " + (p.one_line_summary || "") }));
    if (p.process_summary) screen.appendChild(el("div", { class: "notice", text: p.process_summary }));
    var pages = el("div", { class: "pages" });
    (p.documents || []).forEach(function (d, di) {
      var page = el("article", { class: "form-page" });
      // Letterhead
      page.appendChild(el("div", { class: "letterhead" }, [
        el("div", { class: "seal", text: (town && town.refPrefix ? town.refPrefix : "HC").slice(0, 3).toUpperCase() }),
        el("div", null, [el("div", { class: "city", text: (office.cityLine || (town && town.name) || "City").toUpperCase() }), el("div", { class: "dept", text: office.department || "Planning & Zoning Department" }), el("div", { class: "addr", text: [office.addressLine, office.phone].filter(Boolean).join(" · ") })]),
        el("div", { class: "appno" }, [el("div", { class: "small", text: "Application No." }), el("div", { class: "num", text: s.ref }), el("div", { class: "small", text: "Page " + (di + 1) + " of " + p.documents.length })]),
      ]));
      page.appendChild(el("div", { class: "form-title" }, [el("h2", { text: d.name }), el("div", { class: "small", text: d.section ? "Filed under " + (town ? town.name : "city") + " Code section " + d.section : "" })]));
      // Section 1: applicant and property
      var u = s.understanding || {};
      var ap = u.applicant || {};
      var grid1 = el("div", { class: "fgrid" }, [
        formField("Applicant name", ap.name || firstField(d, /applicant|name/i)),
        formField("Phone", ap.phone || firstField(d, /phone/i)),
        formField("Email", ap.email || firstField(d, /e-?mail/i)),
        formField("Date prepared", fmtDate(s.submitted_at || s.updated_at)),
      ]);
      page.appendChild(el("h3", { class: "fsec", text: "1. Applicant" }));
      page.appendChild(grid1);
      var pr = s.parcel || {};
      page.appendChild(el("h3", { class: "fsec", text: "2. Property" }));
      page.appendChild(el("div", { class: "fgrid" }, [
        formField("Site address", pr.address || (u.location && u.location.address_text) || ""),
        formField("Tax parcel number", pr.id || (u.location && u.location.parcel_id_text) || ""),
        formField("Zoning district", pr.zone ? pr.zone + (pr.zoneName ? " · " + pr.zoneName : "") : ""),
        formField("Lot size", pr.areaAcres ? pr.areaAcres + " acres" + (pr.areaSqft ? " (" + pr.areaSqft.toLocaleString() + " sq ft)" : "") : ""),
        formField("Owner of record", s.owner ? s.owner.name + " (fictional demo name)" : ""),
        formField("Applicant is the owner", u.location && u.location.is_own_property === true ? "Yes" : u.location && u.location.is_own_property === false ? "No" : ""),
      ]));
      // Section 3: request type
      page.appendChild(el("h3", { class: "fsec", text: "3. Type of request" }));
      var types = el("div", { class: "cbgrid" });
      var at = (town && town.applicationTypes) || {};
      var checkedAny = false;
      Object.keys(at).forEach(function (id) { var on = id === d.doc_type; if (on) checkedAny = true; types.appendChild(checkbox(at[id].name, on)); });
      ["zoning_verification_request", "complaint_report", "referral"].forEach(function (id) { var on = id === d.doc_type; if (on) checkedAny = true; types.appendChild(checkbox((town && town.packetTypes && town.packetTypes[id]) || id.replace(/_/g, " "), on)); });
      if (!checkedAny) types.appendChild(checkbox("Other: " + d.name, true));
      page.appendChild(types);
      // Section 4: application details (the code's own fields)
      page.appendChild(el("h3", { class: "fsec", text: "4. Application details" }));
      var grid4 = el("div", { class: "fgrid" });
      (d.fields || []).forEach(function (f, fi) {
        var wide = (f.value || "").length > 60 || /description|statement|reason|explain|legal/i.test(f.label);
        if (state.editing) {
          var inp = el("input", { class: "field", type: "text", value: f.value || "", "data-doc": String(di), "data-field": String(fi) });
          grid4.appendChild(formField(f.label, "", { input: inp, wide: wide }));
        } else {
          grid4.appendChild(formField(f.label, f.value, { wide: wide, src: f.source && f.source !== "blank" ? f.source : null }));
        }
      });
      page.appendChild(grid4);
      // Section 5: statement
      page.appendChild(el("h3", { class: "fsec", text: "5. Project description and statement" }));
      if (state.editing) { var ta = el("textarea", { "data-doc": String(di), "data-narrative": "1" }); ta.value = d.narrative || ""; page.appendChild(ta); }
      else page.appendChild(el("div", { class: "narrative", text: d.narrative || "" }));
      // Section 6: code sections
      var basis = (d.code_basis || []).filter(function (c) { return c.quote || c.section; });
      if (basis.length) {
        page.appendChild(el("h3", { class: "fsec", text: "6. Code sections this application is made under" }));
        basis.forEach(function (c) {
          page.appendChild(el("div", { class: "quote" }, [c.quote ? el("span", { text: "“" + c.quote + "”" }) : null, el("span", { class: "cite" }, [el("a", { href: c.url || "#", target: "_blank", rel: "noopener", text: "Section " + c.section }), c.quote ? " · " + (c.quote_verified ? "quote verified against the code text" : "unverified") : ""])]));
        });
      }
      // Section 7: attachments
      page.appendChild(el("h3", { class: "fsec", text: (basis.length ? "7" : "6") + ". Attachments" }));
      page.appendChild(el("div", { class: "cbgrid" }, [
        checkbox("Site sketch or drawing", !!s.has_sketch),
        checkbox("Zoning map excerpt showing the parcel", !!s.parcel),
        checkbox("Record of the help desk conversation", true),
        checkbox("Code review with cited sections", !!s.research),
      ]));
      // Certification and office use
      page.appendChild(el("div", { class: "certify" }, [
        el("p", { text: "I certify that the information in this application is true and complete to the best of my knowledge, and I authorize city staff to visit the property for the purpose of reviewing this application." }),
        signatureLines(s),
      ]));
      var tier = s.research ? tierInfo(s.research.process_tier) : null;
      page.appendChild(el("div", { class: "office-use" }, [
        el("div", { class: "ou-title", text: "For office use only" }),
        el("div", { class: "fgrid" }, [formField("Received by", ""), formField("Date received", s.submitted_at ? fmtDate(s.submitted_at) : ""), formField("Fee paid", ""), formField("Application complete", ""), formField("Decision body", tier ? tier.decider : ""), formField("Staff reference", s.ref)]),
      ]));
      page.appendChild(el("p", { class: "small foot", text: office.formFooter || "" }));
      pages.appendChild(page);
    });
    screen.appendChild(pages);
    var actions = el("div", { class: "actions" });
    var hasDocs = s.parcel && p.documents && p.documents.length && p.packet_type !== "referral";
    var canSubmit = ["open", "ready"].includes(s.status) && hasDocs && !s.submitted_at;
    var canResubmit = !!s.submitted_at && s.changed_since_submit && hasDocs;
    if (s.submitted_at && !s.changed_since_submit && !state.editing) actions.appendChild(el("span", { class: "small", text: "Submitted " + fmt(s.submitted_at) + (s.resubmit_count ? " (update " + s.resubmit_count + ")" : "") + ". You can keep talking or edit; any change can be resubmitted." }));
    if ((canSubmit || canResubmit) && !state.editing && !state.signing) {
      var submit = el("button", { type: "button", text: canResubmit ? "Sign and resubmit" : "Sign and submit to the planning department" });
      submit.addEventListener("click", function () { openSignPanel(); });
      actions.appendChild(submit);
    }
    if (state.signing && !state.editing) screen.insertBefore(signPanel(s), screen.firstChild);
    if (hasDocs && !state.editing && !s.busy) {
      var edit = el("button", { type: "button", class: "secondary", text: "Edit it myself" });
      edit.addEventListener("click", function () { state.editing = true; renderScreen(state.session); });
      actions.appendChild(edit);
      actions.appendChild(el("span", { class: "small", text: "Or just tell " + characterFor("planning").character + " what to change." }));
    }
    if (canResubmit && !state.editing && !state.signing) screen.insertBefore(el("div", { class: "notice warn", text: "You have made changes since you submitted. Sign the updated application and resubmit to send it to the planning office." }), screen.firstChild);
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
    print.addEventListener("click", function () { window.print(); });
    actions.appendChild(print);
    screen.appendChild(actions);
    if (s.submitted_at && !s.changed_since_submit) screen.appendChild(el("p", { class: "small", text: "Staff will write back in this conversation." }));
    if (p.questions && p.questions.length && !s.submitted_at) screen.appendChild(el("div", { class: "notice warn" }, [el("b", { text: "Still needed: " }), p.questions.join(" ")]));
  }
  function signatureLines(s) {
    var sig = s.signature;
    var current = !!s.signature_current;
    var appl = el("div", { class: "sig" + (sig ? " signed" : "") });
    var date = el("div", { class: "sig short" + (sig ? " signed" : "") });
    if (sig) {
      var img = el("img", { class: "sigimg", src: "/api/sessions/" + encodeURIComponent(state.ref) + "/signature?key=" + encodeURIComponent(state.key) + "&t=" + encodeURIComponent(sig.signed_at), alt: "Signature of " + sig.name });
      appl.appendChild(img);
      appl.appendChild(el("span", { text: "Applicant signature · " + sig.name + " (electronic, " + sig.method + ")" + (current ? "" : " · signed an earlier version") }));
      date.appendChild(el("div", { class: "sigdate", text: fmtDate(sig.signed_at) }));
      date.appendChild(el("span", { text: "Date" }));
    } else {
      appl.appendChild(el("span", { text: "Applicant signature" }));
      date.appendChild(el("span", { text: "Date" }));
    }
    return el("div", { class: "siglines" }, [appl, date, el("div", { class: "sig" }, [el("span", { text: "Owner signature (if different)" })]), el("div", { class: "sig short" }, [el("span", { text: "Date" })])]);
  }

  // ---------- signing panel (draw or type, then submit) ----------
  var pad = { canvas: null, ctx: null, drawing: false, strokes: 0, last: null };
  function openSignPanel() {
    state.signing = true; state.channel = "paperwork"; state.manual = true;
    renderScreen(state.session); renderRemote(state.session);
    var sp = document.querySelector(".signpanel"); if (sp) sp.scrollIntoView({ block: "start" });
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

  function firstField(d, re) {
    var f = (d.fields || []).find(function (x) { return re.test(x.label) && x.value; });
    return f ? f.value : "";
  }

  // ---------- resident account ----------
  var account = { signed_in: false, visits: [] };
  function visitRow(v) {
    var row = el("div", { class: "v" }, [
      el("div", null, [el("div", { class: "vt", text: v.title || v.preview || v.ref }), el("div", { class: "small", text: v.ref + " · " + fmt(v.updated_at) })]),
      chip(v.changed_since_submit ? "unclear" : v.status, v.changed_since_submit ? "Updated; not resubmitted" : (STATUS_LABEL[v.status] || v.status)),
    ]);
    row.addEventListener("click", function () { $("accountPanel").classList.add("hidden"); if (state.ref !== v.ref) { resetVisit(); openSession(v.ref, v.view_key); } });
    return row;
  }
  async function loadAccount() {
    try { account = await api("/api/resident/me"); } catch (e) { account = { signed_in: false, visits: [] }; }
    $("accountBtn").textContent = account.signed_in ? "My visits" : "Sign in";
    $("accountOut").classList.toggle("hidden", !account.signed_in);
    $("accountIn").classList.toggle("hidden", !!account.signed_in);
    if (account.signed_in) {
      $("accountWho").textContent = (account.name ? account.name + " · " : "") + account.email;
      var ul = $("visitList"); ul.textContent = "";
      (account.visits || []).forEach(function (v) { ul.appendChild(el("li", null, [visitRow(v)])); });
      if (!(account.visits || []).length) ul.appendChild(el("li", { class: "small", text: "No visits yet. Start one below and it will be saved to your account." }));
    }
    if (state.channel === "welcome") renderScreen(null);
  }
  function accountMsg(text) { var m = $("accountMsg"); m.textContent = text || ""; m.classList.toggle("hidden", !text); }
  $("accountBtn").addEventListener("click", function () { $("demoPanel").classList.add("hidden"); $("accountPanel").classList.toggle("hidden"); accountMsg(""); });
  ["accountClose", "accountClose2", "accountClose3"].forEach(function (id) { $(id).addEventListener("click", function () { $("accountPanel").classList.add("hidden"); }); });
  $("tabSignIn").addEventListener("click", function () { $("signInForm").classList.remove("hidden"); $("signUpForm").classList.add("hidden"); $("tabSignIn").classList.add("active"); $("tabSignUp").classList.remove("active"); accountMsg(""); });
  $("tabSignUp").addEventListener("click", function () { $("signUpForm").classList.remove("hidden"); $("signInForm").classList.add("hidden"); $("tabSignUp").classList.add("active"); $("tabSignIn").classList.remove("active"); accountMsg(""); });
  $("signInForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    try { await api("/api/resident/login", { method: "POST", body: JSON.stringify({ email: $("siEmail").value, password: $("siPass").value }) }); $("siPass").value = ""; await loadAccount(); if (state.ref) poll(); }
    catch (e) { accountMsg(e.message); }
  });
  $("signUpForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    if ($("suPass").value !== $("suPass2").value) return accountMsg("The two passwords do not match.");
    try { await api("/api/resident/signup", { method: "POST", body: JSON.stringify({ name: $("suName").value, email: $("suEmail").value, password: $("suPass").value, password2: $("suPass2").value }) }); $("suPass").value = ""; $("suPass2").value = ""; await loadAccount(); if (state.ref) poll(); }
    catch (e) { accountMsg(e.message); }
  });
  $("signOut").addEventListener("click", async function () { try { await api("/api/resident/logout", { method: "POST", body: "{}" }); } catch (e) {} $("accountPanel").classList.add("hidden"); await loadAccount(); });

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
    state.ref = null; state.key = null; state.session = null; state.lastMsgCount = 0; state.lastParcelId = null; state.channel = "welcome"; state.seen = { map: null, code: null, submissions: null, paperwork: null }; state.fresh = {};
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
    if (d.turn >= d.example.turns.length) { $("demoStatus").textContent = "Example finished. If " + characterFor("planning").character + " still has questions, answer them yourself in the box below, edit the paperwork, or press Submit."; return; }
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
      $("credits").textContent = (town.notes.dataCredits || "") + " · " + (town.notes.fictionalOwners || "") + " · Built during the Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026. Models: " + town.models.desk + ", " + town.models.voice + ", " + town.models.image + ". Office scene and characters generated with " + town.models.image + ".";
      setPortrait("front_desk", "neutral");
      if (window.speechSynthesis) speechSynthesis.getVoices();
    } catch (e) { $("formMsg").textContent = "Could not load the town: " + e.message; }
    renderScreen(null); renderRemote(null);
    await loadAccount();
    var params = new URLSearchParams(location.search);
    if (!(params.get("ref") && params.get("key"))) {
      $("chat").appendChild(greetingItem(new Date().toISOString()));
      say("front_desk", greetingText());
    }
    if (params.get("ch") && CHANNEL_LABEL[params.get("ch")]) { state.channel = params.get("ch"); state.manual = true; state.lockOnce = true; }
    if (params.get("expand") === "1") setExpanded(true);
    if (params.get("sign") === "1") { state.signing = true; state.channel = "paperwork"; state.manual = true; state.lockOnce = true; }
    if (params.get("ref") && params.get("key")) openSession(params.get("ref"), params.get("key"));
  })();
})();
