#!/usr/bin/env node
// Pack the unpacked extension into dist/verilens-<version>.zip
// Excludes backend/, dist/, .git, node_modules, and always skips .env / **/.env.

import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version || "0.0.0";
const outDir = join(root, "dist");
const outFile = join(outDir, `verilens-${version}.zip`);

const SKIP_DIRS = new Set(["backend", "dist", ".git", "node_modules"]);
const SKIP_FILES = new Set([".DS_Store"]);

function isEnvFile(name) {
  // Always skip .env and any **/.env (exact basename .env).
  return name === ".env";
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_FILES.has(name) || isEnvFile(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, acc);
    } else {
      // Skip nested paths whose basename is .env (already handled) and dotenv variants
      // that are clearly secrets: .env.local, .env.production, etc.
      if (basename(full) === ".env" || /^\.env(\.|$)/.test(basename(full))) continue;
      acc.push(full);
    }
  }
  return acc;
}

function dosDateTime(date) {
  const dosTime =
    (date.getSeconds() >> 1) |
    (date.getMinutes() << 5) |
    (date.getHours() << 11);
  const dosDate =
    date.getDate() |
    ((date.getMonth() + 1) << 5) |
    ((date.getFullYear() - 1980) << 9);
  return { dosTime, dosDate };
}

function encodePath(abs) {
  return relative(root, abs).split("\\").join("/");
}

const files = walk(root).sort();
if (!files.length) {
  console.error("No files to pack");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const chunks = [];
const centrals = [];
let offset = 0;

for (const abs of files) {
  const data = readFileSync(abs);
  const name = encodePath(abs);
  const nameBuf = Buffer.from(name, "utf8");
  const compressed = deflateRawSync(data);
  const checksum = crc32(data) >>> 0;
  const { dosTime, dosDate } = dosDateTime(statSync(abs).mtime);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);

  chunks.push(local, nameBuf, compressed);
  centrals.push(central, nameBuf);
  offset += local.length + nameBuf.length + compressed.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralSize, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const dest = createWriteStream(outFile);
for (const c of chunks) dest.write(c);
for (const c of centrals) dest.write(c);
dest.write(eocd);
dest.end();

dest.on("finish", () => {
  const bytes = statSync(outFile).size;
  console.log(`Wrote ${outFile} (${bytes} bytes, ${files.length} files)`);
});
