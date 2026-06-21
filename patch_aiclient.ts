import fs from 'fs';

const p = 'backend/services/aiClient.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  "const dbConfig = await AiConfig.findOne({ isActive: true });",
  "const resolvedOverrides = await import('../utils/ai/aiProvider.js').then(m => m.resolveActiveAiConfig(null));\n    const dbConfig = await AiConfig.findOne({ _id: resolvedOverrides?.['_id'] || { $exists: true }, isActive: true, batchId: null });"
);

// Wait, actually better: just use `resolveActiveAiConfig(null)` directly, but we need `dbConfig?.activeProvider` and `dbConfig?.features`.
// `resolveActiveAiConfig` returns a `DbOverrides` which does NOT have `activeProvider` or `features`.
// So we just need to change the `findOne` to strictly enforce `batchId: null` unless a batchId is provided!
