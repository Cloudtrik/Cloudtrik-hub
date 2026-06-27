#!/usr/bin/env node
// Cloudtrik-hub CLI entry point. Dispatches to the compiled ESM bundle and
// invokes runCli with process.argv. The bundle's own top-level guard is the
// safety net for `node dist/cli.js` direct invocation; this shim is the
// primary user-facing path (`npm i -g cloudtrik-hub` installs this as bin).
import('../dist/cli.js')
  .then(async ({ runCli }) => {
    const code = await runCli(process.argv);
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    console.error('cloudtrik-hub: failed to load CLI bundle:', err);
    process.exit(1);
  });
