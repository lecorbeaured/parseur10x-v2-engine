// resolver.js - Cross-bureau tradeline entity resolution
// Decides when tradelines from different bureaus describe the same account,
// with no shared stable identifier: masked numbers, creditor aliases, transfer chains.

const ALIASES = [
  ['cap one', 'capital one', 'cap1', 'capital one bank', 'capital one na'],
  ['chase', 'jpmcb', 'jp morgan chase', 'chase card services'],
  ['boa', 'bank of america', 'bk of amer'],
  ['amex', 'american express', 'amer express'],
  ['discover', 'discover bank', 'discover fin svcs'],
  ['syncb', 'synchrony', 'synchrony bank'],
  ['wf', 'wells fargo', 'wells fargo bank'],
  ['citi', 'citibank', 'citicards'],
  ['midland', 'midland credit management', 'midland funding'],
  ['portfolio recovery', 'portfolio recov assoc', 'pra'],
  ['lvnv', 'lvnv funding'],
];

export function normalizeCreditor(name) {
  let s = (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(bank|na|n a|llc|inc|corp|company|co|svcs|services|card)\b/g, '').replace(/\s+/g, ' ').trim();
  for (const group of ALIASES) {
    if (group.some(a => s.includes(a) || a.includes(s) && s.length >= 3)) return group[0];
  }
  return s;
}

function tokenSim(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

// Masked account compatibility: "XXXX1234" vs "****1234" vs "1234" tails
export function maskCompatible(a, b) {
  const tail = (x) => (String(x || '').match(/(\d{3,})\s*$/) || [])[1] || '';
  const ta = tail(a), tb = tail(b);
  if (!ta || !tb) return 0.5; // unknown, neutral
  const n = Math.min(ta.length, tb.length);
  return ta.slice(-n) === tb.slice(-n) ? 1 : 0;
}

function dateProximity(a, b) {
  if (!a || !b) return 0.5;
  const [ya, ma] = String(a).split('-').map(Number);
  const [yb, mb] = String(b).split('-').map(Number);
  if (!ya || !yb) return 0.5;
  const diff = Math.abs((ya * 12 + (ma || 0)) - (yb * 12 + (mb || 0)));
  return diff === 0 ? 1 : diff <= 2 ? 0.8 : diff <= 6 ? 0.5 : 0;
}

function balanceProximity(a, b) {
  if (a == null || b == null) return 0.5;
  if (a === 0 && b === 0) return 1;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 1;
  const rel = Math.abs(a - b) / max;
  return rel < 0.02 ? 1 : rel < 0.15 ? 0.7 : rel < 0.5 ? 0.4 : 0.1;
}

const val = (t, k) => t.fields[k]?.value;

export function matchScore(t1, t2) {
  const c1 = normalizeCreditor(val(t1, 'creditor'));
  const c2 = normalizeCreditor(val(t2, 'creditor'));
  const creditorScore = c1 && c1 === c2 ? 1 : tokenSim(c1, c2);
  const mask = maskCompatible(val(t1, 'account_mask'), val(t2, 'account_mask'));
  const opened = dateProximity(val(t1, 'date_opened'), val(t2, 'date_opened'));
  const bal = balanceProximity(val(t1, 'balance'), val(t2, 'balance'));

  // hard veto: conflicting numeric tails
  if (mask === 0) return { score: 0.1 * creditorScore, parts: { creditorScore, mask, opened, bal } };
  const score = 0.45 * creditorScore + 0.25 * mask + 0.2 * opened + 0.1 * bal;
  return { score, parts: { creditorScore, mask, opened, bal } };
}

// Greedy one-to-one matching across bureaus, threshold-gated
export function resolveEntities(byBureau, threshold = 0.62) {
  const bureaus = Object.keys(byBureau);
  const entities = [];
  const assigned = new Map(); // "bureau:idx" -> entity id

  const key = (b, i) => `${b}:${i}`;

  for (let bi = 0; bi < bureaus.length; bi++) {
    const b = bureaus[bi];
    byBureau[b].forEach((t, i) => {
      if (assigned.has(key(b, i))) return;
      const ent = { id: entities.length, members: [{ bureau: b, index: i, tradeline: t }] };
      assigned.set(key(b, i), ent.id);
      // try to attach best match from each later bureau
      for (let bj = bi + 1; bj < bureaus.length; bj++) {
        const b2 = bureaus[bj];
        let best = { score: 0, j: -1 };
        byBureau[b2].forEach((t2, j) => {
          if (assigned.has(key(b2, j))) return;
          const { score } = matchScore(t, t2);
          if (score > best.score) best = { score, j };
        });
        if (best.j >= 0 && best.score >= threshold) {
          ent.members.push({ bureau: b2, index: best.j, tradeline: byBureau[b2][best.j], match_confidence: best.score });
          assigned.set(key(b2, best.j), ent.id);
        }
      }
      entities.push(ent);
    });
  }
  return entities;
}
