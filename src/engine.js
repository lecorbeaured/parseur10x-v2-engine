// engine.js - PARSEUR 10X v2 verifiable analysis engine
// Pipeline: segment -> extract (schema+span constrained) -> verify (span grounding)
//           -> resolve (cross-bureau entities) -> classify (FCRA errors) -> letters

import { segment } from './segmenter.js';
import { extractTradeline } from './extractor.js';
import { verifyExtraction, summarizeVerification } from './verifier.js';
import { resolveEntities } from './resolver.js';
import { classifyErrors } from './classifier.js';
import { generateDisputeLetter } from './letters.js';

/**
 * analyzeReports({ equifax: "...", experian: "...", transunion: "..." }, opts)
 * opts: { mode: 'deterministic'|'llm', apiKey, model, now: 'YYYY-MM', matchThreshold }
 */
export async function analyzeReports(reports, opts = {}) {
  const byBureau = {};
  const verificationAll = [];

  for (const [bureau, text] of Object.entries(reports)) {
    if (!text || !text.trim()) continue;
    const zones = segment(text).filter(z => z.type === 'tradeline');
    const tradelines = [];
    for (const zone of zones) {
      const raw = await extractTradeline(zone, opts);
      const verified = verifyExtraction(zone, raw);
      verificationAll.push(verified);
      if (Object.keys(verified.fields).length > 0) tradelines.push(verified);
    }
    byBureau[bureau] = tradelines;
  }

  const entities = resolveEntities(byBureau, opts.matchThreshold ?? 0.62);
  const errors = classifyErrors(entities, byBureau, { now: opts.now });
  const verification = summarizeVerification(verificationAll);

  return {
    byBureau,
    entities: entities.map(e => ({
      id: e.id,
      bureaus: e.members.map(m => m.bureau),
      creditor: e.members[0].tradeline.fields.creditor?.value,
      members: e.members,
    })),
    errors,
    verification,
    letters: Object.fromEntries(Object.keys(byBureau).map(b =>
      [b, generateDisputeLetter({ bureau: b, errors })]))
  };
}

export { segment, extractTradeline, verifyExtraction, resolveEntities, classifyErrors, generateDisputeLetter };
