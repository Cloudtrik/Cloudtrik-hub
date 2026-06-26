#!/usr/bin/env node
// Cloudtrik-hub CLI entry point. Dispatches to compiled ESM bundle.
import("../dist/cli.js").catch((err) => {
  console.error("cloudtrik-hub: failed to load CLI bundle:", err);
  process.exit(1);
});
