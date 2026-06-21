import { validateModelForProvider } from './controllers/aiConfigController.js';

function runTest() {
  console.log('Testing validateModelForProvider:');
  const tests = [
    { model: 'claude-3-5-sonnet-latest', provider: 'anthropic', expected: true },
    { model: 'gpt-4o-mini', provider: 'anthropic', expected: false },
    { model: 'gpt-4o-mini', provider: 'openai', expected: true },
    { model: 'claude-3-haiku', provider: 'openai', expected: false },
    { model: 'grok-3', provider: 'xai', expected: true },
    { model: 'gpt-4', provider: 'xai', expected: false },
    { model: 'MiniMax-Text-01', provider: 'minimax', expected: true },
    { model: 'gemini-1.5-flash', provider: 'gemini', expected: true },
    { model: 'claude', provider: 'gemini', expected: false },
    { model: 'llama-3.3-70b-versatile', provider: 'custom', expected: true },
    { model: '', provider: 'custom', expected: true },
  ];

  for (const t of tests) {
    const res = validateModelForProvider(t.model, t.provider);
    console.log(`- Model: "${t.model}", Provider: "${t.provider}" -> isValid: ${res.isValid} (expected: ${t.expected}) ${res.error ? `Error: ${res.error}` : ''}`);
    if (res.isValid !== t.expected) {
      console.error('  FAIL');
    }
  }
}

runTest();
