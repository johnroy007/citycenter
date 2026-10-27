// Resident page. Everything from the server is rendered with textContent (never innerHTML), so model output can't inject HTML.
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
  function chip(status, label) { return el("span", { class: "chip " + status, text: label || status.replace(/_/g, " ") }); }

  var STEP_INFO = {
    sketch: ["Read sketch", "Muse Spark looks at your photo"],
    extract: ["Extract facts", "Finds every checklist item"],
    classify: ["Classify", "Which application type, with the code section"],
    draft: ["Draft", "Writes the application from your facts only"],
    check: ["Check completeness", "Agent cites what is missing and why"],
  };
  var STATUS_LABEL = { processing: "Working", draft_ready: "Draft ready", needs_info: "Staff asked for more information", in_review: "Scheduled for Planning Commission", error: "Something went wrong" };

  var state = { ref: null, key: null, timer: null };

  // ---------- image shrink ----------
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL("image/jpeg", 0.85);
        resolve({ mime: "image/jpeg", base64: dataUrl.split(",")[1] });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file could not be read as an image.")); };
      img.src = url;
    });
  }

  // ---------- submit ----------
  $("form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var text = $("text").value.trim();
    var msg = $("formMsg");
    if (text.length < 20) { msg.textContent = "Please write a sentence or two."; return; }
    var btn = $("submit");
    btn.disabled = true; msg.textContent = "Preparing your request...";
    try {
      var payload = { text: text };
      var f = $("image").files[0];
      if (f) {
        msg.textContent = "Shrinking your photo...";
        payload.image = await shrinkImage(f);
      }
      msg.textContent = "Sending...";
      var res = await fetch("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "The server could not take your request.");
      msg.textContent = "";
      open(data.ref, data.view_key, true);
    } catch (e) {
      msg.textContent = e.message || "Something went wrong.";
    }
    btn.disabled = false;
  });

  $("lookup").addEventListener("submit", function (ev) {
    ev.preventDefault();
    open($("lookupRef").value.trim().toUpperCase(), $("lookupKey").value.trim(), true);
  });

  function open(ref, key, pushUrl) {
    state.ref = ref; state.key = key;
    if (pushUrl) history.replaceState(null, "", "/?ref=" + encodeURIComponent(ref) + "&key=" + encodeURIComponent(key));
    $("progress").classList.remove("hidden");
    $("refCode").textContent = ref;
    $("saveLink").textContent = "Save this page's address to come back later: " + location.href;
    $("results").textContent = "";
    poll();
  }

  async function poll() {
    clearTimeout(state.timer);
    try {
      var res = await fetch("/api/applications/" + encodeURIComponent(state.ref) + "?key=" + encodeURIComponent(state.key));
      var app = await res.json();
      if (!res.ok) { $("runError").replaceChildren(el("div", { class: "notice error", text: app.error || "Could not load." })); return; }
      render(app);
      if (app.status === "processing") state.timer = setTimeout(poll, 1800);
    } catch (e) {
      $("runError").replaceChildren(el("div", { class: "notice error", text: "Lost contact with the server. Retrying..." }));
      state.timer = setTimeout(poll, 4000);
    }
  }

  // ---------- render ----------
  function render(app) {
    var sc = chip(app.status, STATUS_LABEL[app.status] || app.status);
    sc.id = "statusChip";
    $("statusChip").replaceWith(sc);
    var steps = $("steps"); steps.textContent = "";
    (app.steps || []).forEach(function (s) {
      var info = STEP_INFO[s.name] || [s.name, ""];
      steps.appendChild(el("div", { class: "step" }, [
        el("div", { class: "row", style: "justify-content:space-between" }, [el("span", { class: "name", text: info[0] }), chip(s.status)]),
        el("div", { class: "desc", text: s.status === "error" && s.error ? s.error : info[1] }),
      ]));
    });
    $("runError").textContent = "";
    if (app.status === "error") $("runError").appendChild(el("div", { class: "notice error", text: "The assistant hit a problem: " + (app.error || "unknown error") + ". Your request is saved under this reference; staff can re-run it." }));

    var out = $("results"); out.textContent = "";
    if (!app.facts) return;

    // Decision notice
    if (app.classification && app.classification.asked_whether_allowed) {
      out.appendChild(el("section", { class: "card" }, [
        el("h2", { text: "About your question" }),
        el("div", { class: "notice", text: app.classification.answer_to_resident }),
      ]));
    }

    // Packet
    if (app.draft) {
      var fieldsTable = el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Item" }), el("th", { text: "Your answer" })])])]);
      var tb = el("tbody");
      app.draft.fields.forEach(function (f) {
        tb.appendChild(el("tr", null, [el("td", { text: f.label }), el("td", { class: "val" }, [f.blank ? el("span", { class: "blank", text: "[blank: " + f.blank_reason + "]" }) : f.value])]));
      });
      fieldsTable.appendChild(tb);
      out.appendChild(el("section", { class: "card" }, [
        el("div", { class: "row no-print", style: "justify-content:space-between" }, [el("h2", { text: "Your application packet" }), el("button", { class: "secondary", type: "button", id: "printBtn", text: "Print or save as PDF" })]),
        el("p", { class: "small", text: (app.classification ? "Application type: " + prettyType(app.classification.application_type) + " under section " + app.classification.section + ". " + app.classification.reason : "") }),
        el("h3", { text: app.draft.project_title }),
        el("div", { class: "narrative", text: app.draft.narrative }),
        el("h3", { text: "Application fields" }),
        fieldsTable,
      ]));
      $("printBtn").addEventListener("click", function () { window.print(); });
    }

    // Gaps
    if (app.gaps) {
      var g = app.gaps;
      var card = el("section", { class: "card" }, [el("h2", { text: g.ready_to_file ? "Nothing missing" : "Before you file: " + g.missing_count + " missing, " + g.unclear_count + " unclear" })]);
      if (g.gaps.length) {
        var ul = el("ul", { class: "gaps" });
        g.gaps.forEach(function (x) {
          ul.appendChild(el("li", null, [
            el("div", { class: "row" }, [chip(x.status), el("strong", { text: x.label })]),
            el("div", { text: x.what_to_add }),
            el("div", { class: "why", text: x.why + (x.section ? " (section " + x.section + ")" : "") }),
          ]));
        });
        card.appendChild(ul);
      }
      if (g.arithmetic_notes && g.arithmetic_notes.length) {
        card.appendChild(el("h3", { text: "Numbers checked against the code" }));
        card.appendChild(el("ul", null, g.arithmetic_notes.map(function (t) { return el("li", { text: t }); })));
        card.appendChild(el("p", { class: "small", text: "These are facts from the arithmetic tool. Whether the split is approved is decided by the Planning Commission, not by this tool." }));
      }
      card.appendChild(el("h3", { text: "What happens next" }));
      card.appendChild(el("p", { text: g.what_happens_next || "" }));
      if (g.checks_performed && g.checks_performed.length) {
        var det = el("details", null, [el("summary", { text: "What the agent checked (" + (g.tool_log ? g.tool_log.length : 0) + " tool calls)" })]);
        det.appendChild(el("ul", { class: "toollog" }, g.checks_performed.map(function (t) { return el("li", { text: t }); })));
        card.appendChild(det);
      }
      out.appendChild(card);
    }

    // Facts table
    var ft = el("table", null, [el("thead", null, [el("tr", null, [el("th", { text: "Checklist item" }), el("th", { text: "Status" }), el("th", { text: "Value" }), el("th", { text: "Where it came from" })])])]);
    var ftb = el("tbody");
    app.facts.items.forEach(function (f) {
      ftb.appendChild(el("tr", null, [el("td", { text: f.id + " " + f.label }), el("td", null, [chip(f.status)]), el("td", { class: "val", text: f.value || "" }), el("td", { class: "small", text: f.note || f.source || "" })]));
    });
    ft.appendChild(ftb);
    out.appendChild(el("section", { class: "card" }, [el("h2", { text: "Facts found in your request" + (app.has_sketch ? " and sketch" : "") }), el("p", { class: "small", text: app.facts.summary }), ft]));

    // Staff letters and timeline
    var tl = el("ul", { class: "timeline" }, [el("li", { text: "Submitted " + fmt(app.created_at) })]);
    (app.staff_actions || []).forEach(function (a) {
      if (a.action === "letter_saved" && a.payload) {
        tl.appendChild(el("li", null, [el("div", { text: "Letter from town staff, " + fmt(a.created_at) }), el("div", { class: "letter" }, [el("strong", { text: a.payload.subject }), el("div", { text: "\n" + a.payload.body })])]));
      }
    });
    out.appendChild(el("section", { class: "card" }, [el("h2", { text: "Timeline" }), tl]));
  }

  function prettyType(t) {
    return ({ lot_split: "Lot Split", subdivision_four_or_more_lots: "Subdivision (four or more lots; not covered by Chapter 12)", zoning_change: "Zoning change (not covered by Chapter 12)", line_adjustment_no_new_lot: "Lot line adjustment (no new lot)", other: "Other", unclear: "Unclear" })[t] || t;
  }
  function fmt(iso) { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } }

  // Open from URL
  var params = new URLSearchParams(location.search);
  if (params.get("ref") && params.get("key")) open(params.get("ref"), params.get("key"), false);
})();
