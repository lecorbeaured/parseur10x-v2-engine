// segmenter.js - Structure detection layer
// Classifies report text into typed zones: personal, tradeline, inquiry, public_record
// Works across bureau format families via label-anchor heuristics, not fixed templates.

const TRADELINE_ANCHORS = [
  /account\s*(number|#|mask)/i,
  /date\s*opened/i,
  /payment\s*status/i,
  /account\s*type/i,
  /high\s*credit|credit\s*limit/i,
];

const SECTION_HEADERS = [
  { re: /^(personal\s+information|consumer\s+information|identification)/im, type: 'personal' },
  { re: /^(credit\s+accounts?|account\s+information|tradelines?|revolving\s+accounts|installment\s+accounts|account\s+history)/im, type: 'tradeline_section' },
  { re: /^(inquiries|hard\s+inquiries|regular\s+inquiries)/im, type: 'inquiry' },
  { re: /^(public\s+records?|bankruptcies)/im, type: 'public_record' },
  { re: /^(collections?)/im, type: 'tradeline_section' },
];

// Split a tradeline section into individual tradeline blocks.
// Blocks begin at a creditor-name line followed within a few lines by an account anchor.
export function segment(text) {
  const zones = [];
  const lines = text.split(/\r?\n/);

  // 1. Find section boundaries
  const marks = [];
  for (const h of SECTION_HEADERS) {
    let m;
    const re = new RegExp(h.re.source, 'gim');
    while ((m = re.exec(text)) !== null) {
      marks.push({ index: m.index, type: h.type });
    }
  }
  marks.sort((a, b) => a.index - b.index);
  if (marks.length === 0) {
    // Unknown format: treat whole document as one tradeline section
    marks.push({ index: 0, type: 'tradeline_section' });
  }

  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const body = text.slice(start, end);
    if (marks[i].type === 'tradeline_section') {
      for (const block of splitTradelines(body, start)) zones.push(block);
    } else {
      zones.push({ type: marks[i].type, start, end, text: body });
    }
  }
  return zones;
}

function splitTradelines(sectionText, offset) {
  const blocks = [];
  const lines = sectionText.split(/\r?\n/);
  let cursor = 0;
  const lineStarts = lines.map(l => { const s = cursor; cursor += l.length + 1; return s; });

  // candidate block starts: a non-empty line in CAPS-ish or "Name - " style,
  // where an anchor label appears within the next 8 lines
  const startsAt = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const looksLikeName = /^[A-Z0-9][A-Z0-9 \/&'.,-]{2,50}$/.test(line) && !/:/.test(line);
    if (!looksLikeName) continue;
    const window = lines.slice(i + 1, i + 9).join('\n');
    if (TRADELINE_ANCHORS.some(re => re.test(window))) startsAt.push(i);
  }
  for (let k = 0; k < startsAt.length; k++) {
    const sLine = startsAt[k];
    const eLine = k + 1 < startsAt.length ? startsAt[k + 1] : lines.length;
    const start = offset + lineStarts[sLine];
    const end = offset + (eLine < lines.length ? lineStarts[eLine] : sectionText.length);
    blocks.push({ type: 'tradeline', start, end, text: lines.slice(sLine, eLine).join('\n') });
  }
  if (blocks.length === 0) blocks.push({ type: 'tradeline_section_raw', start: offset, end: offset + sectionText.length, text: sectionText });
  return blocks;
}
