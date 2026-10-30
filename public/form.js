// The application form, rendered the same way for the resident and for staff. textContent only; no innerHTML.
// CCForm.page(town, session, document, index, total, { editing, sigSrc }) returns one printed-style page.
(function () {
  "use strict";
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
  function fmtDate(iso) { try { return new Date(iso || Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); } catch (e) { return ""; } }
  function tierInfo(town, id) { return (town && town.processTiers || []).find(function (t) { return t.id === id; }); }
  function firstField(d, re) { var f = (d.fields || []).find(function (x) { return re.test(x.label) && x.value; }); return f ? f.value : ""; }
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
  function signatureLines(s, sigSrc) {
    var sig = s.signature;
    var current = !!s.signature_current;
    var appl = el("div", { class: "sig" + (sig ? " signed" : "") });
    var date = el("div", { class: "sig short" + (sig ? " signed" : "") });
    if (sig && sigSrc) {
      appl.appendChild(el("img", { class: "sigimg", src: sigSrc, alt: "Signature of " + sig.name }));
      appl.appendChild(el("span", { text: "Applicant signature · " + sig.name + " (electronic, " + sig.method + ")" + (current ? "" : " · signed an earlier version") }));
      date.appendChild(el("div", { class: "sigdate", text: fmtDate(sig.signed_at) }));
      date.appendChild(el("span", { text: "Date" }));
    } else {
      appl.appendChild(el("span", { text: "Applicant signature" }));
      date.appendChild(el("span", { text: "Date" }));
    }
    return el("div", { class: "siglines" }, [appl, date, el("div", { class: "sig" }, [el("span", { text: "Owner signature (if different)" })]), el("div", { class: "sig short" }, [el("span", { text: "Date" })])]);
  }

  function page(town, s, d, di, total, opts) {
    opts = opts || {};
    var office = (town && town.office) || {};
    var editing = !!opts.editing;
    var pg = el("article", { class: "form-page" });
    pg.appendChild(el("div", { class: "letterhead" }, [
      el("div", { class: "seal", text: (town && town.refPrefix ? town.refPrefix : "HC").slice(0, 3).toUpperCase() }),
      el("div", null, [el("div", { class: "city", text: (office.cityLine || (town && town.name) || "City").toUpperCase() }), el("div", { class: "dept", text: office.department || "Planning & Zoning Department" }), el("div", { class: "addr", text: [office.addressLine, office.phone].filter(Boolean).join(" · ") })]),
      el("div", { class: "appno" }, [el("div", { class: "small", text: "Application No." }), el("div", { class: "num", text: s.ref }), el("div", { class: "small", text: "Page " + (di + 1) + " of " + total })]),
    ]));
    pg.appendChild(el("div", { class: "form-title" }, [el("h2", { text: d.name }), el("div", { class: "small", text: d.section ? "Filed under " + (town ? town.name : "city") + " Code section " + d.section : "" })]));
    var u = s.understanding || {};
    var ap = u.applicant || {};
    pg.appendChild(el("h3", { class: "fsec", text: "1. Applicant" }));
    pg.appendChild(el("div", { class: "fgrid" }, [
      formField("Applicant name", ap.name || firstField(d, /applicant|name/i)),
      formField("Phone", ap.phone || firstField(d, /phone/i)),
      formField("Email", ap.email || firstField(d, /e-?mail/i)),
      formField("Date prepared", fmtDate(s.submitted_at || s.updated_at)),
    ]));
    var pr = s.parcel || {};
    pg.appendChild(el("h3", { class: "fsec", text: "2. Property" }));
    pg.appendChild(el("div", { class: "fgrid" }, [
      formField("Site address", pr.address || (u.location && u.location.address_text) || ""),
      formField("Tax parcel number", pr.id || (u.location && u.location.parcel_id_text) || ""),
      formField("Zoning district", pr.zone ? pr.zone + (pr.zoneName ? " · " + pr.zoneName : "") : ""),
      formField("Lot size", pr.areaAcres ? pr.areaAcres + " acres" + (pr.areaSqft ? " (" + pr.areaSqft.toLocaleString() + " sq ft)" : "") : ""),
      formField("Owner of record", s.owner ? s.owner.name + " (fictional demo name)" : ""),
      formField("Applicant is the owner", u.location && u.location.is_own_property === true ? "Yes" : u.location && u.location.is_own_property === false ? "No" : ""),
    ]));
    pg.appendChild(el("h3", { class: "fsec", text: "3. Type of request" }));
    var types = el("div", { class: "cbgrid" });
    var at = (town && town.applicationTypes) || {};
    var checkedAny = false;
    Object.keys(at).forEach(function (id) { var on = id === d.doc_type; if (on) checkedAny = true; types.appendChild(checkbox(at[id].name, on)); });
    ["zoning_verification_request", "complaint_report", "referral"].forEach(function (id) { var on = id === d.doc_type; if (on) checkedAny = true; types.appendChild(checkbox((town && town.packetTypes && town.packetTypes[id]) || id.replace(/_/g, " "), on)); });
    if (!checkedAny) types.appendChild(checkbox("Other: " + d.name, true));
    pg.appendChild(types);
    pg.appendChild(el("h3", { class: "fsec", text: "4. Application details" }));
    var grid4 = el("div", { class: "fgrid" });
    (d.fields || []).forEach(function (f, fi) {
      var wide = (f.value || "").length > 60 || /description|statement|reason|explain|legal/i.test(f.label);
      if (editing) {
        var inp = el("input", { class: "field", type: "text", value: f.value || "", "data-doc": String(di), "data-field": String(fi) });
        grid4.appendChild(formField(f.label, "", { input: inp, wide: wide }));
      } else grid4.appendChild(formField(f.label, f.value, { wide: wide, src: f.source && f.source !== "blank" ? f.source : null }));
    });
    pg.appendChild(grid4);
    pg.appendChild(el("h3", { class: "fsec", text: "5. Project description and statement" }));
    if (editing) { var ta = el("textarea", { "data-doc": String(di), "data-narrative": "1" }); ta.value = d.narrative || ""; pg.appendChild(ta); }
    else pg.appendChild(el("div", { class: "narrative", text: d.narrative || "" }));
    var basis = (d.code_basis || []).filter(function (c) { return c.quote || c.section; });
    if (basis.length) {
      pg.appendChild(el("h3", { class: "fsec", text: "6. Code sections this application is made under" }));
      basis.forEach(function (c) {
        pg.appendChild(el("div", { class: "quote" }, [c.quote ? el("span", { text: "“" + c.quote + "”" }) : null, el("span", { class: "cite" }, [el("a", { href: c.url || "#", target: "_blank", rel: "noopener", text: "Section " + c.section }), c.quote ? " · " + (c.quote_verified ? "quote verified against the code text" : "unverified") : ""])]));
      });
    }
    pg.appendChild(el("h3", { class: "fsec", text: (basis.length ? "7" : "6") + ". Attachments" }));
    pg.appendChild(el("div", { class: "cbgrid" }, [
      checkbox("Site sketch or drawing", !!s.has_sketch),
      checkbox("Zoning map excerpt showing the parcel", !!s.parcel),
      checkbox("Record of the help desk conversation", true),
      checkbox("Code review with cited sections", !!s.research),
    ]));
    pg.appendChild(el("div", { class: "certify" }, [
      el("p", { text: "I certify that the information in this application is true and complete to the best of my knowledge, and I authorize city staff to visit the property for the purpose of reviewing this application." }),
      signatureLines(s, opts.sigSrc),
    ]));
    var tier = s.research ? tierInfo(town, s.research.process_tier) : null;
    pg.appendChild(el("div", { class: "office-use" }, [
      el("div", { class: "ou-title", text: "For office use only" }),
      el("div", { class: "fgrid" }, [formField("Received by", ""), formField("Date received", s.submitted_at ? fmtDate(s.submitted_at) : ""), formField("Fee paid", ""), formField("Application complete", ""), formField("Decision body", tier ? tier.decider : ""), formField("Staff reference", s.ref)]),
    ]));
    pg.appendChild(el("p", { class: "small foot", text: office.formFooter || "" }));
    return pg;
  }
  window.CCForm = { page: page, fmtDate: fmtDate };
})();
