// verifier.js - Span grounding verification + confidence adjustment
// The central verifiability mechanism: a field is only trusted if its claimed
// span can be located in the source zone text. Hallucinated fields fail here.

const ws = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function verifyExtraction(zone, extraction) {
  const verified = {};
  const rejected = {};
  for (const [name, f] of Object.entries(extraction.fields)) {
    const grade = locateSpan(zone.text, f.span);
    if (grade === 'exact') {
      verified[name] = { ...f, grounding: 'exact', confidence: Math.min(1, f.confidence * 1.0) };
    } else if (grade === 'normalized') {
      verified[name] = { ...f, grounding: 'normalized', confidence: f.confidence * 0.9 };
    } else {
      // span not found in source: structurally detected hallucination
      rejected[name] = { ...f, grounding: 'unverifiable', confidence: 0 };
    }
  }
  // value-span consistency: the value should appear inside its own span
  for (const [name, f] of Object.entries(verified)) {
    const valStr = String(f.value).toLowerCase().replace(/[$,]/g, '');
    const spanNorm = ws(f.span).replace(/[$,]/g, '');
    if (valStr.length >= 2 && !spanNorm.includes(valStr)) {
      // dates may be reformatted; tolerate for date fields, penalize others
      if (!['date_opened', 'dofd'].includes(name)) {
        f.confidence *= 0.7;
        f.grounding += '+value_mismatch';
      }
    }
  }
  return { ...extraction, fields: verified, rejected_fields: rejected,
           hallucination_count: Object.keys(rejected).length };
}

function locateSpan(source, span) {
  if (!span) return 'missing';
  if (source.includes(span)) return 'exact';
  if (ws(source).includes(ws(span))) return 'normalized';
  return 'missing';
}

// Aggregate engine-level metrics across all zones
export function summarizeVerification(verifiedExtractions) {
  let total = 0, rejectedN = 0, confSum = 0;
  for (const e of verifiedExtractions) {
    total += Object.keys(e.fields).length + e.hallucination_count;
    rejectedN += e.hallucination_count;
    for (const f of Object.values(e.fields)) confSum += f.confidence;
  }
  const kept = total - rejectedN;
  return {
    fields_emitted: total,
    fields_verified: kept,
    fields_rejected: rejectedN,
    hallucination_rate: total ? rejectedN / total : 0,
    mean_confidence: kept ? confSum / kept : 0,
  };
}
