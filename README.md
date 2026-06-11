# PARSEUR 10X v2 Engine (research prototype)

Verifiable AI credit report analysis. The four research components from the NSF SBIR Phase I proposal, working end to end:

1. **Segmenter** (`src/segmenter.js`): typed zone detection across bureau format families, no fixed templates.
2. **Constrained extractor** (`src/extractor.js`): schema-bound field extraction where every field carries a verbatim source span and a confidence score. Two modes: `deterministic` (offline, label-anchored) and `llm` (DeepSeek via OpenRouter).
3. **Verifier** (`src/verifier.js`): rejects any field whose claimed span cannot be located in the source text. Hallucination becomes structurally detectable instead of silent.
4. **Resolver** (`src/resolver.js`): cross-bureau tradeline entity resolution with no stable keys (creditor alias normalization, masked-number tail compatibility, date and balance trajectory scoring).
5. **Classifier** (`src/classifier.js`): FCRA-grounded error taxonomy: OBSOLETE, REAGED_DOFD, DUPLICATE, XB_BALANCE, XB_STATUS, POST_BK.
6. **Letters** (`src/letters.js`): dispute letters where every asserted fact quotes its source span.

## Quick start

```bash
# benchmark evaluation on synthetic tri-bureau document sets
node test/run-eval.js 50 8

# browser demo (engine runs fully client-side)
npx serve .        # then open /demo/
```

## Current benchmark results (deterministic mode, 50 sets x 8 tradelines)

| Milestone | Metric | Result | Phase I target |
|---|---|---|---|
| M2 | Field extraction accuracy | 100% | >= 95% |
| M2 | Hallucination rate | 0% | < 1% |
| M3 | Entity resolution F1 | 100% | >= 90% |
| M4 | Error detection precision | 97.9% | >= 85% |
| M4 | Error detection recall | 99.6% | >= 80% |

Deterministic mode scores the structure-detection baseline on synthetic formats (perfect by construction is expected; it validates the pipeline and harness). The research questions in the proposal concern LLM mode on real heterogeneous documents, where these numbers are the targets, not the starting point.

## LLM mode

```js
import { analyzeReports } from './src/engine.js';
const res = await analyzeReports({ equifax, experian, transunion }, {
  mode: 'llm',
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'deepseek/deepseek-chat',
});
```

Works in Node 18+ and in the browser. No dependencies.

## API output shape

```js
{
  byBureau: { equifax: [tradeline...], ... },   // verified extractions, per field: {value, span, confidence, grounding}
  entities: [{ id, bureaus, creditor, members }],
  errors:   [{ type, explanation, evidence: [{bureau, field, value, span}], confidence }],
  verification: { fields_verified, fields_rejected, hallucination_rate, mean_confidence },
  letters:  { equifax: "...", ... }
}
```

## Deployment

`python3 deploy.py` from the project root (zips a clean build and prints the GitHub + Netlify steps). The demo is fully static; Netlify publish directory is the project root, entry at `/demo/`.
