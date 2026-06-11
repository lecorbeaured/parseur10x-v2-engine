// run-eval.js - Benchmark evaluation harness
// Computes the Phase I milestone metrics on synthetic document sets:
//   M2: field extraction accuracy, hallucination rate
//   M3: entity resolution F1
//   M4: error detection precision / recall
// Usage: node test/run-eval.js [nSets] [tradelinesPerSet]

import { generateDocumentSet, setSeed } from './synthetic.js';
import { analyzeReports } from '../src/engine.js';

const N_SETS = Number(process.argv[2] || 50);
const N_TL = Number(process.argv[3] || 8);
const NOW = '2026-06';

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const CHECK_FIELDS = ['creditor', 'account_mask', 'account_type', 'status', 'balance', 'credit_limit', 'date_opened', 'dofd'];

function truthValue(v, field, bureau, variant) {
  if (field === 'creditor') return null; // compared via variant names list
  return variant[field];
}

let fieldsTotal = 0, fieldsCorrect = 0, fieldsEmitted = 0, fieldsRejected = 0;
let erTP = 0, erFP = 0, erFN = 0;
let detTP = 0, detFP = 0, detFN = 0;
const perType = {};

setSeed(2026);

for (let s = 0; s < N_SETS; s++) {
  const set = generateDocumentSet({ nTradelines: N_TL, now: NOW });
  const result = await analyzeReports(set.reports, { mode: 'deterministic', now: NOW });

  // ----- M2: extraction accuracy (match extracted tradelines to truth variants by order) -----
  for (const bureau of Object.keys(set.truth.variants)) {
    const truthList = set.truth.variants[bureau];
    const gotList = result.byBureau[bureau] || [];
    const n = Math.min(truthList.length, gotList.length);
    for (let i = 0; i < n; i++) {
      const tv = truthList[i];
      const got = gotList[i].fields;
      for (const f of CHECK_FIELDS) {
        const want = tv[f];
        if (want == null) continue;
        fieldsTotal++;
        const g = got[f]?.value;
        if (g == null) continue;
        let ok;
        if (typeof want === 'number') ok = Number(g) === want;
        else if (f === 'date_opened' || f === 'dofd') ok = norm(g) === norm(want);
        else ok = norm(g) === norm(want) || norm(want).includes(norm(g)) || norm(g).includes(norm(want));
        if (ok) fieldsCorrect++;
      }
    }
  }
  fieldsEmitted += result.verification.fields_emitted;
  fieldsRejected += result.verification.fields_rejected;

  // ----- M3: entity resolution F1 -----
  // ground truth: tradeline i in each bureau (same index) is the same entity
  const truthPairs = new Set();
  const B = Object.keys(set.truth.variants);
  for (let i = 0; i < N_TL; i++) {
    for (let a = 0; a < B.length; a++) for (let b = a + 1; b < B.length; b++) {
      truthPairs.add(`${B[a]}:${i}|${B[b]}:${i}`);
    }
  }
  const predPairs = new Set();
  for (const ent of result.entities) {
    const ms = ent.members;
    for (let a = 0; a < ms.length; a++) for (let b = a + 1; b < ms.length; b++) {
      const k1 = `${ms[a].bureau}:${ms[a].index}`, k2 = `${ms[b].bureau}:${ms[b].index}`;
      predPairs.add(k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);
    }
  }
  for (const p of predPairs) (truthPairs.has(p) ? erTP++ : erFP++);
  for (const p of truthPairs) if (!predPairs.has(p)) erFN++;

  // ----- M4: error detection P/R by (type, tradeline) -----
  const wantErr = new Set(set.truth.errors.map(e => `${e.type}:${e.tradeline_id}`));
  const gotErr = new Set();
  for (const e of result.errors) {
    // map detected entity back to tradeline id via member index (entities preserve index = truth order; duplicates appended last)
    const idx = e.entity_id != null ? result.entities[e.entity_id]?.members[0]?.index : e.evidence ? null : null;
    let tid = null;
    if (e.type === 'DUPLICATE') {
      // duplicate appended at end duplicates truth idx unknown; match by any seeded DUPLICATE
      const dup = set.truth.errors.find(x => x.type === 'DUPLICATE');
      tid = dup ? dup.tradeline_id : -1;
    } else if (idx != null && idx < N_TL) tid = set.truth.tradelines[idx].id;
    gotErr.add(`${e.type}:${tid}`);
  }
  for (const g of gotErr) {
    const t = g.split(':')[0];
    perType[t] = perType[t] || { tp: 0, fp: 0, fn: 0 };
    if (wantErr.has(g)) { detTP++; perType[t].tp++; } else { detFP++; perType[t].fp++; }
  }
  for (const w of wantErr) if (!gotErr.has(w)) {
    detFN++;
    const t = w.split(':')[0];
    perType[t] = perType[t] || { tp: 0, fp: 0, fn: 0 };
    perType[t].fn++;
  }
}

const pct = (x) => (100 * x).toFixed(2) + '%';
const acc = fieldsCorrect / fieldsTotal;
const halluc = fieldsRejected / Math.max(1, fieldsEmitted);
const erP = erTP / Math.max(1, erTP + erFP), erR = erTP / Math.max(1, erTP + erFN);
const erF1 = 2 * erP * erR / Math.max(1e-9, erP + erR);
const dP = detTP / Math.max(1, detTP + detFP), dR = detTP / Math.max(1, detTP + detFN);

console.log(`PARSEUR 10X v2 Engine - Benchmark Evaluation (deterministic mode)`);
console.log(`Document sets: ${N_SETS} | Tradelines per set: ${N_TL} | As-of: ${NOW}`);
console.log(`-----------------------------------------------------------------`);
console.log(`M2  Field extraction accuracy      ${pct(acc)}   (target >= 95%)   [${fieldsCorrect}/${fieldsTotal}]`);
console.log(`M2  Hallucination (rejected spans) ${pct(halluc)}   (target < 1%)     [${fieldsRejected}/${fieldsEmitted}]`);
console.log(`M3  Entity resolution  P ${pct(erP)}  R ${pct(erR)}  F1 ${pct(erF1)}  (target F1 >= 90%)`);
console.log(`M4  Error detection    P ${pct(dP)}  R ${pct(dR)}            (targets P >= 85%, R >= 80%)`);
console.log(`-----------------------------------------------------------------`);
console.log(`Per error type:`);
for (const [t, v] of Object.entries(perType)) {
  const p = v.tp / Math.max(1, v.tp + v.fp), r = v.tp / Math.max(1, v.tp + v.fn);
  console.log(`  ${t.padEnd(14)} P ${pct(p).padStart(8)}  R ${pct(r).padStart(8)}  (tp=${v.tp} fp=${v.fp} fn=${v.fn})`);
}
console.log(`\nNote: deterministic mode scores the structure-detection baseline on synthetic`);
console.log(`formats. LLM mode (OPENROUTER_API_KEY) is the research track for real documents.`);
