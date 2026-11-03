// The information page: three tabs, and the sources table drawn from /api/sources. textContent only; no innerHTML.
(function () {
  "use strict";
  var TABS = ["about", "sources", "qa"];
  function show(name) {
    if (TABS.indexOf(name) < 0) name = "about";
    TABS.forEach(function (t) {
      document.getElementById("tab-" + t).setAttribute("aria-selected", t === name ? "true" : "false");
      document.getElementById("panel-" + t).hidden = t !== name;
    });
  }
  TABS.forEach(function (t) {
    document.getElementById("tab-" + t).addEventListener("click", function () { history.replaceState(null, "", "#" + t); show(t); });
  });
  document.getElementById("toSources").addEventListener("click", function (e) { e.preventDefault(); history.replaceState(null, "", "#sources"); show("sources"); });
  show(location.hash.slice(1));

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var rows = [];
  function draw() {
    var dept = document.getElementById("deptFilter").value;
    var body = document.getElementById("sourceRows");
    body.textContent = "";
    var shown = rows.filter(function (r) { return !dept || r.departments.indexOf(dept) > -1 || !r.departments.length; });
    shown.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("td", null, r.used_for));
      tr.appendChild(el("td", null, r.departmentNames));
      var src = el("td");
      src.appendChild(el("div", null, r.government));
      var a = el("a", null, r.title);
      a.href = r.url; a.target = "_blank"; a.rel = "noopener";
      src.appendChild(a);
      tr.appendChild(src);
      tr.appendChild(el("td", null, r.kind));
      var st = el("td");
      st.appendChild(el("span", "status", "Public record"));
      if (r.license) st.appendChild(el("span", "status open", "Open license: " + r.license));
      tr.appendChild(st);
      tr.appendChild(el("td", null, r.how_used));
      body.appendChild(tr);
    });
    document.getElementById("sourceCount").textContent = shown.length + " of " + rows.length + " sources";
  }
  fetch("/api/sources").then(function (r) { return r.json(); }).then(function (d) {
    var names = {};
    d.departments.forEach(function (x) { names[x.id] = x.name; });
    rows = d.sources.map(function (s) {
      var svcs = d.services.filter(function (v) { return v.sources.indexOf(s.id) > -1; });
      var departments = [];
      svcs.forEach(function (v) { if (departments.indexOf(v.department) < 0) departments.push(v.department); });
      return {
        government: s.government, title: s.title, url: s.url, kind: s.kind, license: s.license || "", how_used: s.how_used,
        used_for: s.used_for || svcs.map(function (v) { return v.name; }).join(", "),
        departments: departments,
        departmentNames: departments.length ? departments.map(function (id) { return names[id] || id; }).join(", ") : "All departments",
      };
    });
    var pick = document.getElementById("deptFilter");
    d.departments.forEach(function (x) {
      if (x.id === "front_desk") return;
      var o = el("option", null, x.name);
      o.value = x.id;
      pick.appendChild(o);
    });
    pick.addEventListener("change", draw);
    draw();
  }).catch(function () { document.getElementById("sourceCount").textContent = "The sources could not be loaded."; });
})();
