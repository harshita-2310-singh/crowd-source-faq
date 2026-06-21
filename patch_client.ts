import fs from 'fs';

const path = 'backend/services/aiClient.ts';
let content = fs.readFileSync(path, 'utf8');

const target = `    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages,
    };`;

const insert = `
    console.log('--- AiClient.chat DEBUG ---');
    console.log('provider=', config.provider);
    console.log('baseUrl=', config.baseURL);
    console.log('model=', model);
    console.log('rawModel=', rawModel);
    console.log('---------------------------');
`;

content = content.replace(target, insert + '\n' + target);
fs.writeFileSync(path, content);
console.log('Patched');
