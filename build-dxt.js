#!/usr/bin/env node
/**
 * build-dxt.js — packages the Salesforce MCP server into a .dxt file
 * 
 * Run from the salesforce-mcp-server root:
 *   node build-dxt.js
 * 
 * Output: salesforce-mcp.dxt (ready to double-click in Claude Desktop)
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DXT_DIR = path.join(ROOT, ".dxt-build");
const SERVER_DIR = path.join(DXT_DIR, "server");
const OUT_FILE = path.join(ROOT, "salesforce-mcp.dxt");

console.log("Building Salesforce MCP Desktop Extension (.dxt)...\n");

// ─── Step 1: Clean build dirs ─────────────────────────────────────────────────
if (fs.existsSync(DXT_DIR)) {
  fs.rmSync(DXT_DIR, { recursive: true });
}
fs.mkdirSync(SERVER_DIR, { recursive: true });

// ─── Step 2: Compile TypeScript ───────────────────────────────────────────────
console.log("1/5  Compiling TypeScript...");
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

// ─── Step 3: Copy compiled JS to server/ ─────────────────────────────────────
console.log("2/5  Copying compiled server files...");
copyDir(path.join(ROOT, "dist"), SERVER_DIR);

// ─── Step 4: Bundle node_modules ──────────────────────────────────────────────
// Only production deps — no devDependencies
console.log("3/5  Bundling production dependencies (this takes ~30s)...");
execSync("npm install --production --no-package-lock", {
  cwd: DXT_DIR,
  stdio: "inherit",
  env: { ...process.env, npm_config_prefix: DXT_DIR },
});

// Copy node_modules from root since we already have them installed
// More reliable than re-installing
if (fs.existsSync(path.join(DXT_DIR, "node_modules"))) {
  fs.rmSync(path.join(DXT_DIR, "node_modules"), { recursive: true });
}
copyDir(path.join(ROOT, "node_modules"), path.join(DXT_DIR, "node_modules"), {
  exclude: ["@types", ".bin", "typescript", "ts-node"],
});

// ─── Step 5: Copy manifest + package.json ─────────────────────────────────────
console.log("4/5  Adding manifest and assets...");
fs.copyFileSync(
  path.join(ROOT, "manifest.json"),
  path.join(DXT_DIR, "manifest.json")
);

// Minimal package.json for the bundle
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const bundlePkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  main: "server/index.js",
};
fs.writeFileSync(
  path.join(DXT_DIR, "package.json"),
  JSON.stringify(bundlePkg, null, 2)
);

// Optional icon — placeholder if none exists
const iconSrc = path.join(ROOT, "icon.png");
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(DXT_DIR, "icon.png"));
}

// ─── Step 6: Zip into .dxt ────────────────────────────────────────────────────
console.log("5/5  Zipping into .dxt...");

if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);

// Use system zip (available on Mac/Linux)
// On Windows: use powershell Compress-Archive or 7zip
const platform = process.platform;
if (platform === "win32") {
  execSync(
    `powershell -Command "Compress-Archive -Path '${DXT_DIR}\\*' -DestinationPath '${OUT_FILE.replace(".dxt", ".zip")}' -Force"`,
    { stdio: "inherit" }
  );
  fs.renameSync(OUT_FILE.replace(".dxt", ".zip"), OUT_FILE);
} else {
  execSync(`cd "${DXT_DIR}" && zip -r "${OUT_FILE}" .`, { stdio: "inherit" });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
fs.rmSync(DXT_DIR, { recursive: true });

// ─── Done ─────────────────────────────────────────────────────────────────────
const size = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
console.log(`\nDone!\n`);
console.log(`  Output: salesforce-mcp.dxt (${size} MB)`);
console.log(`\nTo install:`);
console.log(`  1. Open Claude Desktop`);
console.log(`  2. Double-click salesforce-mcp.dxt`);
console.log(`  3. Fill in your Salesforce credentials`);
console.log(`  4. Click Install\n`);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function copyDir(src, dest, opts = {}) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (opts.exclude?.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, opts);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
