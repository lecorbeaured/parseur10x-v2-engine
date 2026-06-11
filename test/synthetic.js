// synthetic.js - Synthetic tri-bureau report generator with seeded errors
// Produces: { reports: {equifax, experian, transunion}, truth: { tradelines, errors } }
// Error injection calibrated to the FCRA taxonomy in classifier.js.

const CREDITORS = [
  ['CAPITAL ONE BANK', 'CAP ONE', 'CAPITAL ONE NA'],
  ['JPMCB CARD SERVICES', 'CHASE CARD SERVICES', 'JP MORGAN CHASE'],
  ['BANK OF AMERICA', 'BK OF AMER', 'BANK OF AMERICA NA'],
  ['SYNCHRONY BANK', 'SYNCB/AMAZON', 'SYNCHRONY BANK'],
  ['DISCOVER BANK', 'DISCOVER FIN SVCS', 'DISCOVER BANK'],
  ['WELLS FARGO BANK', 'WF BANK NA', 'WELLS FARGO'],
  ['MIDLAND CREDIT MANAGEMENT', 'MIDLAND FUNDING', 'MIDLAND CREDIT MGMT'],
  ['PORTFOLIO RECOVERY ASSOC', 'PORTFOLIO RECOV ASSOC', 'PORTFOLIO RECOVERY'],
];
const TYPES = ['Revolving / Credit Card', 'Installment / Auto Loan', 'Installment / Personal Loan', 'Open / Collection'];
const GOOD = ['Pays as agreed', 'Current', 'Paid, closed'];
const BAD = ['Charge off', 'Collection account', 'Late 90 days', '120 days past due'];

let seed = 42;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
export function setSeed(s) { seed = s; }
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

function makeTruthTradeline(i) {
  const cg = CREDITORS[i % CREDITORS.length];
  const negative = rnd() < 0.45;
  const openY = ri(2012, 2023), openM = ri(1, 12);
  const dofdY = ri(Math.max(openY, 2020), 2025), dofdM = ri(1, 12);
  return {
    id: i,
    creditor_names: cg,
    account_number: String(ri(10000000, 99999999)) + String(ri(1000, 9999)),
    account_type: pick(TYPES),
    negative,
    status: negative ? pick(BAD) : pick(GOOD),
    balance: negative ? ri(200, 9000) : (rnd() < 0.5 ? 0 : ri(100, 5000)),
    past_due: 0,
    credit_limit: ri(500, 15000),
    date_opened: ym(openY, openM),
    dofd: negative ? ym(dofdY, dofdM) : null,
    remarks: null,
  };
}

const maskStyles = {
  equifax: (n) => 'XXXX' + n.slice(-4),
  experian: (n) => '****' + n.slice(-4),
  transunion: (n) => n.slice(0, 4) + '********' + n.slice(-4),
};

function renderTradeline(t, bureau, bi) {
  const name = t.creditor_names[bi];
  const mask = maskStyles[bureau](t.account_number);
  if (bureau === 'equifax') {
    return `${name}
Account Number: ${mask}
Account Type: ${t.account_type}
Date Opened: ${t.date_opened}
Payment Status: ${t.status}
Balance: $${t.balance.toLocaleString('en-US')}
Credit Limit: $${t.credit_limit.toLocaleString('en-US')}${t.dofd ? `\nDate of 1st Delinquency: ${t.dofd}` : ''}${t.past_due ? `\nAmount Past Due: $${t.past_due}` : ''}${t.remarks ? `\nRemarks: ${t.remarks}` : ''}`;
  }
  if (bureau === 'experian') {
    const [y, m] = t.date_opened.split('-');
    return `${name}
Account #: ${mask}
Account Type: ${t.account_type}
Date Opened: ${m}/${y}
Status: ${t.status}
Balance: $${t.balance.toLocaleString('en-US')}
High Credit: $${t.credit_limit.toLocaleString('en-US')}${t.dofd ? `\nDate of First Delinquency: ${t.dofd.split('-')[1]}/${t.dofd.split('-')[0]}` : ''}${t.remarks ? `\nRemarks: ${t.remarks}` : ''}`;
  }
  const MO = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m] = t.date_opened.split('-').map(Number);
  return `${name}
Account Number: ${mask}
Loan Type: ${t.account_type}
Date Opened: ${MO[m]} ${y}
Payment Status: ${t.status}
Balance: $${t.balance.toLocaleString('en-US')}
Credit Limit: $${t.credit_limit.toLocaleString('en-US')}${t.dofd ? `\nDate of 1st Delinquency: ${MO[Number(t.dofd.split('-')[1])]} ${t.dofd.split('-')[0]}` : ''}${t.remarks ? `\nRemarks: ${t.remarks}` : ''}`;
}

