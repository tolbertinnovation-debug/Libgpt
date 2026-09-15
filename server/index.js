// Starts Grandpa AI on a port — local machines, Render, Railway, Fly, or any
// host that runs a long-lived process. Serverless platforms use api/index.js
// instead, which imports the same app without listening.

import { config } from './config.js';
import app from './app.js';

app.listen(config.port, () => {
  const where = `http://localhost:${config.port}`;
  console.log(`\n  Grandpa AI — Empowering Africa's Future, one conversation at a time`);
  console.log(`  Powered by Tolbert Innovation Hub · Monrovia, Liberia\n`);
  console.log(`  Listening on ${where}`);
  console.log(`  Model: ${config.model}`);
  if (config.accessCode) console.log('  Access code: on — visitors must enter it before chatting');
  console.log(config.imagesEnabled
    ? `  Pictures: on (${config.imageModel}, max ${config.imagesPerHour}/hour)`
    : '  Pictures: off — set ENABLE_IMAGES=true to turn them on');
  if (!config.apiKey) {
    console.log(`\n  \u26a0  No OPENAI_API_KEY found. Run \`npm run setup\` to add your key,`);
    console.log(`     otherwise every message will come back with an error.\n`);
  } else {
    console.log('');
  }
});
