// Shows a visit's concept site plan at its true printed size. The address carries the visit's reference.
(function () {
  "use strict";
  var params = new URLSearchParams(location.search), plan = document.getElementById("plan");
  // Opened in the background by the page's Download and print button: go straight to the print window.
  if (params.get("print") === "1") plan.addEventListener("load", function () { window.print(); });
  plan.src = "/api/sessions/" + encodeURIComponent(params.get("ref") || "") + "/siteplan.svg";
  document.getElementById("print").addEventListener("click", function () { window.print(); });
  document.getElementById("back").addEventListener("click", function () { if (history.length > 1) history.back(); else location.href = "/"; });
})();
