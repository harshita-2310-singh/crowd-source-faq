import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiConfig from './models/AiConfig.js';
import { encrypt } from './utils/auth/crypto.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');

  await AiConfig.deleteMany({}); // clean all configs

  // Global default config using custom provider with Groq API Key
  const config = new AiConfig({
    batchId: null,
    isActive: true,
    activeProvider: 'custom',
    providers: {
      custom: {
        baseURL: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        apiKeyCipher: encrypt('gsk_fake_groq_key')
      },
      openai: { apiKeyCipher: '', baseURL: '', model: '' },
      anthropic: { apiKeyCipher: '', baseURL: '', model: '' },
      xai: { apiKeyCipher: '', baseURL: '', model: '' },
      minimax: { apiKeyCipher: '', baseURL: '', model: '' },
      gemini: { apiKeyCipher: '', baseURL: '', model: '' },
    },
    features: {
      faqGeneration: { enabled: true, model: '', temperature: 0.4, maxTokens: 1024 },
      duplicateDetection: { enabled: true, model: '', temperature: 0.1, maxTokens: 1024 },
      knowledgeExtraction: { enabled: true, model: '', temperature: 0.2, maxTokens: 2048 },
      searchSummarization: { enabled: true, model: '', temperature: 0.3, maxTokens: 512 }
    },
    usage: { totalRequests: 0, totalEstimatedCost: 0, lastResetAt: new Date() }
  });

  await config.save();
  console.log("Mock DB ready");
  process.exit(0);
}
run().catch(console.error);
