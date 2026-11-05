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
  /** The application's attachments. The form ticks these, and Print / save PDF includes every ticked one. */
  function attachments(s, isService) {
    return [
      { id: "sketch", label: isService ? "Photo or drawing" : "Site sketch or drawing", on: !!s.has_sketch },
      { id: "plan", label: "Concept site plan, to scale (not a survey)", on: !!s.site_plan },
      { id: "map", label: isService ? "Map showing the location" : "Zoning map excerpt showing the parcel", on: !!(isService ? s.pin || s.parcel : s.parcel) },
      { id: "record", label: "Record of the help desk conversation", on: true },
    ].concat(isService ? [] : [{ id: "code", label: "Code review with cited sections", on: !!s.research }], [{ id: "docs", label: "Supporting documents you attached", on: !!(s.documents && s.documents.length) }]);
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

  // A certified question has the same shape as a service form, at whichever desk it was asked.
  function serviceOf(town, d, s) {
    if (d.doc_type === "certified_question") { var q = deptOf(town, s.department); return { id: d.doc_type, department: s.department, kind: "question", signature: false, certified: true, decider: (q ? q.name : "City") + " staff" }; }
    return ((town && town.services) || []).find(function (x) { return x.id === d.doc_type; }) || null;
  }
  function deptOf(town, id) { return ((town && town.departments) || []).find(function (x) { return x.id === id; }) || null; }

  function page(town, s, d, di, total, opts) {
    opts = opts || {};
    var office = (town && town.office) || {};
    var editing = !!opts.editing;
    var svc = serviceOf(town, d, s);
    var dept = svc ? deptOf(town, svc.department) : null;
    var sec = 0;
    function head(text) { sec += 1; return el("h3", { class: "fsec", text: sec + ". " + text }); }
    var pg = el("article", { class: "form-page" });
    pg.appendChild(el("div", { class: "letterhead" }, [
      el("div", { class: "seal", text: (town && town.refPrefix ? town.refPrefix : "TC").slice(0, 3).toUpperCase() }),
      el("div", null, [el("div", { class: "city", text: (office.cityLine || (town && town.name) || "City").toUpperCase() }), el("div", { class: "dept", text: dept ? dept.name : office.department || "Planning & Zoning Department" }), el("div", { class: "addr", text: [office.addressLine, office.phone].filter(Boolean).join(" · ") })]),
      el("div", { class: "appno" }, [el("div", { class: "small", text: svc ? (svc.certified ? "Question No." : "Request No.") : "Application No." }), el("div", { class: "num", text: s.ref }), el("div", { class: "small", text: "Page " + (di + 1) + " of " + total })]),
    ]));
    pg.appendChild(el("div", { class: "form-title" }, [el("h2", { text: d.name }), el("div", { class: "small", text: svc && svc.certified ? "A question for city staff to answer in writing. This is not an application." : svc ? "Sample form of the example city of " + (town ? town.name : "") + (d.section ? ". Related code: section " + d.section : "") : d.section ? "Filed under " + (town ? town.name : "city") + " Code section " + d.section : "" })]));
    var u = s.understanding || {};
    var ap = u.applicant || {};
    pg.appendChild(head(svc ? "Requester" : "Applicant"));
    pg.appendChild(el("div", { class: "fgrid" }, [
      formField(svc ? "Name" : "Applicant name", svc ? firstField(d, /^your name/i) : ap.name || firstField(d, /applicant|name/i)),
      formField("Phone", svc ? firstField(d, /^phone/i) : ap.phone || firstField(d, /phone/i)),
      formField("Email", svc ? firstField(d, /^email/i) : ap.email || firstField(d, /e-?mail/i)),
      formField("Date prepared", fmtDate(s.submitted_at || s.updated_at)),
    ]));
    var pr = s.parcel || {};
    if (svc && s.pin) {
      pg.appendChild(head("Location"));
      pg.appendChild(el("div", { class: "fgrid" }, [formField("Closest address", s.pin.address || ""), formField("Street", s.pin.road || ""), formField("Map pin", s.pin.lat.toFixed(5) + ", " + s.pin.lon.toFixed(5)), formField("Marked by", s.pin.from === "map" ? "Resident, on the map" : "From the address given")]));
      pg.appendChild(el("img", { class: "pinimg", src: "/api/map/area.svg?lon=" + s.pin.lon + "&lat=" + s.pin.lat + "&m=120&pin=" + s.pin.lon + "," + s.pin.lat, alt: "Map showing the marked spot" }));
    } else if (!svc || s.parcel) {
    pg.appendChild(head("Property"));
    pg.appendChild(el("div", { class: "fgrid" }, [
      formField("Site address", pr.address || (u.location && u.location.address_text) || ""),
      formField("Tax parcel number", pr.id || (u.location && u.location.parcel_id_text) || ""),
      formField("Zoning district", pr.zone ? pr.zone + (pr.zoneName ? " · " + pr.zoneName : "") : ""),
      formField("Lot size", pr.areaAcres ? pr.areaAcres + " acres" + (pr.areaSqft ? " (" + pr.areaSqft.toLocaleString() + " sq ft)" : "") : ""),
      formField("Owner of record", s.owner ? s.owner.name + " (fictional demo name)" : ""),
      formField("Applicant is the owner", u.location && u.location.is_own_property === true ? "Yes" : u.location && u.location.is_own_property === false ? "No" : ""),
    ]));
    }
    var types = el("div", { class: "cbgrid" });
    if (!(svc && svc.certified)) pg.appendChild(head("Type of request"));
    var at = (town && town.applicationTypes) || {};
    var checkedAny = false;
    if (svc && svc.certified) checkedAny = true;
    else if (svc) { checkedAny = true; town.services.filter(function (x) { return x.department === svc.department; }).forEach(function (x) { types.appendChild(checkbox(x.name, x.id === svc.id)); }); }
    else Object.keys(at).forEach(function (id) { var on = id === d.doc_type; if (on) checkedAny = true; types.appendChild(checkbox(at[id].name, on)); });
    (svc ? [] : ["zoning_verification_request", "complaint_report", "referral"]).forEach(function (id) { var on = id === d.doc_type; if (on) checkedAny = true; types.appendChild(checkbox((town && town.packetTypes && town.packetTypes[id]) || id.replace(/_/g, " "), on)); });
    if (!checkedAny) types.appendChild(checkbox("Other: " + d.name, true));
    if (!(svc && svc.certified)) pg.appendChild(types);
    pg.appendChild(head(svc ? (svc.certified ? "Question" : "Details") : "Application details"));
    var grid4 = el("div", { class: "fgrid" });
    (d.fields || []).forEach(function (f, fi) {
      // A service form shows who and where in its own sections above; they stay editable here.
      if (svc && !editing && (f.source === "map_pin" || f.source === "parcel_record" && svc.certified || /^(your name|phone|email)$/i.test(f.label))) return;
      var wide = (f.value || "").length > 60 || /description|statement|reason|explain|legal/i.test(f.label);
      if (editing) {
        var inp = el("input", { class: "field", type: "text", value: f.value || "", "data-doc": String(di), "data-field": String(fi) });
        grid4.appendChild(formField(f.label + (f.required ? " *" : ""), "", { input: inp, wide: wide }));
      } else grid4.appendChild(formField(f.label + (f.required ? " *" : ""), f.value, { wide: wide, src: f.source && f.source !== "blank" ? f.source : null }));
    });
    pg.appendChild(grid4);
    pg.appendChild(head(svc ? (svc.certified ? "My understanding" : "Statement") : "Project description and statement"));
    if (editing) { var ta = el("textarea", { "data-doc": String(di), "data-narrative": "1" }); ta.value = d.narrative || ""; pg.appendChild(ta); }
    else pg.appendChild(el("div", { class: "narrative", text: d.narrative || "" }));
    var basis = (d.code_basis || []).filter(function (c) { return c.quote || c.section; });
    if (basis.length) {
      pg.appendChild(head(svc ? "Real code sections that relate to this" : "Code sections this application is made under"));
      basis.forEach(function (c) {
        pg.appendChild(el("div", { class: "quote" }, [c.quote ? el("span", { text: "“" + c.quote + "”" }) : null, el("span", { class: "cite" }, [el("a", { href: c.url || "#", target: "_blank", rel: "noopener", text: "Section " + c.section }), c.quote ? " · " + (c.quote_verified ? "quote verified against the code text" : "unverified") : ""])]));
      });
    }
    if (!(svc && svc.certified)) pg.appendChild(head("Attachments"));
    if (!(svc && svc.certified)) pg.appendChild(el("div", { class: "cbgrid" }, attachments(s, !!svc).map(function (a) { return checkbox(a.label, a.on); })));
    if (!svc || svc.signature) pg.appendChild(el("div", { class: "certify" }, [
      el("p", { text: "I certify that the information in this application is true and complete to the best of my knowledge, and I authorize city staff to visit the property for the purpose of reviewing this application." }),
      signatureLines(s, opts.sigSrc),
    ]));
    else pg.appendChild(el("p", { class: "small", text: "No signature is needed for this " + svc.kind + "." }));
    var tier = s.research ? tierInfo(town, s.research.process_tier) : null;
    pg.appendChild(el("div", { class: "office-use" }, [
      el("div", { class: "ou-title", text: "For office use only" }),
      el("div", { class: "fgrid" }, [formField("Received by", ""), formField("Date received", s.submitted_at ? fmtDate(s.submitted_at) : ""), formField("Fee paid", ""), formField("Application complete", ""), formField("Decision body", svc ? svc.decider : tier ? tier.decider : ""), formField("Staff reference", s.ref)]),
    ]));
    pg.appendChild(el("p", { class: "small foot", text: office.formFooter || "" }));
    return pg;
  }
  window.CCForm = { page: page, fmtDate: fmtDate, attachments: attachments };
})();
