# CityCenter

## What this is
The smallest possible test app: a one-page Node.js web server. You type text, click Send, the server sends it to Muse Spark through the Meta Model API (OpenAI-compatible), and the reply shows on the page.

## Stack
- Node.js only (built-in `http` + `fetch`) — no packages to install.
- Meta Model API: `https://api.meta.ai/v1/chat/completions`, model `muse-spark-1.3` (latest Muse Spark).

## How to run it locally
1. Copy `.env.example` to a new file named `.env`.
2. Paste your Meta key in `.env` after `MODEL_API_KEY=`.
3. Run `npm start`, then open http://localhost:3000 in a browser.

## Where the important things are
- `server.js` — the whole app (server + page). Reads the key from `.env` on the server only; the key is never sent to the browser.
- `.env.example` — shows the variable name (`MODEL_API_KEY`) with no real key.
- `.env` — your real key lives here. It is in `.gitignore` and must never be committed.

## Deploys
None — this is a local test app only.

## Project rules
- Never put a real API key in code, the web page, or git. Server-side `.env` only.
