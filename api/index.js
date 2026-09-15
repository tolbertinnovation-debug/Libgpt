// Entry point for serverless platforms — Vercel and anything that follows the
// same convention.
//
// The whole app lives in server/app.js. This file only hands it over: no
// listener, because the platform owns the socket. `npm start` uses
// server/index.js instead, which does listen.
//
// Two things behave differently here, and the app says so rather than
// pretending otherwise:
//
//   - The per-IP rate limit and the hourly picture ceiling are counted in
//     memory. Each serverless instance keeps its own count and cold starts
//     reset it, so neither is a real ceiling. ACCESS_CODE is the protection
//     that actually holds.
//   - A long answer streams for as long as it takes. If the platform's
//     function timeout is shorter, the stream is cut mid-answer. Raise
//     maxDuration in vercel.json, or host a normal server instead.

import app from '../server/app.js';

export default app;
