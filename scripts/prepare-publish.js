#!/usr/bin/env node
/**
 * prepare-publish.js
 *
 * Run before `npm publish` in CI.
 * - Reads the version from the git tag (e.g. v1.2.3 → 1.2.3)
 * - Stamps that version onto every public package
 * - Replaces wildcard "*" cross-package deps with the real version
 */

const fs   = require("fs");
const path = require("path");

// ── Resolve version ──────────────────────────────────────────────────────────

const rawVersion = process.env.RELEASE_VERSION ?? process.argv[2];
if (!rawVersion) {
  console.error("Usage: node scripts/prepare-publish.js <version>\n" +
                "       or set RELEASE_VERSION env var");
  process.exit(1);
}

const version = rawVersion.replace(/^v/, "");
console.log(`Preparing publish for version: ${version}`);

// ── Public packages (in dependency order) ────────────────────────────────────

const PUBLIC_PACKAGES = [
  "packages/types",
  "packages/sdk",
];

const SCOPE = "@frontend-guardian";

// ── Update each package.json ─────────────────────────────────────────────────

for (const pkgDir of PUBLIC_PACKAGES) {
  const pkgPath = path.resolve(__dirname, "..", pkgDir, "package.json");
  const pkg     = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  // Stamp version
  pkg.version = version;

  // Replace wildcard cross-package deps with real version
  for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[depField];
    if (!deps) continue;
    for (const [name, val] of Object.entries(deps)) {
      if (name.startsWith(SCOPE) && val === "*") {
        deps[name] = `^${version}`;
        console.log(`  ${pkg.name}: ${name} → ^${version}`);
      }
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`✓ Updated ${pkgDir}/package.json → ${version}`);
}

console.log("Done.");
