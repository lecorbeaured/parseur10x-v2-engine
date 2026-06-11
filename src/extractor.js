// extractor.js - Constrained extraction layer
// Every emitted field: { value, span, confidence }
// span MUST be a verbatim substring of the zone text (enforced later by verifier.js)
// Modes:
//   'deterministic' - label-anchored regex extraction (offline baseline, structure-detection track)
//   'llm'           - DeepSeek via OpenRouter, schema-constrained JSON with span grounding

export const TRADELINE_SCHEMA = {
  creditor: 'string',
  account_mask: 'string',
  account_type: 'string',
  status: 'string',
  balance: 'number',
  past_due: 'number',
  credit_limit: 'number',
  date_opened: 'YYYY-MM',
  dofd: 'YYYY-MM', // date of first delinquency
  remarks: 'string',
};

const FIELD_PATTERNS = {
  account_mask: [/account\s*(?:number|#|mask)\s*[:\-]?\s*([X\*\d-]{4,})/i],
  account_type: [/(?:account|loan)\s*type\s*[:\-]?\s*([A-Za-z /]+)/i],
  status: [/(?:payment\s*)?status\s*[:\-]?\s*([A-Za-z0-9 /]+)/i],
  balance: [/(?:^|\n)\s*balance\s*[:\-]?\s*\$?([\d,]+)/i],
  past_due: [/(?:amount\s*)?past\s*due\s*[:\-]?\s*\$?([\d,]+)/i],
  credit_limit: [/(?:credit\s*limit|high\s*credit)\s*[:\-]?\s*\$?([\d,]+)/i],
  date_opened: [/date\s*opened\s*[:\-]?\s*(\d{4}-\d{2}|\d{2}\/\d{4}|[A-Za-z]{3}\s+\d{4})/i],
  dofd: [/date\s*of\s*(?:1st|first)\s*delinquency\s*[:\-]?\s*(\d{4}-\d{2}|\d{2}\/\d{4}|[A-Za-z]{3}\s+\d{4})/i],
  remarks: [/remarks?\s*[:\-]?\s*(.+)/i],
};

const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

export function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{2})\/(\d{4})$/))) return `${m[2]}-${m[1]}`;
  if ((m = s.match(/^([A-Za-z]{3})\w*\s+(\d{4})$/))) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return `${m[2]}-${mo}`;
  }
  return null;
}

export function extractTradelineDeterministic(zone) {
  const text = zone.text;
  const fields = {};
  // creditor = first non-empty line
  const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0);
  if (firstLine) {
    fields.creditor = { value: firstLine.trim(), span: firstLine.trim(), confidence: 0.9 };
  }
  for (const [name, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        let value = m[1].trim();
        if (['balance', 'past_due', 'credit_limit'].includes(name)) value = Number(value.replace(/,/g, ''));
        if (['date_opened', 'dofd'].includes(name)) value = normalizeDate(value) || value;
        fields[name] = { value, span: m[0].trim(), confidence: 0.85 };
        break;
      }
    }
  }
  return { zone_type: zone.type, fields, mode: 'deterministic' };
}

// ---------------- LLM mode ----------------

const SYSTEM_PROMPT = `You extract credit report tradeline data. Respond with ONLY a JSON object, no markdown, no prose.
Schema: { "fields": { "<field>": { "value": <typed value>, "span": "<EXACT verbatim substring of the input that justifies this value>", "confidence": <0..1> } } }
Allowed fields: creditor, account_mask, account_type, status, balance, past_due, credit_limit, date_opened, dofd, remarks.
Rules:
- "span" MUST be copied character-for-character from the input text. If you cannot point to an exact substring, OMIT the field entirely.
- Never guess. Omit fields not present. balance/past_due/credit_limit are numbers. Dates as YYYY-MM.
- confidence reflects your certainty the value is correct given the span.`;

export async function extractTradelineLLM(zone, opts = {}) {
  const apiKey = opts.apiKey || (typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : null);
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required for llm mode');
  const model = opts.model || 'deepseek/deepseek-chat';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: zone.text.slice(0, 12000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = { fields: {} }; }
  const fields = {};
  for (const [k, v] of Object.entries(parsed.fields || {})) {
    if (!(k in TRADELINE_SCHEMA)) continue; // schema constraint: drop unknown fields
    if (v == null || v.value == null || typeof v.span !== 'string') continue;
    let value = v.value;
    if (['balance', 'past_due', 'credit_limit'].includes(k)) value = Number(String(value).replace(/[$,]/g, ''));
    if (['date_opened', 'dofd'].includes(k)) value = normalizeDate(String(value)) || value;
    fields[k] = { value, span: v.span, confidence: clamp01(v.confidence) };
  }
  return { zone_type: zone.type, fields, mode: 'llm' };
}

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0.5));

export async function extractTradeline(zone, opts = {}) {
  return (opts.mode === 'llm') ? extractTradelineLLM(zone, opts) : extractTradelineDeterministic(zone);
}
