// Electronic signature helpers shared by the server and the seed scripts.
// A signature is bound to the exact application text by a hash; if the documents change, it must be signed again.
"use strict";
const crypto = require("crypto");

const CONSENT_TEXT =
  "I certify that the information in this application is true and complete to the best of my knowledge, " +
  "I authorize city staff to visit the property for the purpose of reviewing this application, " +
  "and I agree that my electronic signature has the same effect as my handwritten signature.";

/** Fingerprint of the documents as they stand (fields and narratives). */
function docHash(packet) {
  const docs = (packet && packet.documents) || [];
  const slim = docs.map((d) => ({ doc_type: d.doc_type, name: d.name, fields: (d.fields || []).map((f) => [f.label, f.value || ""]), narrative: d.narrative || "" }));
  return crypto.createHash("sha256").update(JSON.stringify(slim)).digest("hex");
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** A typed signature rendered as an SVG image (script typeface), so typed and drawn signatures are stored the same way. */
function typedSignatureSvg(name) {
  const text = escapeXml(String(name).slice(0, 80));
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160">' +
    '<rect width="640" height="160" fill="white"/>' +
    `<text x="24" y="104" font-family="Segoe Script, Brush Script MT, Snell Roundhand, cursive" font-size="54" fill="#1a237e">${text}</text>` +
    '<line x1="24" y1="128" x2="616" y2="128" stroke="#9aa4b2" stroke-width="1"/>' +
    "</svg>"
  );
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
}

module.exports = { CONSENT_TEXT, docHash, typedSignatureSvg, isPng };
