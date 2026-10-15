import { Filter } from "bad-words";

var baseFilter = new Filter();

// list of custom banned words (lowercase)
var CUSTOM = [
  "nigger","nigga","nga","ngger","nggr","ngr",
  "hoe","slut","pussy","dick","faggot"
];

var banned = {};
(function buildBanned() {
  for (var i = 0; i < baseFilter.list.length; i++) {
    var w = (baseFilter.list[i] + "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (w) banned[w] = true;
  }
  for (var j = 0; j < CUSTOM.length; j++) {
    var cw = (CUSTOM[j] + "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cw) banned[cw] = true;
  }
})();

var DIGIT = { "0":"o","1":"i","2":"z","3":"e","4":"a","5":"s","6":"g","7":"t","8":"b","9":"g" };
var SYM = { "@":"a", "$":"s", "!":"i", "|":"i", "+":"t", "(": "c", ")":"c" };

function sanitize(s) {
  if (!s) return "";
  s = (s + "").slice(0, 300);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizeToken(token) {
  var s = (token + "").toLowerCase();
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch >= "a" && ch <= "z") { out += ch; continue; }
    if (ch >= "0" && ch <= "9") { if (DIGIT[ch]) out += DIGIT[ch]; continue; }
    if (SYM[ch]) { out += SYM[ch]; continue; }
    // drop other symbols
  }
  return out;
}

// detectProfanity(text) -> { profane: bool, matched: [tokens], tokens: [{raw,norm}] }
export function detectProfanity(text) {
  if (!text || typeof text !== "string") return { profane: false, matched: [], tokens: [] };
  var clean = sanitize(text);
  if (!clean) return { profane: false, matched: [], tokens: [] };

  var parts = clean.split(/\s+/);
  var matched = [];
  var tokens = [];
  for (var i = 0; i < parts.length; i++) {
    var raw = parts[i];
    var norm = normalizeToken(raw);
    tokens.push({ raw: raw, norm: norm });
    if (!norm) continue;
    if (banned[norm]) matched.push(norm);
  }
  return { profane: matched.length > 0, matched: matched, tokens: tokens };
};

// filter_chat(text) -> masked string (only replaces whole offending tokens)
export function filter_chat(text) {
  if (!text || typeof text !== "string") return "";
  var s = sanitize(text);
  if (!s) return "";

  var parts = s.split(/(\s+)/); // keep spaces
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].trim().length === 0) continue;
    var norm = normalizeToken(parts[i]);
    if (!norm) continue;
    if (banned[norm]) {
      parts[i] = buildMask(norm.length);
    }
  }
  return parts.join("");
};

function buildMask(len) {
  if (!len) return "";
  return "M" + "o".repeat(Math.max(0, len - 1));
}

export function computeMuteDurationMs(offenseNumber) {
  var baseMinutes = 5;
  var n = Math.max(1, Math.floor(Number(offenseNumber) || 1));
  var minutes = baseMinutes * Math.pow(3, n - 1);
  return Math.round(minutes * 60 * 1000);
}

export function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  var secs = Math.floor(ms / 1000);
  var years = Math.floor(secs / (3600 * 24 * 365));
  secs -= years * 3600 * 24 * 365;
  var weeks = Math.floor(secs / (3600 * 24 * 7));
  secs -= weeks * 3600 * 24 * 7;
  var days = Math.floor(secs / (3600 * 24));
  secs -= days * 3600 * 24;
  var hours = Math.floor(secs / 3600);
  secs -= hours * 3600;
  var minutes = Math.floor(secs / 60);
  secs -= minutes * 60;
  var parts = [];
  if (years) parts.push(years + "y");
  if (weeks) parts.push(weeks + "w");
  if (days) parts.push(days + "d");
  if (hours) parts.push(hours + "h");
  if (minutes) parts.push(minutes + "m");
  if (secs && parts.length === 0) parts.push(secs + "s");
  return parts.join(" ");
}
