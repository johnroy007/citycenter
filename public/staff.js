// Staff portal. All server data is rendered with textContent; no innerHTML.
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
  function fmt(iso) { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } }
  var STATUS_LABEL = { processing: "Working", draft_ready: "Draft ready", needs_info: "Needs info", in_review: "Scheduled", error: "Error" };

  async function api(path, opts) {
    var res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, opts || {}));
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { var err = new Error(data.error || ("Request failed (" + res.status + ")")); err.status = res.status; throw err; }
    return data;
  }

  var current = null;

  // ---------- session ----------
  async function checkSession() {
    try {
      await api("/api/staff/me");
      showPortal();
    } catch (e) {
      $("login").classList.remove("hidden");
      $("portal").classList.add("hidden");
      if (e.status === 503) { $("loginMsg").textContent = e.message; $("loginForm").querySelector("button").disabled = true; }
    }
  }
  $("loginForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    $("loginMsg").textContent = "";
    try {
      await api("/api/staff/login", { method: "POST", body: JSON.stringify({ passcode: $("passcode").value }) });
      $("passcode").value = "";
      showPortal();
    } catch (e) { $("loginMsg").textContent = e.message; }
  });
  $("logout").addEventListener("click", async function () {
    await api("/api/staff/logout", { method: "POST" });
    location.reload();
  });
  function showPortal() {
    $("login").classList.add("hidden");
    $("portal").classList.remove("hidden");
    $("logout").classList.remove("hidden");
    loadQueue();
  }

  // ---------- queue ----------
  $("refresh").addEventListener("click", loadQueue);
  async function loadQueue() {
    try {
      var data = await api("/api/staff/queue");
      var tb = $("queue"); tb.textContent = "";
      data.applications.forEach(function (a) {
        var tr = el("tr", null, [
          el("td", null, [el("div", null, [el("strong", { text: a.ref })]), el("div", { class: "small", text: fmt(a.created_at) + (a.has_sketch ? " · sketch" : "") })]),
          el("td", null, [chip(a.status, STATUS_LABEL[a.status] || a.status)]),
        ]);
        tr.addEventListener("click", function () { openApp(a.ref); });
        tb.appendChild(tr);
      });
      if (!data.applications.length) tb.appendChild(el("tr", null, [el("td", { text: "No applications yet.", colspan: "2" })]));
      $("usage").textContent = "Model calls today: " + data.usage_today.n + " of " + data.daily_cap + " (" + data.usage_today.p + " in / " + data.usage_today.c + " out tokens)";
    } catch (e) {
      if (e.status === 401) return checkSession();
      $("usage").textContent = e.message;
    }
  }

  // ---------- detail ----------
  async function openApp(ref) {
    try {
      current = await api("/api/staff/applications/" + encodeURIComponent(ref));
      renderDetail(current);
      if (current.status === "processing") setTimeout(function () { if (current && current.ref === ref) openApp(ref); }, 2500);
    } catch (e) { $("detail").replaceChildren(el("div", { class: "card" }, [el("div", { class: "notice error", text: e.message })])); }
  }

  function renderDetail(app) {
    var d = $("detail"); d.textContent = "";

    // Header card: request + sketch + facts
    var head = el("section", { class: "card" }, [
      el("div", { class: "row", style: "justify-content:space-between" }, [el("h2", { style: "margin:0", text: app.ref }), chip(app.status, STATUS_LABEL[app.status] || app.status)]),
      el("p", { class: "small", text: "Submitted " + fmt(app.created_at) + ". Resident link: " + location.origin + app.resident_link }),
      el("h3", { text: "Request as written" }),
      el("div", { class: "narrative", text: app.request_text }),
    ]);
    if (app.has_sketch) {
      head.appendChild(el("h3", { text: "Sketch" }));
      head.appendChild(el("img", { class: "sketch-thumb", src: "/api/applications/" + encodeURIComponent(app.ref) + "/sketch", alt: "Resident's sketch" }));
    }
    if (app.status === "error") {
      var rerun = el("button", { type: "button", class: "secondary", text: "Re-run the resident flow" });
      rerun.addEventListener("click", async function () { rerun.disabled = true; try { await api("/api/staff/applications/" + app.ref + "/rerun", { method: "POST" }); openApp(app.ref); } catch (e) { alert(e.message); rerun.disabled = false; } });
      head.appendChild(el("div", { class: "notice error" }, ["The resident flow failed: " + (app.error || "") + " ", rerun]));
    }
    if (app.facts) {
      var ft = el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Item" }), el("th", { text: "Status" }), el("th", { text: "Value" })])])]);
      var tb = el("tbody");
      app.facts.items.forEach(function (f) { tb.appendChild(el("tr", null, [el("td", { text: f.id + " " + f.label }), el("td", null, [chip(f.status)]), el("td", { class: "val", text: f.value || (f.note || "") })])); });
      ft.appendChild(tb);
      head.appendChild(el("details", null, [el("summary", { text: "Extracted facts (" + app.facts.items.filter(function (f) { return f.status === "given"; }).length + " of " + app.facts.items.length + " given)" }), ft]));
    }
    if (app.gaps && app.gaps.gaps.length) {
      head.appendChild(el("h3", { text: "Resident was told to add" }));
      head.appendChild(el("ul", null, app.gaps.gaps.map(function (g) { return el("li", null, [chip(g.status), " ", el("strong", { text: g.label }), ": " + g.what_to_add]); })));
    }
    d.appendChild(head);
    if (app.status === "processing") { d.appendChild(el("div", { class: "card" }, [el("p", { class: "lead", text: "The resident flow is still running. This page refreshes itself." })])); return; }

    // Pre-review card
    var pr = el("section", { class: "card" }, [el("h2", { text: "Agent pre-review" })]);
    var runBtn = el("button", { type: "button", text: app.prereview ? "Run pre-review again" : "Run pre-review" });
    var prMsg = el("span", { class: "small" });
    runBtn.addEventListener("click", async function () {
      runBtn.disabled = true; prMsg.textContent = "Reading the packet against sections 12.01 to 12.11 with tools. About a minute...";
      try { var r = await api("/api/staff/applications/" + app.ref + "/prereview", { method: "POST" }); current.prereview = r.prereview; renderDetail(current); }
      catch (e) { prMsg.textContent = e.message; runBtn.disabled = false; }
    });
    pr.appendChild(el("div", { class: "row" }, [runBtn, prMsg]));
    if (app.prereview) {
      var p = app.prereview;
      pr.appendChild(el("p", { class: "small", text: "Model: " + (p.model || "") + " · " + fmt(p.created_at) + " · met " + p.counts.met + ", not met " + p.counts.not_met + ", cannot verify " + p.counts.cannot_verify + (p.tool_log ? " · " + p.tool_log.length + " tool calls" : "") }));
      pr.appendChild(el("div", { class: "notice", text: p.summary_for_staff }));
      var t = el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Section" }), el("th", { text: "Requirement" }), el("th", { text: "Evidence in packet" }), el("th", { text: "Status" })])])]);
      var ptb = el("tbody");
      p.sections.forEach(function (s) {
        ptb.appendChild(el("tr", null, [
          el("td", { text: s.section + " " + (s.title || "") }),
          el("td", { text: s.requirement }),
          el("td", { class: "val" }, [el("div", { text: s.evidence }), s.note ? el("div", { class: "small", text: s.note }) : null]),
          el("td", null, [chip(s.status)]),
        ]));
      });
      t.appendChild(ptb);
      pr.appendChild(t);
      pr.appendChild(el("p", { class: "small", text: "Status meanings: met = the packet states it and any number is at or above the section's number; not met = the packet states a number below the section's number; cannot verify = nothing in the packet or needs a human. The agent does not recommend a decision." }));
    }
    d.appendChild(pr);

    // Decision card
    var dec = el("section", { class: "card" }, [el("h2", { text: "Your decision on completeness" }), el("p", { class: "small", text: "Pick one. The agent drafts the letter; you edit it before saving. Whether the lot split is approved is for the Planning Commission under section 12.10." })]);
    var note = el("textarea", { placeholder: "Optional note to include in the letter, in your own words.", style: "min-height:80px" });
    var b1 = el("button", { type: "button", class: "secondary", text: "Request more information" });
    var b2 = el("button", { type: "button", text: "Accept as complete and schedule for Planning Commission" });
    var decMsg = el("span", { class: "small" });
    var letterBox = el("div");
    async function decide(decision) {
      b1.disabled = b2.disabled = true; decMsg.textContent = "Drafting the letter...";
      try {
        var r = await api("/api/staff/applications/" + app.ref + "/decision", { method: "POST", body: JSON.stringify({ decision: decision, note: note.value }) });
        decMsg.textContent = "";
        current.status = r.status;
        showLetterEditor(letterBox, app.ref, r.letter);
        loadQueue();
      } catch (e) { decMsg.textContent = e.message; }
      b1.disabled = b2.disabled = false;
    }
    b1.addEventListener("click", function () { decide("request_info"); });
    b2.addEventListener("click", function () { decide("move_to_review"); });
    dec.appendChild(note);
    dec.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [b1, b2, decMsg]));
    dec.appendChild(letterBox);
    d.appendChild(dec);

    // History
    var hist = el("ul", { class: "timeline" }, [el("li", { text: "Submitted " + fmt(app.created_at) })]);
    (app.staff_actions || []).forEach(function (a) {
      var label = { prereview_run: "Pre-review run", request_info: "Decision: request more information", move_to_review: "Decision: accepted as complete, scheduled", letter_saved: "Letter saved" }[a.action] || a.action;
      var li = el("li", null, [el("div", { text: label + " · " + fmt(a.created_at) })]);
      if (a.note) li.appendChild(el("div", { class: "small", text: "Note: " + a.note }));
      if (a.action === "letter_saved" && a.payload) li.appendChild(el("div", { class: "letter" }, [el("strong", { text: a.payload.subject }), el("div", { text: "\n" + a.payload.body })]));
      hist.appendChild(li);
    });
    d.appendChild(el("section", { class: "card" }, [el("h2", { text: "History" }), hist]));
  }

  function showLetterEditor(box, ref, letter) {
    box.textContent = "";
    var subj = el("input", { type: "text", value: letter.subject });
    var body = el("textarea", { style: "min-height:260px" }); body.value = letter.body;
    var save = el("button", { type: "button", text: "Save letter (resident will see it)" });
    var msg = el("span", { class: "small" });
    save.addEventListener("click", async function () {
      save.disabled = true;
      try { await api("/api/staff/applications/" + ref + "/letter", { method: "POST", body: JSON.stringify({ subject: subj.value, body: body.value, decision: letter.decision }) }); msg.textContent = "Saved."; openApp(ref); }
      catch (e) { msg.textContent = e.message; save.disabled = false; }
    });
    box.appendChild(el("h3", { text: "Draft letter (edit before saving)" }));
    box.appendChild(el("label", { text: "Subject" })); box.appendChild(subj);
    box.appendChild(el("label", { text: "Body" })); box.appendChild(body);
    box.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [save, msg]));
  }

  checkSession();
})();
