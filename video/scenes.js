// The demo video, scene by scene. This file is the script: change the words here and rebuild.
// Each scene has the narration (what the voice says), what is on screen, and optional callouts.
//   art:      an illustration from video/art/ (slow zoom), with a title.
//   clip:     part of a screen recording from video/capture.js, between two markers. `segs` share the scene's time
//             by `w` (weight; a seg may name its own `clip`); the recording is sped up or slowed to fit. A "fast-forward" badge shows when sped up.
//   card:     a full-screen text card (see video/overlay.html).
// Callouts are the small labels that name the Meta model doing the work: { at: seconds into scene, dur, model, text }.
// Scene length = the narration's length plus a little air (or `min` seconds if longer), so the voice drives the timing.
"use strict";

const INTRO_VOICE = "en-US-Chirp3-HD-Kore"; // a second voice for the opening statement (Google voice five)

module.exports = [
  // ---------- Opening statement, in a second voice: built during the event, and the Meta models it uses (about 30 s) ----------
  {
    id: "built", card: "built", fadeIn: 0.6, voice: INTRO_VOICE,
    say: "CityCenter was built for the Meta Global AI Developer Hackathon, entirely during the dates of the event, October twenty-sixth to November fourth, twenty twenty-six.",
  },
  {
    id: "models", card: "models", fadeOut: 0.5, voice: INTRO_VOICE,
    say: "It runs on Meta's models. Muse Spark understands each request, searches the city code and county maps with tool calls, fills in forms, and prepares staff reviews. SAM 3.1 outlines drawings. Muse Voice Transcribe lets residents talk instead of type. Muse Wonder gives staff a second read. And Muse Image drew the characters and this video's art.",
    rows: [
      { model: "Muse Spark", text: "understands requests · searches the code and county maps with tool calls · fills in forms · prepares staff reviews" },
      { model: "SAM 3.1", text: "outlines the shapes in residents' drawings" },
      { model: "Muse Voice Transcribe", text: "residents talk instead of typing" },
      { model: "Muse Wonder", text: "a second read for staff" },
      { model: "Muse Image", text: "drew the characters, the office and this video's art" },
    ],
  },

  // ---------- Act 1: the problem (about 70 s). Opening words are John's. ----------
  {
    id: "open", art: "town", fadeIn: 0.8,
    title: "Do you trust your government?",
    say: "Do you trust your government? You probably just pictured a fight in Washington, or at your state capitol. But that's not where most people actually meet their government.",
  },
  {
    id: "local", art: "local",
    title: "About 91,000 local governments in the U.S. That's where most people meet their government.",
    say: "There are about ninety-one thousand local governments in the United States. That's where trust is won or lost. Could AI help build it there first?",
  },
  {
    id: "official", art: "official",
    title: "Local officials: public servants, elected by neighbors, not bureaucracy experts.",
    say: "Here's the trust gap. Local officials are public servants at heart, elected to represent their neighbors, not for their skill with bureaucracy.",
  },
  {
    id: "resident", art: "resident",
    title: "Residents just want to be treated fairly.",
    say: "Residents aren't bureaucrats either. They just want to be treated fairly.",
  },
  {
    id: "fair", art: "fair",
    title: "Fairness takes process: predictable rules, transparency, accountability.",
    say: "But fairness takes a heavy, technical process: predictable rules, transparency and accountability, treating everyone the same while accounting for every difference.",
  },
  {
    id: "personal", art: "personal",
    title: "When the process gets personal, trust breaks down.",
    say: "When that process is too hard for both sides, it gets personal, and people wonder if they were treated the same as everyone else.",
  },
  {
    id: "idea", art: "together", fadeOut: 0.5,
    title: "CityCenter: residents get to be residents. Officials get the tools to treat everyone fairly.",
    say: "What if Meta's AI let residents just be residents, and gave local officials the tools to treat everyone fairly, without becoming administrative experts? That's CityCenter. It stands in the space between them.",
  },

  // ---------- Act 2: the resident's visit, recorded on the live site (about 55 s) ----------
  {
    id: "ask", fadeIn: 0.5,
    clip: "resident", segs: [{ from: "home", to: "sent1", w: 1.3 }, { from: "sent1", to: "juniper-asks", w: 1 }],
    say: "Here's a real visit on the live site. Devon wants to split his lot and sell the back half to his son. He says it in his own words, and the front desk sends him to Planning.",
    callouts: [
      { at: 0.6, dur: 6, model: "Live site", text: "citycenter-puh5.onrender.com · Trust City" },
      { at: 6.5, dur: 5.5, model: "Muse Spark", text: "understands the request and finds the right desk" },
    ],
  },
  {
    id: "details",
    clip: "resident", segs: [{ from: "juniper-asks", to: "typed2", w: 1 }, { from: "sent2", to: "drafted", w: 1.4 }],
    say: "He gives his address and a hand-drawn sketch. The planner finds his parcel on the county's zoning map and searches all eight hundred sixty-five sections of the city's code.",
    callouts: [
      { at: 0.5, dur: 5, model: "Muse Voice Transcribe", text: "residents can hold the mic and talk instead of typing" },
      { at: 6, dur: 7, model: "Muse Spark · tool calls", text: "county parcel and zoning layers · 865 sections of the city's code" },
    ],
  },
  {
    id: "channels",
    clip: "resident", segs: [{ from: "ch:map", to: "ch:code", w: 1 }, { from: "ch:code", to: "ch:submissions", w: 1 }, { from: "ch:submissions", to: "ch:paperwork", w: 1 }, { from: "ch:paperwork", to: "sign-open", w: 1.2 }],
    say: "Every quote is checked, word for word, against the code. SAM 3.1 outlines his drawing. Then Juniper fills out the application, in the city's own form.",
    callouts: [
      { at: 0.4, dur: 4, model: "Real public data", text: "Washington County zoning · Utah parcel layer · owner names are fictional" },
      { at: 4.6, dur: 4, model: "Verified quotes", text: "every quote is matched to the stored code text" },
      { at: 9, dur: 4, model: "SAM 3.1", text: "outlines the shapes in the resident's drawing" },
      { at: 13.2, dur: 5, model: "Muse Spark · structured output", text: "fills in the city's application form" },
    ],
  },
  {
    id: "sign", min: 6.5,
    clip: "resident", segs: [{ from: "sign-open", to: "end", w: 1 }],
    say: "Devon reads it, signs it, and submits it.",
  },

  // ---------- Act 3: the staff side (about 45 s) ----------
  {
    id: "staff1", fadeIn: 0.3,
    clip: "staff", segs: [{ from: "queue", to: "open", w: 0.6 }, { from: "open", to: "step2-click", w: 1.4 }],
    say: "For the city's planner, the same application arrives in a four-step workspace. First: exactly what was submitted, with the facts pulled out.",
    callouts: [{ at: 1, dur: 6, model: "Staff workspace", text: "review in four steps · the agent prepares, staff decide" }],
  },
  {
    id: "staff2", min: 7,
    clip: "staff", segs: [{ from: "step2-click", to: "step3-click", w: 1 }],
    say: "Second: the code that applies, summarized, with the exact text.",
  },
  {
    id: "staff3",
    clip: "staff", segs: [{ from: "step3-click", to: "point-open", w: 0.8 }, { from: "point-open", to: "second-click", w: 1.6 }, { from: "second-click", to: "step4-click", w: 0.8 }],
    say: "Third: point by point, the requirement, the exact quote, and what the application says. The planner decides each point. Muse Wonder gives a second read.",
    callouts: [
      { at: 0.5, dur: 6, model: "Muse Spark · tool calls", text: "lists every point a planner checks, with the exact code" },
      { at: 9.5, dur: 5, model: "Muse Wonder", text: "a second read of the list against the code" },
    ],
  },
  {
    id: "staff4",
    clip: "staff", segs: [{ from: "step4-click", to: "end", w: 1.2 }, { clip: "reply", from: "start", to: "end", w: 0.8 }],
    say: "Fourth: a return letter, written from the planner's decisions, and sent back to Devon.",
  },

  // ---------- Act 4: the line it never crosses, and the close (about 25 s) ----------
  {
    id: "line", card: "line", fadeIn: 0.4,
    say: "The AI never recommends a decision, never predicts the outcome, and never rates the person. Only real city officials decide.",
  },
  {
    id: "close", card: "close", fadeOut: 1.2,
    say: "CityCenter. Meta's AI carries the process, so every neighbor gets the same fair process.",
  },
];
