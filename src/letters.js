// letters.js - Evidence-linked dispute letter generator
// Every factual assertion cites the verbatim source span it came from.

const BUREAU_ADDR = {
  equifax: 'Equifax Information Services LLC, P.O. Box 740256, Atlanta, GA 30374',
  experian: 'Experian, P.O. Box 4500, Allen, TX 75013',
  transunion: 'TransUnion Consumer Solutions, P.O. Box 2000, Chester, PA 19016',
};

const TYPE_LANG = {
  OBSOLETE: 'this item has exceeded the maximum reporting period permitted under FCRA Section 605 (15 U.S.C. 1681c) and must be deleted',
  REAGED_DOFD: 'the date of first delinquency reported is inconsistent with other bureau records, indicating impermissible re-aging under FCRA Section 605(c)',
  DUPLICATE: 'this account is reported more than once on my file, which is inaccurate and must be corrected to a single tradeline',
  XB_BALANCE: 'the balance reported is inconsistent with the same account as reported by other bureaus and cannot be accurate as furnished',
  XB_STATUS: 'the account status reported is inconsistent with the same account as reported by other bureaus and cannot be accurate as furnished',
  POST_BK: 'this account was included in bankruptcy and must report a zero balance; the balance currently furnished is inaccurate',
};

export function generateDisputeLetter({ consumerName = '[YOUR FULL NAME]', consumerAddress = '[YOUR ADDRESS]', bureau, errors, date = new Date().toISOString().slice(0, 10) }) {
  const addr = BUREAU_ADDR[bureau.toLowerCase()] || `[${bureau} dispute address]`;
  const relevant = errors.filter(e => e.bureaus.map(b => b.toLowerCase()).includes(bureau.toLowerCase()));
  const items = relevant.map((e, i) => {
    const ev = e.evidence.filter(x => x.bureau.toLowerCase() === bureau.toLowerCase());
    const evLines = ev.map(x => `   Your report states, verbatim: "${x.span}"`).join('\n');
    const creditor = creditorOf(e);
    return `${i + 1}. ${creditor}\n   Dispute reason: ${TYPE_LANG[e.type] || e.explanation}\n   Detected issue: ${e.explanation}\n${evLines}\n   Requested action: investigate and ${e.type === 'OBSOLETE' || e.type === 'DUPLICATE' ? 'delete' : 'correct'} this item.`;
  }).join('\n\n');

  return `${consumerName}
${consumerAddress}

${date}

${addr}

RE: Formal Dispute of Inaccurate Information, FCRA Section 611

To Whom It May Concern:

I am writing to dispute the following information in my credit file. Under the Fair Credit Reporting Act, 15 U.S.C. 1681i, you are required to conduct a reasonable investigation of each disputed item within 30 days and to delete or correct any information that is inaccurate, incomplete, or unverifiable.

${items || '(no items detected for this bureau)'}

Each disputed item above is quoted directly from the report you furnished. Please send me written confirmation of the results of your investigation, an updated copy of my credit report reflecting any changes, and the name, address, and telephone number of each furnisher contacted.

Sincerely,

${consumerName}`;
}

function creditorOf(e) {
  if (e.creditor) return e.creditor;
  // prefer explicit creditor value stored on any evidence entry
  const credEv = e.evidence.find(x => x.field === 'creditor');
  if (credEv?.value) return credEv.value;
  // fall back to creditor field on the entity members via explanation text
  const match = e.explanation.match(/^[^:]+:\s*(.+?)\s+(?:account|balance|status|date)/i);
  if (match) return match[1];
  // last resort: first non-null value that doesn't look like a money/date string
  for (const ev of e.evidence) {
    if (ev.value && !/^[\$\d\s,\.\/\-]+$/.test(String(ev.value))) return String(ev.value);
  }
  return 'Account in dispute';
}
