// Reviewer workspace. All server data is rendered with textContent; no innerHTML.
// Layout: the queue across the top (full / half / collapsed), then a four-step review bar:
// 1 what was submitted, 2 the code that applies, 3 the point-by-point review, 4 the return letter.
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
  function fmtShort(iso) { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return iso || ""; } }
  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { var err = new Error(data.error || ("Request failed (" + res.status + ")")); err.status = res.status; throw err; }
    return data;
  }
  var STATUS_LABEL = { open: "Talking", ready: "Ready (not submitted)", referred: "Referred", submitted: "Submitted", needs_info: "Needs info", in_review: "Forwarded", answered: "Answered", error: "Error" };
  var STATE_LABEL = { not_started: "Not reviewed", met: "Approved", not_met: "Denied", cannot_verify: "Needs info", not_applicable: "N/A", staff_note: "Comment" };
  var DECISION_LABEL = { request_info: "Incomplete: ask for the missing items", accept_complete: "Complete: forwarded to the deciding body", answer: "Answer letter (from your comments)", refer: "Belongs with another department" };
  var town = null, current = null, activeId = null, step = 1, queueRows = [], qMode = "full", letterTimer = null, generating = false;

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

  // ---------- sign-in ----------
  async function checkSession() {
    try { await api("/api/staff/me"); $("login").classList.add("hidden"); $("app").classList.remove("hidden"); $("logout").classList.remove("hidden"); await loadQueue(); return true; }
    catch (e) { $("login").classList.remove("hidden"); if (e.status === 503) { $("loginMsg").textContent = e.message; $("loginForm").querySelector("button").disabled = true; } return false; }
  }
  $("loginForm").addEventListener("submit", async function (ev) {
    ev.preventDefault(); $("loginMsg").textContent = "";
    try { await api("/api/staff/login", { method: "POST", body: JSON.stringify({ passcode: $("passcode").value }) }); $("passcode").value = ""; await checkSession(); }
    catch (e) { $("loginMsg").textContent = e.message; }
  });
  $("logout").addEventListener("click", async function () { await api("/api/staff/logout", { method: "POST" }); location.reload(); });

  // ---------- queue ----------
  function setQueueMode(mode) {
    qMode = mode;
    var q = $("qpanel");
    q.className = "qpanel q-" + mode;
    $("qToggle").textContent = mode === "collapsed" ? "▼" : mode === "half" ? "▲" : "▲";
    $("qToggle").title = mode === "collapsed" ? "Show the queue" : mode === "half" ? "Collapse the queue" : "Collapse the queue";
  }
  $("qToggle").addEventListener("click", function () {
    if (!current) { setQueueMode(qMode === "collapsed" ? "full" : "collapsed"); return; }
    setQueueMode(qMode === "collapsed" ? "half" : "collapsed");
  });
  ["qSearch", "qStatus", "qDept", "qSort"].forEach(function (id) { $(id).addEventListener("input", renderQueue); $(id).addEventListener("change", renderQueue); });
  $("refresh").addEventListener("click", loadQueue);
  $("purgeDemo").addEventListener("click", async function () {
    if (!confirm("Delete every conversation that was started from the worked examples? Real visits are kept.")) return;
    try { var r = await api("/api/staff/purge-demo", { method: "POST", body: "{}" }); $("usage").textContent = "Removed " + r.deleted + " demo conversation(s)."; loadQueue(); }
    catch (e) { $("usage").textContent = e.message; }
  });
  function deptName(id) { var d = (town && town.departments || []).find(function (x) { return x.id === id; }); return d ? d.name : (id || ""); }
  async function loadQueue() {
    try {
      var data = await api("/api/staff/queue");
      queueRows = data.sessions;
      $("usage").textContent = "Model calls today: " + data.usage_today.n + " of " + data.daily_cap + " (" + data.usage_today.p + " in / " + data.usage_today.c + " out tokens)";
      renderQueue();
    } catch (e) { if (e.status === 401) return checkSession(); $("usage").textContent = e.message; }
  }
  function renderQueue() {
    var tb = $("queue"); tb.textContent = "";
    var q = $("qSearch").value.trim().toLowerCase();
    var st = $("qStatus").value, dept = $("qDept").value, sort = $("qSort").value;
    var rows = queueRows.filter(function (s) {
      if (st && s.status !== st) return false;
      if (dept && s.department !== dept) return false;
      if (q) { var hay = (s.ref + " " + (s.title || "") + " " + (s.preview || "") + " " + (s.packet_type || "") + " " + deptName(s.department)).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
    var order = { submitted: 0, needs_info: 1, in_review: 2, answered: 3, ready: 4, open: 5, referred: 6, error: 7 };
    rows.sort(function (a, b) {
      if (sort === "oldest") return a.created_at < b.created_at ? -1 : 1;
      if (sort === "updated") return a.updated_at < b.updated_at ? 1 : -1;
      if (sort === "title") return String(a.title || a.preview).localeCompare(String(b.title || b.preview));
      if (sort === "status") return (order[a.status] - order[b.status]) || (a.created_at < b.created_at ? 1 : -1);
      return a.created_at < b.created_at ? 1 : -1;
    });
    rows.forEach(function (s) {
      var tr = el("tr", { class: current && current.ref === s.ref ? "selected" : "" }, [
        el("td", null, [el("div", null, [el("strong", { text: s.ref })]), el("div", { class: "small", text: fmtShort(s.created_at) + (s.has_sketch ? " · drawing" : "") + (s.demo_id ? " · example" : "") + (s.has_account ? " · account" : "") })]),
        el("td", null, [el("div", { text: s.title || s.preview }), el("div", { class: "small", text: (s.packet_type || "").replace(/_/g, " ") })]),
        el("td", { text: deptName(s.department) }),
        el("td", null, [chip(s.status, STATUS_LABEL[s.status] || s.status), s.resubmit_count ? el("div", { class: "small", text: "resubmitted " + s.resubmit_count + "x" }) : null, s.changed_since_submit ? el("div", { class: "small", text: "resident is updating" }) : null]),
        el("td", { class: "small", text: s.submitted_at ? fmtShort(s.submitted_at) : "" }),
      ]);
      tr.addEventListener("click", function () { openSession(s.ref); });
      tb.appendChild(tr);
    });
    if (!rows.length) tb.appendChild(el("tr", null, [el("td", { text: queueRows.length ? "Nothing matches these filters." : "Nothing in the queue yet.", colspan: "5" })]));
    $("qCount").textContent = rows.length + " of " + queueRows.length;
    var sel = tb.querySelector("tr.selected"); if (sel) sel.scrollIntoView({ block: "nearest" });
    $("qSelected").textContent = current ? "· open: " + current.ref : "";
  }

  // ---------- opening an application ----------
  async function openSession(ref, keepActive) {
    try {
      current = await api("/api/staff/sessions/" + encodeURIComponent(ref));
      $("empty").classList.add("hidden"); $("workspace").classList.remove("hidden");
      if (qMode === "full") setQueueMode("half");
      history.replaceState(null, "", "/staff?ref=" + encodeURIComponent(ref));
      if (!keepActive) { activeId = null; }
      renderQueue();
      renderWorkspace();
      if (current.busy) setTimeout(function () { if (current && current.ref === ref) openSession(ref, true); }, 2500);
    } catch (e) { alert(e.message); }
  }
  function considerations() { return current && current.review ? current.review.considerations || [] : []; }
  function stateOf(id) { return (current && current.review && current.review.states && current.review.states[id]) || { state: "not_started", note: "" }; }
  function reviewedCount() { return considerations().filter(function (c) { return stateOf(c.id).state !== "not_started"; }).length; }

  function renderWorkspace() {
    var s = current;
    $("wsRef").textContent = s.ref;
    $("wsStatus").textContent = ""; $("wsStatus").appendChild(chip(s.status, STATUS_LABEL[s.status] || s.status));
    if (s.resubmit_count) $("wsStatus").appendChild(el("span", { class: "chip in_review", text: "resubmitted " + s.resubmit_count + "x" }));
    if (s.changed_since_submit) $("wsStatus").appendChild(el("span", { class: "chip unclear", text: "resident is updating; not resubmitted yet" }));
    $("wsTitle").textContent = s.packet ? s.packet.title : (s.understanding ? s.understanding.summary : "");
    $("wsResidentLink").href = s.resident_link;
    renderStepBar();
    renderStep();
  }
  function renderStepBar() {
    var r = current.review || {};
    var dots = {
      1: r.submission_summary ? "done" : "todo",
      2: r.code_summary ? "done" : "todo",
      3: considerations().length ? (reviewedCount() === considerations().length ? "done" : "partial") : "todo",
      4: r.letter ? (r.letter.sent_at ? "done" : current.letter_stale && !r.letter.edited ? "partial" : "partial") : "todo",
    };
    Array.prototype.forEach.call(document.querySelectorAll(".stepbtn"), function (b) {
      var n = Number(b.dataset.step);
      b.classList.toggle("active", n === step);
      var dot = $("dot" + n); dot.className = "dot " + dots[n];
      var lbl = b.querySelector(".lbl");
      if (n === 3) lbl.textContent = "Application review" + (considerations().length ? " · " + reviewedCount() + " of " + considerations().length : "");
      if (n === 4) lbl.textContent = "Return document" + (r.letter ? (r.letter.sent_at ? " · sent" : r.letter.edited ? " · edited" : " · draft") : "");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".stepbtn"), function (b) {
    b.addEventListener("click", function () { step = Number(b.dataset.step); renderWorkspace(); });
  });

  function renderStep() {
    var left = $("leftPane"), right = $("rightPane");
    left.textContent = ""; right.textContent = "";
    if (step === 1) { renderDocumentTabs(left); renderSummary(right); }
    else if (step === 2) { renderCodeSummary(left); renderResearch(right); }
    else if (step === 3) { renderPoints(left); renderEvidence(right); }
    else { renderLetter(left); renderLetterSide(right); }
  }

  // ---------- step 1: what was submitted ----------
  function renderSummary(pane) {
    var r = current.review || {};
    var sum = r.submission_summary;
    var head = el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "What was submitted" }), el("span", null, [sum ? modelChip(sum.model || "Muse Spark") : null])]);
    pane.appendChild(head);
    var btn = el("button", { type: "button", class: sum ? "quiet" : "", text: sum ? "Regenerate bullet points" : "Generate bullet points" });
    btn.addEventListener("click", async function () { await runStep("summary", btn, "Reading the submission…"); });
    if (!sum) {
      pane.appendChild(el("p", { class: "small", text: "The agent reads everything the resident sent and lists the facts as bullet points: who, where, what is proposed, every number given, what is attached, what was signed." }));
      pane.appendChild(btn);
      if (current.packet && !current.busy && !generating) runStep("summary", btn, "Reading the submission…");
      return;
    }
    pane.appendChild(el("p", { class: "lead", text: sum.headline }));
    if (!sum.facts) {
      pane.appendChild(el("div", { class: "notice warn", text: "This summary was made before the basic facts and standards were added. Regenerate it to fill them in." }));
    } else {
      pane.appendChild(el("h3", { text: "Basic facts" }));
      var ftb = el("tbody");
      [["Name of applicant", "applicant_name"], ["Application type", "application_type"], ["Address of property", "property_address"], ["Existing zone", "existing_zone"], ["Requested zoning", "requested_zoning"], ["General Plan designation", "general_plan_designation"], ["Proposed use", "proposed_use"]].forEach(function (row) {
        var v = sum.facts[row[1]] || "not stated";
        ftb.appendChild(el("tr", null, [el("th", { text: row[0] }), el("td", { class: /^not (stated|available)/i.test(v) ? "blank" : "", text: v })]));
      });
      pane.appendChild(el("table", { class: "kv facts" }, [ftb]));
      pane.appendChild(el("h3", { text: "Development standards: proposed vs required" }));
      if (sum.standards && sum.standards.length) {
        var stb = el("tbody");
        sum.standards.forEach(function (x) { stb.appendChild(el("tr", null, [el("td", { text: x.standard }), el("td", { text: x.proposed }), el("td", { text: x.required }), el("td", null, [chip(x.status)])])); });
        pane.appendChild(el("table", { class: "standards" }, [el("thead", null, [el("tr", null, [el("th", { text: "Standard" }), el("th", { text: "Proposed" }), el("th", { text: "Required" }), el("th", { text: "" })])]), stb]));
      } else pane.appendChild(el("p", { class: "small", text: "No dimensional standards apply to this kind of request." }));
      pane.appendChild(el("h3", { text: "Everything else the agent found" }));
    }
    var ul = el("ul", { class: "bullets" });
    (sum.bullets || []).forEach(function (b) { ul.appendChild(el("li", null, [document.createTextNode(b.text + " "), el("span", { class: "src", text: String(b.source).replace(/_/g, " ") })])); });
    pane.appendChild(ul);
    if (sum.blanks && sum.blanks.length) {
      pane.appendChild(el("h3", { text: "Left blank or inconsistent" }));
      pane.appendChild(el("ul", null, sum.blanks.map(function (b) { return el("li", { text: b }); })));
    }
    pane.appendChild(el("p", { class: "small", text: "Generated " + fmt(sum.generated_at) + ". Facts as the resident gave them; nothing here is a judgment." }));
    pane.appendChild(btn);
  }
  // Step 1 left: the submitted documents, one tab each (application pages, drawing, conversation, signature).
  var docTab = 0;
  function renderDocumentTabs(pane) {
    var s = current;
    var tabs = [];
    (s.packet ? s.packet.documents : []).forEach(function (d, i) { tabs.push({ label: d.name, render: function (box) { renderOneDocument(box, d); } }); });
    if (s.has_sketch) tabs.push({ label: "Drawing", render: function (box) {
      var skStep = (s.steps || []).find(function (x) { return x.name === "sketch" && x.status === "done"; });
      box.appendChild(drawingWithOutline("/api/sessions/" + encodeURIComponent(s.ref) + "/sketch", skStep ? skStep.output : null));
      if (skStep && skStep.output) { var o = skStep.output; box.appendChild(el("p", { class: "small", text: "Read by Muse Spark as " + String(o.drawing_type || "").replace(/_/g, " ") + ", " + o.readability + ". SAM 3.1 outlines drawn on the image." + (o.building_code_site_plan_note ? " " + o.building_code_site_plan_note : "") })); if (o.dimensions && o.dimensions.length) box.appendChild(el("ul", null, o.dimensions.map(function (d) { return el("li", { text: d.what + ": " + d.value_text }); }))); }
    } });
    if (s.parcel) tabs.push({ label: "Parcel & map", render: function (box) {
      box.appendChild(el("div", { text: (s.parcel.address || "") + " · " + (s.parcel.id || "") + " · zone " + (s.parcel.zone || "?") + (s.parcel.zoneName ? " (" + s.parcel.zoneName + ")" : "") + " · " + (s.parcel.areaAcres || "?") + " acres" + (s.parcel.straddlesZones ? " · touches " + s.parcel.zonesTouched.join(", ") : "") + (s.parcel.assumed ? " · ASSUMED among several parcels at this address" : "") }));
      box.appendChild(el("div", { class: "small", text: "Owner of record: " + (s.owner ? s.owner.name : "?") + " (fictional demo name)" }));
      box.appendChild(el("img", { src: "/api/map/parcel/" + encodeURIComponent(s.parcel.id) + ".svg", alt: "Zoning map around the parcel", style: "width:100%;border-radius:10px;border:1px solid var(--line);margin-top:10px" }));
    } });
    if (s.signature) tabs.push({ label: "Signature", render: function (box) {
      box.appendChild(el("img", { src: "/api/sessions/" + encodeURIComponent(s.ref) + "/signature?t=" + encodeURIComponent(s.signature.signed_at), alt: "Signature", style: "max-width:360px;display:block;border:1px solid var(--line);border-radius:8px;background:#fff" }));
      box.appendChild(el("div", { class: "small", text: "Signed by " + s.signature.name + " (" + s.signature.method + ") on " + fmt(s.signature.signed_at) + " from " + (s.signature.ip || "?") + (s.signature_current ? " · matches the application as it stands" : " · the application changed after signing; a resubmit needs a new signature") }));
      box.appendChild(el("p", { class: "small", text: s.signature.consent || "" }));
    } });
    tabs.push({ label: "Conversation", render: function (box) {
      var tl = el("ul", { class: "transcript" });
      (s.messages || []).forEach(function (m) { tl.appendChild(el("li", { class: m.role }, [el("strong", { text: (m.role === "resident" ? "Resident" : (m.character || "Desk")) + ": " }), m.text])); });
      box.appendChild(tl);
    } });
    if (!tabs.length) { pane.appendChild(el("p", { class: "small", text: "Nothing submitted yet." })); return; }
    if (docTab >= tabs.length) docTab = 0;
    var bar = el("div", { class: "doctabs" });
    tabs.forEach(function (t, i) {
      var b = el("button", { type: "button", class: "doctab" + (i === docTab ? " active" : ""), text: t.label });
      b.addEventListener("click", function () { docTab = i; renderStep(); });
      bar.appendChild(b);
    });
    pane.appendChild(el("h2", { text: "Submitted documents" }));
    pane.appendChild(bar);
    var box = el("div", { class: "docview" });
    tabs[docTab].render(box);
    pane.appendChild(box);
  }
  function renderOneDocument(box, d) {
    box.appendChild(el("div", { class: "doc-head" }, [el("b", { text: d.name }), el("span", { class: "small", text: d.section ? " · filed under section " + d.section : "" })]));
    var tb = el("tbody");
    (d.fields || []).forEach(function (f) {
      tb.appendChild(el("tr", null, [el("td", { text: f.label }), el("td", { class: "val" }, [f.value ? document.createTextNode(f.value) : el("span", { class: "blank", text: "[blank]" })]), el("td", { class: "small", text: f.source && f.source !== "blank" ? "from " + f.source.replace("_", " ") : "" })]));
    });
    box.appendChild(el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Field" }), el("th", { text: "Value" }), el("th", { text: "" })])]), tb]));
    box.appendChild(el("h3", { text: "Statement" }));
    box.appendChild(el("div", { class: "narrative", text: d.narrative || "" }));
    if (d.code_basis && d.code_basis.length) {
      box.appendChild(el("h3", { text: "Code sections the application cites" }));
      d.code_basis.forEach(function (c) { if (c.section) box.appendChild(el("div", { class: "quote" }, [el("span", { text: c.quote ? "“" + c.quote + "”" : "" }), el("span", { class: "cite", text: "Section " + c.section + (c.quote ? (c.quote_verified ? " · verified" : " · unverified") : "") })])); });
    }
  }
  function renderDocuments(pane) {
    var s = current, c = active();
    pane.appendChild(el("h2", { text: s.packet ? s.packet.title : "No packet yet" }));
    if (s.packet) pane.appendChild(el("p", { class: "small", text: (s.packet.packet_type || "").replace(/_/g, " ") + " · " + (s.packet.one_line_summary || "") }));
    if (s.parcel) {
      var hl = c && /parcel|zone|department/i.test((c.id || "") + (c.title || "") + (c.kind || ""));
      pane.appendChild(el("div", { class: "docsec" + (hl ? " hl" : "") }, [el("h3", { text: "Parcel" }), el("div", { text: (s.parcel.address || "") + " · " + (s.parcel.id || "") + " · zone " + (s.parcel.zone || "?") + (s.parcel.zoneName ? " (" + s.parcel.zoneName + ")" : "") + " · " + (s.parcel.areaAcres || "?") + " acres" + (s.parcel.straddlesZones ? " · touches " + s.parcel.zonesTouched.join(", ") : "") + (s.parcel.assumed ? " · ASSUMED among several parcels at this address" : "") }), el("div", { class: "small", text: "Owner of record: " + (s.owner ? s.owner.name : "?") + " (fictional demo name)" })]));
    }
    if (s.signature) {
      var sigBox = el("div", { class: "docsec" + (c && c.kind === "completeness" ? " hl" : "") }, [el("h3", { text: "Electronic signature" })]);
      sigBox.appendChild(el("img", { src: "/api/sessions/" + encodeURIComponent(s.ref) + "/signature?t=" + encodeURIComponent(s.signature.signed_at), alt: "Signature", style: "max-width:320px;display:block;border:1px solid var(--line);border-radius:8px;background:#fff" }));
      sigBox.appendChild(el("div", { class: "small", text: "Signed by " + s.signature.name + " (" + s.signature.method + ") on " + fmt(s.signature.signed_at) + " from " + (s.signature.ip || "?") + (s.signature_current ? " · matches the application as it stands" : " · the application changed after signing; a resubmit needs a new signature") }));
      pane.appendChild(sigBox);
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
      var skStep = (s.steps || []).find(function (x) { return x.name === "sketch" && x.status === "done"; });
      pane.appendChild(el("div", { class: "docsec" }, [el("h3", { text: "Resident's drawing (Muse Spark reading, SAM 3.1 outlines)" }), drawingWithOutline("/api/sessions/" + encodeURIComponent(s.ref) + "/sketch", skStep ? skStep.output : null)]));
    }
    var tl = el("ul", { class: "transcript" });
    (s.messages || []).forEach(function (m) { tl.appendChild(el("li", { class: m.role }, [el("strong", { text: (m.role === "resident" ? "Resident" : (m.character || "Desk")) + ": " }), m.text])); });
    pane.appendChild(el("div", { class: "docsec" }, [el("h3", { text: "Conversation" }), tl]));
  }

  // ---------- step 2: the code that applies ----------
  function renderCodeSummary(pane) {
    var r = current.review || {};
    var cs = r.code_summary;
    pane.appendChild(el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "Relevant code" }), el("span", null, [cs ? modelChip(cs.model || "Muse Spark") : null])]));
    var btn = el("button", { type: "button", class: cs ? "quiet" : "", text: cs ? "Regenerate code summary" : "Summarize the relevant code" });
    btn.addEventListener("click", async function () { await runStep("code-summary", btn, "Reading the code sections…"); });
    if (!cs) {
      pane.appendChild(el("p", { class: "small", text: "The agent reads the sections the research and the application point to and summarizes each one, with a quote checked against the stored code text." }));
      pane.appendChild(btn);
      if (current.packet && !current.busy && !generating) runStep("code-summary", btn, "Reading the code sections…");
      return;
    }
    pane.appendChild(el("div", { class: "notice", text: cs.overview }));
    (cs.sections || []).forEach(function (x) {
      var card = el("div", { class: "codecard" }, [el("div", { class: "row", style: "justify-content:space-between" }, [el("b", { text: "Section " + x.section + (x.title ? " · " + x.title : "") }), el("a", { href: x.url || "#", target: "_blank", rel: "noopener", class: "small", text: "code site" })])]);
      card.appendChild(el("p", { text: x.summary }));
      if (x.quote) card.appendChild(el("div", { class: "quote" }, [el("span", { text: "“" + x.quote + "”" }), el("span", { class: "cite", text: "quote verified against the stored code text" })]));
      card.appendChild(el("p", { class: "small", text: x.why_it_matters }));
      var det = el("details", null, [el("summary", { class: "small", text: "Full section text" })]);
      det.addEventListener("toggle", async function () {
        if (!det.open || det.dataset.loaded) return;
        det.dataset.loaded = "1";
        try { var sec = await api("/api/code/sections/" + encodeURIComponent(x.section)); det.appendChild(el("div", { class: "narrative", text: sec.text })); }
        catch (e) { det.appendChild(el("div", { class: "small", text: e.message })); }
      });
      card.appendChild(det);
      pane.appendChild(card);
    });
    pane.appendChild(el("p", { class: "small", text: "Generated " + fmt(cs.generated_at) + ". " + (town ? town.wording.staffDecide : "") }));
    pane.appendChild(btn);
  }
  function renderResearch(pane) {
    var s = current;
    pane.appendChild(el("h2", { text: "Resident-side research" }));
    if (s.research) {
      pane.appendChild(el("div", null, [chip(s.research.use_status), " tier ", chip(s.research.process_tier), " apps: " + (s.research.required_applications.join(", ") || "none")]));
      pane.appendChild(el("p", { class: "small", text: s.research.process_explanation }));
      if (s.research.standards && s.research.standards.length) {
        pane.appendChild(el("h3", { text: "Numbers checked at the counter" }));
        var tb = el("tbody");
        s.research.standards.forEach(function (x) { tb.appendChild(el("tr", null, [el("td", { text: x.section }), el("td", { text: x.requirement }), el("td", { text: x.required_value }), el("td", { text: x.proposed_value }), el("td", null, [chip(x.status)])])); });
        pane.appendChild(el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Section" }), el("th", { text: "Rule" }), el("th", { text: "Code" }), el("th", { text: "Packet" }), el("th", { text: "" })])]), tb]));
      }
      pane.appendChild(el("h3", { text: "Sections the counter relied on" }));
      (s.research.applicable_sections || []).forEach(function (x) { pane.appendChild(el("div", { class: "quote" }, [el("span", { text: x.quote ? "“" + x.quote + "”" : "(no verified quote)" }), el("span", { class: "cite", text: "Section " + x.section + " · " + x.why })])); });
    } else pane.appendChild(el("p", { class: "small", text: "No research on this conversation." }));
    if (s.parcel) pane.appendChild(el("img", { src: "/api/map/parcel/" + encodeURIComponent(s.parcel.id) + ".svg", alt: "Zoning map around the parcel", style: "width:100%;border-radius:10px;border:1px solid var(--line);margin-top:10px" }));
  }

  // ---------- step 3: point by point ----------
  function active() { return considerations().find(function (c) { return c.id === activeId; }) || null; }
  function sectionMatches(c, text) {
    if (!c) return false;
    var ids = (c.sections || []).concat(c.quote_section ? [c.quote_section] : []);
    return ids.some(function (id) { return id && text && text.indexOf(id) > -1; });
  }
  function renderPoints(pane) {
    var cons = considerations();
    var head = el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "Application review, point by point" }), el("span", { class: "row" })]);
    pane.appendChild(head);
    var buildBtn = el("button", { type: "button", class: cons.length ? "quiet" : "", text: cons.length ? "Rebuild the points" : "Build the points" });
    buildBtn.addEventListener("click", async function () { await runStep("considerations", buildBtn, "Listing the points with Muse Spark and the code tools… about a minute."); });
    var secondBtn = el("button", { type: "button", class: "quiet", text: "Second read (Muse Wonder)", title: "A stronger model re-reads the list against the code" });
    secondBtn.addEventListener("click", async function () { await runStep("second-read", secondBtn, "Second read with Muse Wonder…"); });
    head.lastChild.appendChild(buildBtn); if (cons.length) head.lastChild.appendChild(secondBtn);
    if (!cons.length) {
      pane.appendChild(el("p", { class: "small", text: current.busy ? "The resident-side desk is still working on this conversation…" : current.packet ? "The agent lists every point a planner checks for this application, each with the requirement, the exact quote and what the packet says. You approve, deny, ask for information, or set aside each one." : "This conversation has no packet yet." }));
      if (current.packet && !current.busy && !generating && ["submitted", "needs_info", "in_review", "ready", "answered"].includes(current.status)) runStep("considerations", buildBtn, "Listing the points with Muse Spark and the code tools… about a minute.");
      return;
    }
    pane.appendChild(el("div", { class: "progress-line" }, [el("span", { text: reviewedCount() + " of " + cons.length + " reviewed" }), el("span", { class: "small", text: current.review.process_summary || "" })]));
    if (current.review.second_read) {
      var sr = current.review.second_read;
      var srBox = el("div", { class: "notice" }, [el("b", { text: "Second read (" + (sr.model || "") + "): " }), sr.summary]);
      if (sr.missed && sr.missed.length) srBox.appendChild(el("ul", null, sr.missed.map(function (m) { return el("li", { text: "Missed: " + m.title + " (" + m.section + "): " + m.why }); })));
      if (sr.overstated && sr.overstated.length) srBox.appendChild(el("ul", null, sr.overstated.map(function (m) { return el("li", { text: "Check: " + m.id + ": " + m.problem }); })));
      pane.appendChild(srBox);
    }
    cons.forEach(function (c, i) {
      var st = stateOf(c.id);
      var card = el("div", { class: "point " + st.state + (activeId === c.id ? " active" : "") });
      var top = el("div", { class: "ptop" }, [el("span", { class: "pnum", text: String(i + 1) }), el("div", { class: "ptitle" }, [el("b", { text: c.title }), el("div", { class: "small", text: (c.kind || "") + (c.added_by === "staff" ? " · added by you" : "") + ((c.sections || []).length ? " · sections " + c.sections.join(", ") : "") })]), chip(st.state, STATE_LABEL[st.state])]);
      top.addEventListener("click", function () { activeId = activeId === c.id ? null : c.id; renderWorkspace(); });
      card.appendChild(top);
      if (activeId === c.id) {
        card.appendChild(el("p", { class: "req" }, [el("b", { text: "Requirement: " }), c.requirement]));
        if (c.quote) card.appendChild(el("div", { class: "quote" }, [el("span", { text: "“" + c.quote + "”" }), el("span", { class: "cite", text: "Section " + (c.quote_section || (c.sections || [])[0] || "") + " · quote verified" })]));
        card.appendChild(el("p", null, [el("b", { text: "Packet says: " }), c.evidence_in_packet || "nothing", " ", chip(c.document_reading, "reading: " + String(c.document_reading).replace(/_/g, " "))]));
        card.appendChild(el("p", { class: "small" }, [el("b", { text: "How staff verify: " }), c.how_to_verify || ""]));
      }
      var marks = el("div", { class: "marks" });
      [["met", "Approve"], ["not_met", "Deny"], ["cannot_verify", "Needs info"], ["not_applicable", "N/A"]].forEach(function (m) {
        var b = el("button", { type: "button", class: "mark " + m[0] + (st.state === m[0] ? " on" : ""), text: m[1] });
        b.addEventListener("click", async function () { await setState(c.id, m[0], st.note); });
        marks.appendChild(b);
      });
      card.appendChild(marks);
      var note = el("textarea", { class: "pnote", placeholder: "Comment (your words; this goes into the letter)", rows: "1" });
      note.value = st.note || "";
      note.addEventListener("focus", function () { note.rows = 3; });
      note.addEventListener("blur", async function () { note.rows = 1; if (note.value !== (st.note || "")) await setState(c.id, st.state === "not_started" && note.value ? "staff_note" : st.state, note.value); });
      card.appendChild(note);
      pane.appendChild(card);
    });
    var add = el("button", { type: "button", class: "quiet", text: "+ Add a point of your own" });
    add.addEventListener("click", async function () {
      var title = prompt("Point to review (something you check that the agent did not list):");
      if (!title) return;
      var how = prompt("How do you normally verify it? (optional)") || "";
      try { await api("/api/staff/sessions/" + current.ref + "/consideration", { method: "POST", body: JSON.stringify({ add: { title: title, how_to_verify: how } }) }); openSession(current.ref, true); } catch (e) { alert(e.message); }
    });
    pane.appendChild(add);
    // Ask the agent
    var askBox = el("div", { class: "askbox" }, [el("div", { class: "agent" }, [el("img", { src: "/public/characters/juniper-neutral.webp", alt: "" }), el("div", { class: "text", id: "agentText", text: active() ? "Ask me about the selected point. I answer from the code and the packet, never with a recommendation." : "Select a point, or ask me anything about this application." })])]);
    var form = el("form", { class: "ask" }, [el("input", { type: "text", id: "askInput", placeholder: "Ask the agent…" }), el("button", { type: "submit", class: "secondary", text: "Ask" })]);
    form.addEventListener("submit", async function (ev) {
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
    askBox.appendChild(form);
    pane.appendChild(askBox);
  }
  async function setState(id, state, note) {
    try { var r = await api("/api/staff/sessions/" + current.ref + "/consideration", { method: "POST", body: JSON.stringify({ id: id, state: state, note: note || "" }) }); current.review.states = r.states; await refreshMeta(); renderWorkspace(); }
    catch (e) { alert(e.message); }
  }
  async function refreshMeta() { try { var s = await api("/api/staff/sessions/" + encodeURIComponent(current.ref)); current.letter_stale = s.letter_stale; current.review_basis_hash = s.review_basis_hash; current.letter_decision_auto = s.letter_decision_auto; if (s.review) current.review.letter = s.review.letter; } catch (e) {} }

  function renderEvidence(pane) {
    var s = current, c = active();
    if (!c) {
      pane.appendChild(el("h2", { text: "Documents" }));
      pane.appendChild(el("p", { class: "small", text: "Select a point on the left to see its evidence here. Until then, the application as submitted:" }));
      renderDocuments(pane);
      return;
    }
    pane.appendChild(el("h2", { text: c.title }));
    pane.appendChild(el("div", { class: "row" }, [chip(c.kind || "consideration"), chip(c.document_reading, "reading: " + String(c.document_reading).replace(/_/g, " ")), c.added_by === "staff" ? chip("staff_note", "added by staff") : modelChip((s.review && s.review.model) || "Muse Spark")]));
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
      pane.appendChild(el("h3", { text: "Drawing" }));
      pane.appendChild(drawingWithOutline("/api/sessions/" + encodeURIComponent(s.ref) + "/sketch", sketch.output));
      var o = sketch.output;
      pane.appendChild(el("p", { class: "small", text: o.drawing_type.replace(/_/g, " ") + ", " + o.readability + (o.building_code_site_plan_note ? ". " + o.building_code_site_plan_note : "") }));
      if (o.dimensions && o.dimensions.length) pane.appendChild(el("ul", null, o.dimensions.map(function (d) { return el("li", { text: d.what + ": " + d.value_text }); })));
    }
    pane.appendChild(el("h3", { text: "In the application" }));
    renderDocuments(pane);
  }

  // ---------- step 4: the return document ----------
  function renderLetter(pane) {
    var r = current.review || {};
    var L = r.letter;
    var auto = current.letter_decision_auto || {};
    pane.appendChild(el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { text: "Return document" }), el("span", null, [L ? modelChip(L.model || "Muse Spark") : null])]));
    if (!L) {
      pane.appendChild(el("p", { class: "small", text: "The letter is written from steps 1 to 3: what was submitted, the code that applies, and your point-by-point marks and comments. It is generated when you open this tab and refreshed whenever your review changes, until you edit it." }));
      var gen = el("button", { type: "button", text: "Generate the letter" });
      gen.addEventListener("click", function () { generateLetter("regenerate"); });
      pane.appendChild(gen);
      if (!generating && current.packet) generateLetter("regenerate");
      return;
    }
    var status;
    if (L.sent_at) status = "Sent to the resident " + fmt(L.sent_at) + ".";
    else if (L.edited) status = "Edited by you " + fmt(L.edited_at) + ". Frozen: the review has " + (current.letter_stale ? "changed since; press Update to bring it in." : "not changed since.");
    else if (current.letter_stale) status = "The review changed since this draft; refreshing…";
    else status = "Generated from your review " + fmt(L.generated_at) + ". It refreshes when your review changes until you edit it.";
    pane.appendChild(el("div", { class: "notice" + (L.edited ? " warn" : ""), text: status }));
    if (current.letter_stale && !L.edited && !L.sent_at && !generating) { generateLetter("regenerate"); }
    // kind of letter
    var kindRow = el("div", { class: "row", style: "margin:8px 0" }, [el("label", { class: "small", text: "Kind of letter" })]);
    var sel = el("select", { id: "letterKind" });
    sel.appendChild(el("option", { value: "", text: "From your review: " + (DECISION_LABEL[auto.decision] || auto.decision) + " (" + (auto.why || "") + ")" }));
    Object.keys(DECISION_LABEL).forEach(function (k) { sel.appendChild(el("option", { value: k, text: DECISION_LABEL[k] })); });
    sel.value = L.decision_auto ? "" : (L.decision || "");
    kindRow.appendChild(sel);
    pane.appendChild(kindRow);
    var subj = el("input", { type: "text", id: "letterSubject" }); subj.value = L.subject || "";
    var body = el("textarea", { id: "letterBody", style: "min-height:360px" }); body.value = L.body || "";
    pane.appendChild(el("label", { class: "small", text: "Subject" })); pane.appendChild(subj);
    pane.appendChild(el("label", { class: "small", text: "Letter" })); pane.appendChild(body);
    function scheduleEdit() {
      clearTimeout(letterTimer);
      letterTimer = setTimeout(saveEdit, 800);
    }
    async function saveEdit() {
      try { var res = await api("/api/staff/sessions/" + current.ref + "/letter/edit", { method: "POST", body: JSON.stringify({ subject: subj.value, body: body.value, decision: sel.value || undefined }) }); current.review.letter = res.letter; current.letter_stale = res.letter_stale; renderStepBar(); $("wsMsg").textContent = "Letter saved."; setTimeout(function () { $("wsMsg").textContent = ""; }, 1500); }
      catch (e) { $("wsMsg").textContent = e.message; }
    }
    subj.addEventListener("input", scheduleEdit); body.addEventListener("input", scheduleEdit);
    sel.addEventListener("change", function () { if (L.edited) scheduleEdit(); else generateLetter("regenerate", sel.value); });
    var actions = el("div", { class: "actions" });
    var upd = el("button", { type: "button", class: "secondary", text: "Update from the review" });
    upd.addEventListener("click", function () { if (L.edited) $("updateDialog").classList.remove("hidden"); else generateLetter("regenerate", sel.value); });
    var send = el("button", { type: "button", text: L.sent_at ? "Send again to the resident" : "Send to the resident" });
    send.addEventListener("click", async function () {
      if (!confirm("Send this letter to the resident's conversation? Its status will change to " + ({ request_info: "needs info", accept_complete: "forwarded", answer: "answered", refer: "referred" }[sel.value || L.decision] || "the same") + ".")) return;
      send.disabled = true;
      try { clearTimeout(letterTimer); await api("/api/staff/sessions/" + current.ref + "/letter", { method: "POST", body: JSON.stringify({ subject: subj.value, body: body.value, decision: sel.value || L.decision }) }); $("wsMsg").textContent = "Sent."; await loadQueue(); openSession(current.ref, true); }
      catch (e) { $("wsMsg").textContent = e.message; send.disabled = false; }
    });
    var print = el("button", { type: "button", class: "quiet", text: "Print" });
    print.addEventListener("click", function () { window.print(); });
    actions.appendChild(send); actions.appendChild(upd); actions.appendChild(print);
    pane.appendChild(actions);
    $("updKeep").onclick = function () { $("updateDialog").classList.add("hidden"); generateLetter("keep_manual", sel.value); };
    $("updAll").onclick = function () { $("updateDialog").classList.add("hidden"); generateLetter("regenerate", sel.value); };
    $("updCancel").onclick = function () { $("updateDialog").classList.add("hidden"); };
  }
  function renderLetterSide(pane) {
    var r = current.review || {};
    pane.appendChild(el("h2", { text: "What the letter is built from" }));
    var cons = considerations();
    pane.appendChild(el("h3", { text: "Your review (step 3)" }));
    if (!cons.length) pane.appendChild(el("p", { class: "small", text: "No points reviewed yet." }));
    cons.forEach(function (c) { var st = stateOf(c.id); pane.appendChild(el("div", { class: "row", style: "margin:4px 0" }, [chip(st.state, STATE_LABEL[st.state]), el("span", { text: c.title }), st.note ? el("span", { class: "small", text: "· " + st.note }) : null])); });
    if (r.submission_summary) { pane.appendChild(el("h3", { text: "What was submitted (step 1)" })); pane.appendChild(el("p", { class: "small", text: r.submission_summary.headline })); }
    if (r.code_summary) { pane.appendChild(el("h3", { text: "Relevant code (step 2)" })); pane.appendChild(el("p", { class: "small", text: r.code_summary.overview })); }
    pane.appendChild(el("h3", { text: "Previous letters" }));
    var sent = (current.staff_actions || []).filter(function (a) { return a.action === "letter_saved"; });
    if (!sent.length) pane.appendChild(el("p", { class: "small", text: "None sent yet." }));
    sent.forEach(function (a) { pane.appendChild(el("details", null, [el("summary", { class: "small", text: fmt(a.created_at) + " · " + (a.payload && a.payload.subject) }), el("div", { class: "letter", text: a.payload && a.payload.body })])); });
  }
  async function generateLetter(mode, decision) {
    if (generating) return;
    generating = true;
    $("wsMsg").textContent = mode === "keep_manual" ? "Updating the letter around your edits…" : "Writing the letter from your review…";
    try {
      var res = await api("/api/staff/sessions/" + current.ref + "/letter/generate", { method: "POST", body: JSON.stringify({ mode: mode, decision: decision || undefined }) });
      if (!current.review) current.review = { considerations: [], states: {} };
      current.review.letter = res.letter; current.letter_stale = res.letter_stale; current.letter_decision_auto = res.letter_decision_auto;
      $("wsMsg").textContent = "";
    } catch (e) { $("wsMsg").textContent = e.message; }
    generating = false;
    if (step === 4) renderWorkspace();
  }
  async function runStep(action, btn, msg) {
    if (generating) return;
    generating = true;
    $("wsMsg").textContent = msg; if (btn) btn.disabled = true;
    try { await api("/api/staff/sessions/" + current.ref + "/" + action, { method: "POST", body: "{}" }); $("wsMsg").textContent = ""; generating = false; await openSession(current.ref, true); }
    catch (e) { $("wsMsg").textContent = e.message; generating = false; if (btn) btn.disabled = false; }
  }

  (async function boot() {
    try {
      town = await api("/api/town");
      $("townName").textContent = town.name + " · Planning & Zoning · reviewer workspace";
      (town.departments || []).forEach(function (d) { $("qDept").appendChild(el("option", { value: d.id, text: d.name })); });
    } catch (e) {}
    var ok = await checkSession();
    var ref = new URLSearchParams(location.search).get("ref");
    if (ok && ref) openSession(ref);
  })();
})();
