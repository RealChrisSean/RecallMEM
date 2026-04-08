#!/usr/bin/env node
/**
 * Sync the bin/ folder + license files into publish/ before npm publish.
 *
 * The publish/ directory is the actual npm package that gets published.
 * It contains a stripped-down package.json with zero dependencies and
 * the CLI scripts. The full Next.js app source lives in the parent repo.
 *
 * Usage: node scripts/sync-publish.js
 * Or:    npm run publish:sync
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PUBLISH_DIR = path.join(ROOT, "publish");
const PUBLISH_BIN = path.join(PUBLISH_DIR, "bin");

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(name) {
  const src = path.join(ROOT, name);
  const dest = path.join(PUBLISH_DIR, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ⚠ ${name} not found, skipping`);
  }
}

console.log("Syncing publish/...");

// Wipe and recreate publish/bin/
if (fs.existsSync(PUBLISH_BIN)) {
  fs.rmSync(PUBLISH_BIN, { recursive: true, force: true });
}
copyDir(path.join(ROOT, "bin"), PUBLISH_BIN);
console.log("  ✓ bin/");

// Make recallmem.js executable
const cliPath = path.join(PUBLISH_BIN, "recallmem.js");
if (fs.existsSync(cliPath)) {
  fs.chmodSync(cliPath, 0o755);
}

// Copy license + readme files
copyFile("LICENSE");
copyFile("NOTICE");
copyFile("README.md");

// Read versions and verify they match
const rootPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")
);
const publishPkg = JSON.parse(
  fs.readFileSync(path.join(PUBLISH_DIR, "package.json"), "utf-8")
);

if (rootPkg.version !== publishPkg.version) {
  console.log("");
  console.log(
    `  ⚠ Version mismatch: root=${rootPkg.version}, publish=${publishPkg.version}`
  );
  console.log(`  Updating publish/package.json to ${rootPkg.version}`);
  publishPkg.version = rootPkg.version;
  fs.writeFileSync(
    path.join(PUBLISH_DIR, "package.json"),
    JSON.stringify(publishPkg, null, 2) + "\n"
  );
}

console.log("");
console.log("✓ publish/ ready");
console.log("");
console.log("Next steps:");
console.log("  cd publish");
console.log("  npm pack         # to verify the tarball");
console.log("  npm publish      # to publish to npm");
