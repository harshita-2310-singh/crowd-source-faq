import fs from 'fs';

const p = 'backend/services/aiClient.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  "    console.log('--- AiClient.chat DEBUG ---');",
  "// REMOVE OLD DEBUG"
);

// We'll replace the block where fetch happens or just before `const body:`
const target = `    const body: Record<string, unknown> = {`;
const insert = `
    const apiKeySource = config.apiKey ? 'Admin Settings / DB' : 'Environment Variable / Default';
    console.log('--- AI Request Configuration ---');
    console.log('provider =', config.provider);
    console.log('model =', model);
    console.log('task =', feature);
    console.log('apiKeyPresent =', !!config.apiKey);
    console.log('apiKeySource =', apiKeySource);
    console.log('baseUrl =', config.baseURL);
    console.log('--------------------------------');
`;

if (!c.includes('--- AI Request Configuration ---')) {
  c = c.replace(target, insert + '\n' + target);
}
fs.writeFileSync(p, c);
