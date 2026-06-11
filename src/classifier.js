// classifier.js - FCRA-grounded error detection over reconciled entities
// Taxonomy:
//   OBSOLETE          - negative item beyond the 7-year reporting window (15 USC 1681c)
//   REAGED_DOFD       - date of first delinquency inconsistent across bureaus (re-aging signal)
//   DUPLICATE         - same account reported twice within one bureau
//   XB_BALANCE        - cross-bureau balance inconsistency on the same account
//   XB_STATUS         - cross-bureau status inconsistency (e.g. open vs charge-off)
//   POST_BK           - balance owed reported on an account included in bankruptcy

const NEGATIVE_STATUS = /charge.?off|collection|late|delinquen|repossess|default|past.?due/i;
const val = (t, k) => t.fields[k]?.value;
const span = (t, k) => t.fields[k]?.span;

function monthsBetween(ymA, ymB) {
  const [ya, ma] = String(ymA).split('-').map(Number);
  const [yb, mb] = String(ymB).split('-').map(Number);
  if (!ya || !yb) return null;
  return (yb * 12 + (mb || 0)) - (ya * 12 + (ma || 0));
}

export function classifyErrors(entities, byBureau, opts = {}) {
  const now = opts.now || new Date().toISOString().slice(0, 7); // YYYY-MM
  const errors = [];

  // Per-entity checks
  for (const ent of entities) {
    const members = ent.members;

    // OBSOLETE: any member with negative status and DOFD older than 84 months
    for (const m of members) {
      const t = m.tradeline;
      const dofd = val(t, 'dofd');
      const status = val(t, 'status') || '';
      if (dofd && NEGATIVE_STATUS.test(status)) {
        const age = monthsBetween(dofd, now);
        if (age != null && age > 84) {
          errors.push(err('OBSOLETE', ent.id, [m],
            `Negative item with date of first delinquency ${dofd} is ${age} months old, beyond the 7 year FCRA reporting window.`,
            [evd(m, t, 'dofd'), evd(m, t, 'status')]));
        }
      }
    }

    // Cross-bureau checks require 2+ members
    if (members.length >= 2) {
      const dofds = members.map(m => ({ m, d: val(m.tradeline, 'dofd') })).filter(x => x.d);
      for (let i = 0; i < dofds.length; i++) for (let j = i + 1; j < dofds.length; j++) {
        const gap = Math.abs(monthsBetween(dofds[i].d, dofds[j].d) ?? 0);
        if (gap >= 6) {
          errors.push(err('REAGED_DOFD', ent.id, [dofds[i].m, dofds[j].m],
            `Date of first delinquency differs by ${gap} months across bureaus (${dofds[i].d} vs ${dofds[j].d}), a re-aging indicator.`,
            [evd(dofds[i].m, dofds[i].m.tradeline, 'dofd'), evd(dofds[j].m, dofds[j].m.tradeline, 'dofd')]));
        }
      }

      const bals = members.map(m => ({ m, b: val(m.tradeline, 'balance') })).filter(x => x.b != null);
      for (let i = 0; i < bals.length; i++) for (let j = i + 1; j < bals.length; j++) {
        const max = Math.max(bals[i].b, bals[j].b);
        if (max > 0 && Math.abs(bals[i].b - bals[j].b) / max > 0.25 && Math.abs(bals[i].b - bals[j].b) >= 100) {
          errors.push(err('XB_BALANCE', ent.id, [bals[i].m, bals[j].m],
            `Balance inconsistency across bureaus: $${bals[i].b} vs $${bals[j].b} on the same account.`,
            [evd(bals[i].m, bals[i].m.tradeline, 'balance'), evd(bals[j].m, bals[j].m.tradeline, 'balance')]));
        }
      }

      const stats = members.map(m => ({ m, s: val(m.tradeline, 'status') })).filter(x => x.s);
      for (let i = 0; i < stats.length; i++) for (let j = i + 1; j < stats.length; j++) {
        const negI = NEGATIVE_STATUS.test(stats[i].s), negJ = NEGATIVE_STATUS.test(stats[j].s);
        if (negI !== negJ) {
          errors.push(err('XB_STATUS', ent.id, [stats[i].m, stats[j].m],
            `Status inconsistency across bureaus: "${stats[i].s}" vs "${stats[j].s}" on the same account.`,
            [evd(stats[i].m, stats[i].m.tradeline, 'status'), evd(stats[j].m, stats[j].m.tradeline, 'status')]));
        }
      }
    }

    // POST_BK: remarks mention bankruptcy but balance > 0
    for (const m of members) {
      const t = m.tradeline;
      const remarks = String(val(t, 'remarks') || '');
      const bal = val(t, 'balance');
      if (/bankruptcy|chapter\s*(7|13)/i.test(remarks) && bal > 0) {
        errors.push(err('POST_BK', ent.id, [m],
          `Account noted as included in bankruptcy still reports a balance of $${bal}; discharged debts must report zero balance.`,
          [evd(m, t, 'remarks'), evd(m, t, 'balance')]));
      }
    }
  }

  // DUPLICATE: within one bureau, two tradelines that match each other strongly
  for (const [bureau, list] of Object.entries(byBureau)) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const sameName = normalizeEq(val(list[i], 'creditor'), val(list[j], 'creditor'));
      const sameTail = tailEq(val(list[i], 'account_mask'), val(list[j], 'account_mask'));
      if (sameName && sameTail) {
        errors.push(err('DUPLICATE', null,
          [{ bureau, index: i, tradeline: list[i] }, { bureau, index: j, tradeline: list[j] }],
          `The same account appears twice on the ${bureau} report.`,
          [{ bureau, field: 'creditor', span: span(list[i], 'creditor') }, { bureau, field: 'creditor', span: span(list[j], 'creditor') }]));
      }
    }
  }
  // Deduplicate cross-bureau errors: keep only the most severe pair per (entity_id, type)
  const xbTypes = new Set(['XB_BALANCE', 'XB_STATUS', 'REAGED_DOFD']);
  const seen = new Map();
  const deduped = [];
  for (const e of errors) {
    if (!xbTypes.has(e.type) || e.entity_id == null) {
      deduped.push(e);
      continue;
    }
    const key = e.entity_id + '|' + e.type;
    if (!seen.has(key)) {
      seen.set(key, e);
      deduped.push(e);
    }
    // else drop the duplicate pair
  }
  return deduped;
}

function normalizeEq(a, b) {
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return n(a) && n(a) === n(b);
}
function tailEq(a, b) {
  const t = (x) => (String(x || '').match(/(\d{3,})\s*$/) || [])[1] || '';
  return t(a) && t(a) === t(b);
}
function err(type, entity_id, members, explanation, evidence) {
  const conf = Math.min(...members.map(m =>
    Math.min(...Object.values(m.tradeline.fields).map(f => f.confidence), 1)));
  return { type, entity_id, bureaus: members.map(m => m.bureau), explanation, evidence, confidence: round2(conf) };
}
function evd(m, t, field) { return { bureau: m.bureau, field, value: val(t, field), span: span(t, field) }; }
const round2 = (x) => Math.round(x * 100) / 100;
