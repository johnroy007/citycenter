// The same relay for Deno Deploy (https://dash.deno.com, free). Paste this whole file into a new
// playground project and press Save & Deploy. Set RELAY_SECRET under the project's Settings > Environment Variables.
import worker from "./worker.js";

Deno.serve((request) => worker.fetch(request, { RELAY_SECRET: Deno.env.get("RELAY_SECRET") || "" }));
