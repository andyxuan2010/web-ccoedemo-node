"use strict";

const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "..");
const destination = path.resolve(process.argv[2] || "package");
const requiredEntries = [
  "app.js",
  "logger.js",
  "metrics.js",
  "runtime-config.js",
  "package.json",
  "package-lock.json",
  "web.config",
  "views",
  "static",
  "node_modules",
];

fs.rmSync(destination, { force: true, recursive: true });
fs.mkdirSync(destination, { recursive: true });

for (const entry of requiredEntries) {
  const source = path.join(repositoryRoot, entry);
  if (!fs.existsSync(source)) {
    throw new Error(`Required package entry is missing: ${entry}`);
  }
  fs.cpSync(source, path.join(destination, entry), { recursive: true });
}

const expressManifest = path.join(destination, "node_modules", "express", "package.json");
const eslintDirectory = path.join(destination, "node_modules", "eslint");
if (!fs.existsSync(expressManifest)) {
  throw new Error("Production dependency validation failed: express is missing.");
}
if (fs.existsSync(eslintDirectory)) {
  throw new Error("Package contains development dependency eslint; run npm prune --omit=dev first.");
}

console.log(`Staged self-contained application package at ${destination}.`);
