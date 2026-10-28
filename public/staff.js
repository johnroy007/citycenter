// Reviewer workspace. All server data is rendered with textContent; no innerHTML.
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
  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { var err = new Error(data.error || ("Request failed (" + res.status + ")")); err.status = res.status; throw err; }
    return data;
  }
  var STATUS_LABEL = { open: "Talking", ready: "Ready (not submitted)", referred: "Referred", submitted: "Submitted", needs_info: "Needs info", in_review: "Forwarded", answered: "Answered", error: "Error" };
  function drawingWithOutline(src, reading) {
    var wrap = el("div", { style: "position:relative;display:inline-block;max-width:100%" });
    wrap.appendChild(el("img", { src: src, alt: "Resident's drawing", style: "max-width:100%;display:block;border-radius:10px;border:1px solid var(--line)" }));
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
  var STATE_LABEL = { not_started: "Not started", met: "Met", not_met: "Not met", cannot_verify: "Cannot verify", not_applicable: "N/A", staff_note: "Note" };
  var town = null, current = null, activeId = null;

  // ---------- session ----------
  async function checkSession() {
    try { await api("/api/staff/me"); showQueue(); }
    catch (e) { $("login").classList.remove("hidden"); if (e.status === 503) { $("loginMsg").textContent = e.message; $("loginForm").querySelector("button").disabled = true; } }
  }
  $("loginForm").addEventListener("submit", async function (ev) {
    ev.preventDefault(); $("loginMsg").textContent = "";
    try { await api("/api/staff/login", { method: "POST", body: JSON.stringify({ passcode: $("passcode").value }) }); $("passcode").value = ""; showQueue(); }
    catch (e) { $("loginMsg").textContent = e.message; }
  });
  $("logout").addEventListener("click", async function () { await api("/api/staff/logout", { method: "POST" }); location.reload(); });
  $("backBtn").addEventListener("click", showQueue);
  function showQueue() {
    $("login").classList.add("hidden"); $("workspace").classList.add("hidden"); $("letterPanel").classList.add("hidden");
    $("queueView").classList.remove("hidden"); $("logout").classList.remove("hidden"); $("backBtn").classList.add("hidden");
    history.replaceState(null, "", "/staff");
    loadQueue();
  }
  $("refresh").addEventListener("click", loadQueue);
  async function loadQueue() {
    try {
      var data = await api("/api/staff/queue");
      var tb = $("queue"); tb.textContent = "";
      var order = { submitted: 0, needs_info: 1, in_review: 2, answered: 3, ready: 4, open: 5, referred: 6, error: 7 };
      data.sessions.sort(function (a, b) { return (order[a.status] - order[b.status]) || (a.created_at < b.created_at ? 1 : -1); });
      data.sessions.forEach(function (s) {
        var tr = el("tr", null, [
          el("td", null, [el("div", null, [el("strong", { text: s.ref })]), el("div", { class: "small", text: fmt(s.created_at) + (s.has_sketch ? " · drawing" : "") + (s.demo_id ? " · example" : "") })]),
          el("td", null, [el("div", { text: s.title || s.preview }), el("div", { class: "small", text: (s.packet_type || "").replace(/_/g, " ") })]),
          el("td", null, [chip(s.status, STATUS_LABEL[s.status] || s.status)]),
        ]);
        tr.addEventListener("click", function () { openSession(s.ref); });
        tb.appendChild(tr);
      });
      if (!data.sessions.length) tb.appendChild(el("tr", null, [el("td", { text: "Nothing in the queue yet.", colspan: "3" })]));
      $("usage").textContent = "Model calls today: " + data.usage_today.n + " of " + data.daily_cap + " (" + data.usage_today.p + " in / " + data.usage_today.c + " out tokens)";
    } catch (e) { if (e.status === 401) return checkSession(); $("usage").textContent = e.message; }
  }

  // ---------- workspace ----------
  async function openSession(ref, keepActive) {
    try {
      current = await api("/api/staff/sessions/" + encodeURIComponent(ref));
      $("queueView").classList.add("hidden"); $("workspace").classList.remove("hidden"); $("backBtn").classList.remove("hidden");
      history.replaceState(null, "", "/staff?ref=" + encodeURIComponent(ref));
      if (!keepActive) activeId = null;
      renderWorkspace();
      if (current.busy) setTimeout(function () { if (current && current.ref === ref) openSession(ref, true); }, 2500);
      else if (!current.review && current.packet && ["submitted", "needs_info", "in_review", "ready"].includes(current.status)) buildConsiderations();
    } catch (e) { alert(e.message); }
  }
  function considerations() { return current && current.review ? current.review.considerations : []; }
  function stateOf(id) { return (current && current.review && current.review.states && current.review.states[id]) || { state: "not_started", note: "" }; }

  function renderWorkspace() {
    var s = current;
    $("wsRef").textContent = s.ref;
    $("wsStatus").textContent = ""; $("wsStatus").appendChild(chip(s.status, STATUS_LABEL[s.status] || s.status));
    $("wsTitle").textContent = (s.packet ? s.packet.title : (s.understanding ? s.understanding.summary : "")) + " · resident link: " + location.origin + s.resident_link;
    $("buildBtn").textContent = s.review ? "Rebuild considerations" : "Build considerations";
    renderRail(); renderDoc(); renderEvidence(); renderStrip();
  }

  function renderRail() {
    var rail = $("rail"); rail.textContent = "";
    var cons = considerations();
    if (!cons.length) {
      rail.appendChild(el("div", { class: "small", text: current.busy ? "The resident-side desk is still working on this conversation…" : current.packet ? "No considerations yet. Click Build considerations." : "This conversation has no packet yet." }));
      return;
    }
    var done = cons.filter(function (c) { return stateOf(c.id).state !== "not_started"; }).length;
    rail.appendChild(el("div", { class: "progress", text: done + " of " + cons.length + " considered" }));
    cons.forEach(function (c, i) {
      var st = stateOf(c.id).state;
      var item = el("div", { class: "item " + st + (activeId === c.id ? " active" : "") }, [el("div", { class: "n", text: (i + 1) + " · " + (c.kind || "") + (c.added_by === "staff" ? " · yours" : "") }), el("div", { text: c.title }), el("div", { class: "n", text: STATE_LABEL[st] })]);
      item.addEventListener("click", function () { activeId = c.id; renderWorkspace(); });
      rail.appendChild(item);
    });
    var add = el("div", { class: "item", text: "+ Add a consideration" });
    add.addEventListener("click", async function () {
      var title = prompt("Consideration title (something you check that the agent did not list):");
      if (!title) return;
      var how = prompt("How do you normally verify it? (optional)") || "";
      try { await api("/api/staff/sessions/" + current.ref + "/consideration", { method: "POST", body: JSON.stringify({ add: { title: title, how_to_verify: how } }) }); openSession(current.ref, true); } catch (e) { alert(e.message); }
    });
    rail.appendChild(add);
  }

  function active() { return considerations().find(function (c) { return c.id === activeId; }) || null; }
  function sectionMatches(c, text) {
    if (!c) return false;
    var ids = (c.sections || []).concat(c.quote_section ? [c.quote_section] : []);
    return ids.some(function (id) { return id && text && text.indexOf(id) > -1; });
  }

  function renderDoc() {
    var pane = $("docPane"); pane.textContent = "";
    var s = current, c = active();
    pane.appendChild(el("h2", { text: s.packet ? s.packet.title : "No packet yet" }));
    if (s.packet) pane.appendChild(el("p", { class: "small", text: (s.packet.packet_type || "").replace(/_/g, " ") + " · " + (s.packet.one_line_summary || "") }));
    if (s.parcel) {
      var hl = c && /parcel|zone|department/i.test((c.id || "") + (c.title || "") + (c.kind || ""));
      var pz = el("div", { class: "docsec" + (hl ? " hl" : "") }, [el("h3", { text: "Parcel" }), el("div", { text: (s.parcel.address || "") + " · " + (s.parcel.id || "") + " · zone " + (s.parcel.zone || "?") + (s.parcel.zoneName ? " (" + s.parcel.zoneName + ")" : "") + " · " + (s.parcel.areaAcres || "?") + " acres" + (s.parcel.straddlesZones ? " · touches " + s.parcel.zonesTouched.join(", ") : "") + (s.parcel.assumed ? " · ASSUMED among several parcels at this address" : "") }), el("div", { class: "small", text: "Owner of record: " + (s.owner ? s.owner.name : "?") + " (fictional demo name)" })]);
      pane.appendChild(pz);
    }
    (s.packet ? s.packet.documents : []).forEach(function (d) {
      var hlDoc = c && (sectionMatches(c, d.section) || (c.kind === "completeness"));
      var box = el("div", { class: "docsec" + (hlDoc ? " hl" : "") }, [el("h3", { text: d.name + (d.section ? " · section " + d.section : "") })]);
      var tb = el("tbody");
      (d.fields || []).forEach(function (f) {
        var rowHl = c && f.label && c.title && f.label.toLowerCase().split(/\W+/).some(function (w) { return w.length > 3 && c.title.toLowerCase().indexOf(w) > -1; });
        tb.appendChild(el("tr", { class: rowHl ? "hl" : "", style: rowHl ? "background:#fff8d6" : "" }, [el("td", { text: f.label }), el("td", { class: "val" }, [f.value ? document.createTextNode(f.value) : el("span", { class: "blank", text: "[blank]" })])]));
      });
      box.appendChild(el("table", null, [tb]));
      box.appendChild(el("div", { class: "narrative", text: d.narrative || "" }));
      pane.appendChild(box);
    });
    if (s.has_sketch) {
      var hlS = c && /drawing|plot plan|site plan|sketch|dimension|setback|frontage|width/i.test((c.title || "") + (c.how_to_verify || ""));
      var skStep = (s.steps || []).find(function (x) { return x.name === "sketch" && x.status === "done"; });
      pane.appendChild(el("div", { class: "docsec" + (hlS ? " hl" : "") }, [el("h3", { text: "Resident's drawing (Muse Spark reading, SAM 3.1 outlines)" }), drawingWithOutline("/api/sessions/" + encodeURIComponent(s.ref) + "/sketch", skStep ? skStep.output : null)]));
    }
    var tl = el("ul", { class: "transcript" });
    (s.messages || []).forEach(function (m) { tl.appendChild(el("li", { class: m.role }, [el("strong", { text: (m.role === "resident" ? "Resident" : (m.character || "Desk")) + ": " }), m.text])); });
    pane.appendChild(el("div", { class: "docsec" }, [el("h3", { text: "Conversation" }), tl]));
  }

  function renderEvidence() {
    var pane = $("evidencePane"); pane.textContent = "";
    var s = current, c = active();
    if (!c) {
      pane.appendChild(el("h2", { text: "Evidence" }));
      if (s.review) pane.appendChild(el("div", { class: "notice", text: s.review.process_summary || "" }));
      if (s.research) {
        pane.appendChild(el("h3", { text: "Resident-side research" }));
        pane.appendChild(el("div", null, [chip(s.research.use_status), " tier ", chip(s.research.process_tier), " apps: " + (s.research.required_applications.join(", ") || "none")]));
        pane.appendChild(el("p", { class: "small", text: s.research.process_explanation }));
      }
      if (s.review && s.review.second_read) renderSecondRead(pane, s.review.second_read);
      if (s.parcel) pane.appendChild(el("img", { src: "/api/map/parcel/" + encodeURIComponent(s.parcel.id) + ".svg", alt: "Zoning map around the parcel", style: "width:100%;border-radius:10px;border:1px solid var(--line);margin-top:10px" }));
      pane.appendChild(el("p", { class: "small", text: "Select a consideration in the rail to see its evidence." }));
      return;
    }
    pane.appendChild(el("h2", { text: c.title }));
    pane.appendChild(el("div", { class: "row" }, [chip(c.kind || "consideration"), chip(c.document_reading, "reading: " + String(c.document_reading).replace(/_/g, " ")), c.added_by === "staff" ? chip("staff_note", "added by staff") : modelChip((s.review && s.review.model) || "Muse Spark")]));
    pane.appendChild(el("h3", { text: "Requirement" }));
    pane.appendChild(el("p", { text: c.requirement }));
    if (c.quote) pane.appendChild(el("div", { class: "quote" }, [el("span", { text: "“" + c.quote + "”" }), el("span", { class: "cite", text: "Section " + (c.quote_section || (c.sections || [])[0] || "") + " · quote verified against the stored code text" })]));
    else if (c.sections && c.sections.length) pane.appendChild(el("p", { class: "small", text: "No verified quote; open the section text below." }));
    (c.section_links || []).forEach(function (l) {
      var det = el("details", null, [el("summary", { text: "Section " + l.section + " " + l.title })]);
      det.addEventListener("toggle", async function () {
        if (!det.open || det.dataset.loaded) return;
        det.dataset.loaded = "1";
        try { var sec = await api("/api/code/sections/" + encodeURIComponent(l.section)); det.appendChild(el("div", { class: "narrative", text: sec.text })); det.appendChild(el("a", { href: sec.url, target: "_blank", rel: "noopener", class: "small", text: "Open on the city's code site" })); }
        catch (e) { det.appendChild(el("div", { class: "small", text: e.message })); }
      });
      pane.appendChild(det);
    });
    pane.appendChild(el("h3", { text: "What the packet says" }));
    pane.appendChild(el("p", { text: c.evidence_in_packet || "Nothing in the packet" }));
    if (c.note) pane.appendChild(el("p", { class: "small", text: c.note }));
    pane.appendChild(el("h3", { text: "How staff normally verify this" }));
    pane.appendChild(el("p", { text: c.how_to_verify || "" }));
    // Related facts: standards, parcel, math, drawing
    if (s.research && s.research.standards && s.research.standards.length) {
      var rel = s.research.standards.filter(function (x) { return sectionMatches(c, x.section) || (c.title && x.requirement && x.requirement.toLowerCase().indexOf(c.title.toLowerCase().split(" ")[0]) > -1); });
      if (rel.length) {
        pane.appendChild(el("h3", { text: "Numbers compared" }));
        var tb = el("tbody");
        rel.forEach(function (x) { tb.appendChild(el("tr", null, [el("td", { text: x.requirement }), el("td", { text: x.required_value }), el("td", { text: x.proposed_value }), el("td", null, [chip(x.status)])])); });
        pane.appendChild(el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Rule" }), el("th", { text: "Code" }), el("th", { text: "Packet" }), el("th", { text: "" })])]), tb]));
      }
    }
    if (s.parcel && /parcel|zone|lot|area|width|setback|frontage/i.test(c.title + c.kind)) {
      pane.appendChild(el("h3", { text: "Parcel map" }));
      pane.appendChild(el("img", { src: "/api/map/parcel/" + encodeURIComponent(s.parcel.id) + ".svg", alt: "Zoning map around the parcel", style: "width:100%;border-radius:10px;border:1px solid var(--line)" }));
      pane.appendChild(el("p", { class: "small", text: s.parcel.address + " · " + s.parcel.id + " · " + s.parcel.zone + " · " + s.parcel.areaAcres + " acres (" + (s.parcel.areaSqft || 0).toLocaleString() + " sq ft) · tax roll " + (s.parcel.taxRollAcres || "?") + " acres" }));
    }
    var sketch = (s.steps || []).find(function (x) { return x.name === "sketch" && x.status === "done"; });
    if (sketch && sketch.output && /drawing|plot plan|site plan|dimension|setback|frontage|width|structure/i.test(c.title + " " + c.how_to_verify)) {
      pane.appendChild(el("h3", { text: "Drawing reading (Muse Spark, image)" }));
      var o = sketch.output;
      pane.appendChild(el("p", { class: "small", text: o.drawing_type.replace(/_/g, " ") + ", " + o.readability + (o.building_code_site_plan_note ? ". " + o.building_code_site_plan_note : "") }));
      if (o.dimensions && o.dimensions.length) pane.appendChild(el("ul", null, o.dimensions.map(function (d) { return el("li", { text: d.what + ": " + d.value_text }); })));
    }
    var st = stateOf(c.id);
    if (st.note) pane.appendChild(el("div", { class: "notice", text: "Your note: " + st.note }));
  }
  function renderSecondRead(pane, sr) {
    pane.appendChild(el("h3", { text: "Second read (" + (sr.model || "") + ")" }));
    pane.appendChild(el("p", { class: "small", text: sr.summary }));
    if (sr.missed.length) pane.appendChild(el("ul", null, sr.missed.map(function (m) { return el("li", { text: "Missed: " + m.title + " (" + m.section + "): " + m.why }); })));
    if (sr.overstated.length) pane.appendChild(el("ul", null, sr.overstated.map(function (m) { return el("li", { text: "Check: " + m.id + ": " + m.problem }); })));
  }

  function renderStrip() {
    var c = active();
    var marks = $("marks"); marks.textContent = "";
    if (!c) { $("agentText").textContent = current.review ? "Pick a consideration above. I show the requirement, the exact quote, what the packet says, and how staff usually verify it." : "Build the considerations and I will lay out what to check and where it is written."; return; }
    var text = "The code requires: " + c.requirement + " The packet says: " + (c.evidence_in_packet || "nothing") + ". To settle it, staff normally " + (c.how_to_verify || "check the documents") + " Reading of the documents: " + String(c.document_reading).replace(/_/g, " ") + ".";
    $("agentText").textContent = text;
    ["met", "not_met", "cannot_verify", "not_applicable", "staff_note"].forEach(function (st) {
      var b = el("button", { type: "button", class: stateOf(c.id).state === st ? "" : "secondary", text: STATE_LABEL[st] });
      b.addEventListener("click", async function () {
        var note = st === "staff_note" || st === "not_met" ? (prompt("Note (your words):", stateOf(c.id).note || "") || "") : stateOf(c.id).note || "";
        try { var r = await api("/api/staff/sessions/" + current.ref + "/consideration", { method: "POST", body: JSON.stringify({ id: c.id, state: st, note: note }) }); current.review.states = r.states; renderWorkspace(); }
        catch (e) { alert(e.message); }
      });
      marks.appendChild(b);
    });
  }

  $("askForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var q = $("askInput").value.trim(); if (!q) return;
    $("askInput").value = ""; $("agentText").textContent = "Reading the code… (Muse Spark with tools)";
    try {
      var r = await api("/api/staff/sessions/" + current.ref + "/ask", { method: "POST", body: JSON.stringify({ question: q, consideration_id: activeId }) });
      var t = $("agentText"); t.textContent = "";
      t.appendChild(document.createTextNode(r.answer + " "));
      (r.citations || []).forEach(function (c) { t.appendChild(el("a", { href: c.url || "#", target: "_blank", rel: "noopener", text: "[" + c.section + (c.quote_verified ? " ✓" : "") + "] " })); });
      t.appendChild(el("span", { class: "small", text: " (" + r.tool_calls + " tool calls)" }));
    } catch (e) { $("agentText").textContent = e.message; }
  });

  $("buildBtn").addEventListener("click", buildConsiderations);
  async function buildConsiderations() {
    $("wsMsg").textContent = "Building considerations with Muse Spark and the code tools… about a minute."; $("buildBtn").disabled = true;
    try { await api("/api/staff/sessions/" + current.ref + "/considerations", { method: "POST", body: "{}" }); $("wsMsg").textContent = ""; openSession(current.ref, true); }
    catch (e) { $("wsMsg").textContent = e.message; }
    $("buildBtn").disabled = false;
  }
  $("secondReadBtn").addEventListener("click", async function () {
    $("wsMsg").textContent = "Second read with Muse Wonder…"; $("secondReadBtn").disabled = true;
    try { await api("/api/staff/sessions/" + current.ref + "/second-read", { method: "POST", body: "{}" }); $("wsMsg").textContent = ""; activeId = null; openSession(current.ref, true); }
    catch (e) { $("wsMsg").textContent = e.message; }
    $("secondReadBtn").disabled = false;
  });

  // ---------- letters ----------
  $("letterBtn").addEventListener("click", function () { $("letterPanel").classList.toggle("hidden"); });
  $("letterClose").addEventListener("click", function () { $("letterPanel").classList.add("hidden"); });
  $("letterDraft").addEventListener("click", async function () {
    $("letterMsg").textContent = "Drafting from your marks…"; $("letterDraft").disabled = true;
    try {
      var r = await api("/api/staff/sessions/" + current.ref + "/letter/draft", { method: "POST", body: JSON.stringify({ decision: $("letterKind").value, note: $("letterNote").value }) });
      $("letterMsg").textContent = "";
      var box = $("letterEditor"); box.textContent = "";
      var subj = el("input", { type: "text", value: r.letter.subject });
      var body = el("textarea", { style: "min-height:240px" }); body.value = r.letter.body;
      var save = el("button", { type: "button", text: "Save and send to the resident" });
      var msg = el("span", { class: "small" });
      save.addEventListener("click", async function () {
        save.disabled = true;
        try { await api("/api/staff/sessions/" + current.ref + "/letter", { method: "POST", body: JSON.stringify({ subject: subj.value, body: body.value, decision: r.letter.decision }) }); msg.textContent = "Sent."; $("letterPanel").classList.add("hidden"); openSession(current.ref, true); }
        catch (e) { msg.textContent = e.message; save.disabled = false; }
      });
      box.appendChild(el("label", { class: "small", text: "Subject" })); box.appendChild(subj);
      box.appendChild(el("label", { class: "small", text: "Body (edit before sending)" })); box.appendChild(body);
      box.appendChild(el("div", { class: "row", style: "margin-top:8px" }, [save, msg]));
    } catch (e) { $("letterMsg").textContent = e.message; }
    $("letterDraft").disabled = false;
  });

  (async function boot() {
    try { town = await api("/api/town"); $("townName").textContent = town.name + " · Planning & Zoning · reviewer workspace"; } catch (e) {}
    await checkSession();
    var ref = new URLSearchParams(location.search).get("ref");
    if (ref && !$("login").classList.contains("hidden") === false) openSession(ref);
  })();
})();