function renderReport(bureau, tradelines, bi) {
  const header = { equifax: 'EQUIFAX CREDIT REPORT', experian: 'EXPERIAN CREDIT REPORT', transunion: 'TRANSUNION CONSUMER REPORT' }[bureau];
  return `${header}

Personal Information
Name: TEST CONSUMER
Report Date: 2026-06-01

Credit Accounts

${tradelines.map(t => renderTradeline(t, bureau, bi)).join('\n\n')}

Inquiries
NONE
`;
}

// Seed errors into per-bureau variants of the truth
export function generateDocumentSet({ nTradelines = 8, now = '2026-06' } = {}) {
  const truth = Array.from({ length: nTradelines }, (_, i) => makeTruthTradeline(i));
  const seededErrors = [];
  const variants = { equifax: [], experian: [], transunion: [] };
  const bureaus = ['equifax', 'experian', 'transunion'];

  for (const t of truth) {
    const per = {};
    bureaus.forEach(b => per[b] = JSON.parse(JSON.stringify(t)));

    const negativeCandidates = t.negative;
    const roll = rnd();

    if (negativeCandidates && roll < 0.18) {
      // OBSOLETE: push DOFD beyond 7 years on all bureaus
      const old = ym(ri(2016, 2018), ri(1, 12));
      bureaus.forEach(b => per[b].dofd = old);
      seededErrors.push({ type: 'OBSOLETE', tradeline_id: t.id });
    } else if (negativeCandidates && roll < 0.36) {
      // REAGED_DOFD: shift one bureau's DOFD by 8-18 months
      // keep base DOFD recent so the shift cannot cross the 84-month obsolescence line
      const baseRecent = ym(ri(2024, 2025), ri(1, 12));
      bureaus.forEach(b => per[b].dofd = baseRecent);
      const b = pick(bureaus);
      const [y, m] = per[b].dofd.split('-').map(Number);
      const shift = ri(8, 18);
      const nm = (y * 12 + m) - shift;
      per[b].dofd = ym(Math.floor((nm - 1) / 12), ((nm - 1) % 12) + 1);
      seededErrors.push({ type: 'REAGED_DOFD', tradeline_id: t.id });
    } else if (roll < 0.48) {
      // XB_BALANCE
      const b = pick(bureaus);
      per[b].balance = Math.max(0, Math.round(per[b].balance * (rnd() < 0.5 ? 2.2 : 0.3)) + 150);
      seededErrors.push({ type: 'XB_BALANCE', tradeline_id: t.id });
    } else if (negativeCandidates && roll < 0.58) {
      // XB_STATUS: one bureau shows positive status
      const b = pick(bureaus);
      per[b].status = pick(GOOD);
      seededErrors.push({ type: 'XB_STATUS', tradeline_id: t.id });
    } else if (roll < 0.66) {
      // POST_BK (single balance across bureaus to avoid accidental XB_BALANCE)
      const bkBal = ri(300, 4000);
      bureaus.forEach(b => { per[b].remarks = 'Included in Chapter 7 Bankruptcy'; per[b].balance = bkBal; });
      seededErrors.push({ type: 'POST_BK', tradeline_id: t.id });
    }

    bureaus.forEach((b, bi) => variants[b].push(per[b]));
  }

  // DUPLICATE: 30% chance, duplicate one tradeline within one bureau
  if (rnd() < 0.3) {
    const b = pick(bureaus);
    const idx = ri(0, nTradelines - 1);
    variants[b].push(JSON.parse(JSON.stringify(variants[b][idx])));
    seededErrors.push({ type: 'DUPLICATE', tradeline_id: truth[idx].id, bureau: b });
  }

  const reports = {};
  bureaus.forEach((b, bi) => reports[b] = renderReport(b, variants[b], bi));
  return { reports, truth: { tradelines: truth, variants, errors: seededErrors }, now };
}
