# The demo video

The 3-minute submission video is built by scripts, from the real live site, so it can be rebuilt any time the app or the words change. Nothing here is part of the app; it uses only Node built-ins, Chrome and ffmpeg (no npm packages).

## The story (an opening statement, then four acts)
0. **Opening statement (about 9 s), in a second voice (`voice` on the scene, Google voice Kore).** CityCenter was built for the Meta Global AI Developer Hackathon, entirely during the event (Oct 26 – Nov 4, 2026).
1. **The problem (about 70 s).** John's opening: "Do you trust your government?" Most people meet government locally (about 91,000 local governments in the U.S., Census of Governments 2022: 90,837). Officials are elected neighbors, residents aren't bureaucrats, but fairness needs a heavy process; when the process is too hard it gets personal and trust breaks. CityCenter lets residents be residents and gives officials the tools to treat everyone the same. Illustrations made with Muse Image (`art/`).
2. **The resident (about 50 s).** A lot-split visit with an invented resident, recorded on the live site: plain words, hand-off to Planning, parcel map, code with verified quotes, SAM 3.1 drawing outlines, a city-style form, signature, submit.
3. **The staff (about 40 s).** The same application in the four-step workspace: what was submitted, the code, point-by-point review with Muse Wonder's second read, the return letter sent back.
4. **The line, the models and the close (about 35 s).** The AI never recommends, predicts or rates; only real city officials decide. Then, in the second voice, a card of the five Meta models that lights up each one as it is named. Last, the live link and code link.

Small labels at the top of the screen name the Meta model doing each job. Sped-up waiting shows a "▶▶ N× speed" badge, so nothing is hidden.

## Files
- `scenes.js`: **the script.** Narration, titles, which part of which recording, and the model labels. Edit words here.
- `capture.js` (+ `capture-base.js`, `lib/cdp.js`): drives Chrome through the live site and records it (`out/capture/`). `node video/capture.js` does all three clips (resident, staff, reply) in about 10 minutes and a few cents of model calls. `--only sign --href "<resident link>"` re-records just the signing.
- `make-art.js`: generates the opening illustrations with Muse Image (`art/`, about $0.01 each). Already done; rerun with `--only <id>` to redraw one.
- `overlay.html`: the look of titles, labels, cards.
- `build.js`: assembles `out/citycenter-demo.mp4` and `out/citycenter-demo.srt` (captions for YouTube). `--draft` is faster; `--only open,idea` previews scenes.
- `recorder.js` + `record.html`: the narration recorder. `node video/recorder.js`, open http://localhost:3100, record each line, press Build. Recordings are saved to `C:\Users\John Barlow\Projects\citycenter-notes\video-voice\` (private, synced through that repo) or `video/voice/` if the notebook isn't on this laptop. Lines without a recording use a Google voice if a key is set, otherwise the Windows computer voice.
- **Google voice instead of a human recording:** put `GOOGLE_TTS_API_KEY` (Google Cloud, with the Cloud Text-to-Speech API turned on) and optionally `GOOGLE_TTS_VOICE` in the git-ignored `.env.google-tts.local` at the project root. `node video/voice-samples.js` reads the opening in eight voices into `out/voice-samples/` to choose from; then `node video/build.js` uses the chosen voice for every line John has not recorded. Meta's models have no text-to-speech, so this is a non-Meta tool used only for the video, which the contest allows.
- Optional `music.mp3` in this folder is mixed in quietly (not committed; use something royalty-free such as the YouTube Audio Library).

## Needs
ffmpeg (`winget install Gyan.FFmpeg`), Chrome or Edge, Node 22+. The staff passcode is read from the project's `.env` (`STAFF_PASSCODE`) and never printed.
