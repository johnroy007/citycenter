// Fictional property owners for the demo. Real owner names are public record, but this program never fetches them.
// A parcel always gets the same invented name (hash of the parcel id) so a demo stays consistent. Every name is flagged fictional.
"use strict";
const crypto = require("crypto");

const FIRST = ["Jane", "Ryan", "Maria", "Devon", "Priya", "Tomas", "Elena", "Marcus", "Noor", "Caleb", "Rosa", "Ethan", "Lila", "Omar", "Grace", "Hugo", "Ivy", "Jonah", "Keira", "Luis", "Mae", "Nikhil", "Opal", "Pavel", "Quinn", "Ruth", "Sam", "Tessa", "Uri", "Vera", "Wes", "Yara", "Zane"];
const LAST = ["Alder", "Barlow-Finch", "Castillo", "Dunmore", "Ellery", "Farrow", "Granger", "Holloway", "Ibarra", "Jessup", "Kowalski", "Lindqvist", "Moreno", "Nakamura", "Okafor", "Pemberton", "Quayle", "Rasmussen", "Sato", "Thornbury", "Underhill", "Vasquez", "Whitlock", "Xiong", "Yoder", "Zapata"];

function ownerFor(parcelId) {
  const h = crypto.createHash("sha256").update("citycenter-owner:" + String(parcelId || "").toUpperCase()).digest();
  const first = FIRST[h[0] % FIRST.length];
  const last = LAST[h[1] % LAST.length];
  return { name: `${first} ${last}`, fictional: true, note: "Fictional owner name assigned for the demo; real ownership records are not used." };
}

module.exports = { ownerFor, FIRST, LAST };
