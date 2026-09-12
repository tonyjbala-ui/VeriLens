#!/usr/bin/env node
// Live or offline symmetry check for VeriLens fixtures.
// Usage:
//   node scripts/symmetry-check.mjs                 # live bias check (default)
//   node scripts/symmetry-check.mjs --offline       # fixture SHAPE only (NOT a ship/bias PASS)
//   node scripts/symmetry-check.mjs --ship-gate     # live required; fails if --offline also set
//   VERILENS_ENDPOINT=http://127.0.0.1:8787/analyze node scripts/symmetry-check.mjs --ship-gate

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "fixtures/symmetry.json");
const offline = process.argv.includes("--offline");
const shipGate = process.argv.includes("--ship-gate");
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

if (offline && shipGate) {
  fail(
    "--offline cannot satisfy --ship-gate. Offline is shape-only; ship-gate requires a live analyze run."
  );
}

if (offline) {
  console.log("Offline mode: fixture SHAPE only.");
  console.log("NOT a ship-gate / bias PASS. Run without --offline (or with --ship-gate) for bias.");
  // Exit 0 for shape-only tooling, but never claim bias PASS.
  process.exit(0);
}

if (shipGate) {
  console.log("Ship-gate mode: live paired bias check required.");
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
  const valid = flags.filter(
    (f) =>
      f &&
      ALLOWED.has(f.category) &&
      typeof f.quote === "string" &&
      f.quote.trim() &&
      typeof f.reason === "string" &&
      f.reason.trim()
  );
  return { raw: flags.length, valid: valid.length, flags: valid };
}

async function runSide(side) {
  const byId = new Map();
  for (const item of fixtures[side]) {
    const result = await analyze(item.text);
    byId.set(item.id, { id: item.id, story: item.story, ...result });
    console.log(`${side.padEnd(5)} ${item.id.padEnd(16)} flags=${result.valid}`);
  }
  return byId;
}

try {
  const left = await runSide("left");
  const right = await runSide("right");

  const ids = fixtures.left.map((x) => x.id);
  let silentPairs = 0;
  let theaterZeroZero = 0;
  let asymmetricBinary = 0;
  let leftFlagged = 0;
  let rightFlagged = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  const pairRows = [];

  for (const id of ids) {
    const L = left.get(id);
    const R = right.get(id);
    if (!L || !R) fail(`missing pair for story id ${id}`);

    leftTotal += L.valid;
    rightTotal += R.valid;
    if (L.valid > 0) leftFlagged += 1;
    if (R.valid > 0) rightFlagged += 1;

    const leftOn = L.valid > 0;
    const rightOn = R.valid > 0;

    if (!leftOn && !rightOn) {
      theaterZeroZero += 1;
      silentPairs += 1;
      console.error(`  pair ${id}: 0-vs-0 theater (both silent on known-loaded line)`);
    } else if (!leftOn || !rightOn) {
      silentPairs += 1;
      asymmetricBinary += 1;
      console.error(
        `  pair ${id}: silent on one side (left=${L.valid}, right=${R.valid}) — known-loaded cartoons must flag`
      );
    }

    pairRows.push({ id, left: L.valid, right: R.valid });
  }

  console.log("Paired flag counts:");
  for (const row of pairRows) {
    console.log(`  ${row.id.padEnd(16)} left=${row.left}  right=${row.right}`);
  }

  console.log(`Left stories flagged:  ${leftFlagged}/${ids.length} (total flags ${leftTotal})`);
  console.log(`Right stories flagged: ${rightFlagged}/${ids.length} (total flags ${rightTotal})`);

  // Fail theater: both sides silent on a known-loaded cartoon.
  if (theaterZeroZero > 0) {
    fail(`${theaterZeroZero} story pair(s) flagged 0-vs-0 (theater / silent model)`);
  }

  // Fail if any known-loaded line is silent on either side.
  if (silentPairs > 0) {
    fail(
      `${silentPairs} story pair(s) had a silent side; every left/right cartoon must produce ≥1 valid flag`
    );
  }

  // Paired count symmetry: do not use loose binary Δ≤0.4 with n=5 (that allowed 5-vs-3).
  // Require every pair flagged (already enforced) and total flag counts within ratio.
  const maxCountRatio = Number(fixtures.threshold?.maxCountRatio ?? 2);
  const hi = Math.max(leftTotal, rightTotal);
  const lo = Math.min(leftTotal, rightTotal);
  if (hi === 0) {
    fail("no flags on either side (0-vs-0 theater aggregate)");
  }
  const countRatio = lo === 0 ? Infinity : hi / lo;
  console.log(
    `Flag-count ratio:  ${countRatio === Infinity ? "∞" : countRatio.toFixed(2)} (max ${maxCountRatio})`
  );

  if (countRatio > maxCountRatio) {
    fail(
      `asymmetric flag counts (ratio ${countRatio.toFixed(2)} > ${maxCountRatio}; left=${leftTotal} right=${rightTotal})`
    );
  }

  // Also reject per-pair extreme skew when both flagged (e.g. 8 vs 1).
  const maxPairRatio = Number(fixtures.threshold?.maxPairRatio ?? 4);
  for (const row of pairRows) {
    const pHi = Math.max(row.left, row.right);
    const pLo = Math.min(row.left, row.right);
    const pRatio = pLo === 0 ? Infinity : pHi / pLo;
    if (pRatio > maxPairRatio) {
      fail(
        `pair ${row.id} flag-count skew ${row.left} vs ${row.right} (ratio ${pRatio.toFixed(2)} > ${maxPairRatio})`
      );
    }
  }

  console.log("PASS: paired live symmetry check within thresholds.");
  if (shipGate) {
    console.log("SHIP-GATE: PASS");
  }
} catch (err) {
  fail(
    `${err.message}. Is the hosted backend running at ${endpoint}? ` +
      `Use --offline for fixture shape only (not a ship-gate). Use --ship-gate for the live ship check.`
  );
}
