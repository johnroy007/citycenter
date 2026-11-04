// Shows a visit's concept site plan at its true printed size. The address carries the visit's reference.
(function () {
  "use strict";
  var ref = new URLSearchParams(location.search).get("ref") || "";
  document.getElementById("plan").src = "/api/sessions/" + encodeURIComponent(ref) + "/siteplan.svg";
  document.getElementById("print").addEventListener("click", function () { window.print(); });
})();
