#!/usr/bin/env node
// Live or offline symmetry check for VeriLens fixtures.
// Usage:
//   node scripts/symmetry-check.mjs
//   node scripts/symmetry-check.mjs --offline
//   VERILENS_ENDPOINT=http://127.0.0.1:8787/analyze node scripts/symmetry-check.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "fixtures/symmetry.json");
const offline = process.argv.includes("--offline");
const endpoint = process.env.VERILENS_ENDPOINT || "http://127.0.0.1:8787/analyze";

const ALLOWED = new Set(["loaded_language", "framing", "editorializing"]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

if (!Array.isArray(fixtures.left) || fixtures.left.length !== 5) {
  fail("fixtures.left must contain exactly 5 sentences");
}
if (!Array.isArray(fixtures.right) || fixtures.right.length !== 5) {
  fail("fixtures.right must contain exactly 5 sentences");
}

const leftIds = fixtures.left.map((x) => x.id).sort().join(",");
const rightIds = fixtures.right.map((x) => x.id).sort().join(",");
if (leftIds !== rightIds) {
  fail("left and right story ids must match");
}

for (const side of ["left", "right"]) {
  for (const item of fixtures[side]) {
    if (!item.id || !item.story || typeof item.text !== "string" || item.text.length < 20) {
      fail(`${side}/${item.id || "?"} is missing id/story/text`);
    }
  }
}

console.log(`Fixtures OK — 5 left + 5 right (${fixturePath})`);

if (offline) {
  console.log("Offline mode: skipped live analyze.");
  process.exit(0);
}

async function analyze(text) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    throw new Error(`hosted_error:${res.status}`);
  }
  const parsed = await res.json();
  const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
  const valid = flags.filter((f) => f && ALLOWED.has(f.category) && typeof f.quote === "string");
  return { raw: flags.length, valid: valid.length, flags: valid };
}

async function runSide(side) {
  const rows = [];
  for (const item of fixtures[side]) {
    const result = await analyze(item.text);
    rows.push({ id: item.id, ...result });
    console.log(`${side.padEnd(5)} ${item.id.padEnd(16)} flags=${result.valid}`);
  }
  return rows;
}

try {
  const left = await runSide("left");
  const right = await runSide("right");
  const leftRate = left.filter((r) => r.valid > 0).length / left.length;
  const rightRate = right.filter((r) => r.valid > 0).length / right.length;
  const delta = Math.abs(leftRate - rightRate);
  const maxDelta = Number(fixtures.threshold?.maxRateDelta ?? 0.4);

  console.log(`Left flag rate:  ${(leftRate * 100).toFixed(0)}%`);
  console.log(`Right flag rate: ${(rightRate * 100).toFixed(0)}%`);
  console.log(`Delta:           ${(delta * 100).toFixed(0)}% (max ${(maxDelta * 100).toFixed(0)}%)`);

  if (delta > maxDelta) {
    fail(`asymmetric flag rates (delta ${delta.toFixed(2)} > ${maxDelta})`);
  }
  console.log("PASS: flag rates are within the symmetry threshold.");
} catch (err) {
  fail(`${err.message}. Is the hosted backend running at ${endpoint}? Use --offline to validate fixtures only.`);
}
