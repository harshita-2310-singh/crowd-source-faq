import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiClient from './services/aiClient.js';
import AiConfig from './models/AiConfig.js';
import { resolveActiveAiConfig } from './utils/ai/aiProvider.js';

async function testGen() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');

  const config = await resolveActiveAiConfig(null);
  console.log('DB CONFIG:', config);

  const aiClient = new AiClient();
  try {
     await aiClient.chat([{ role: 'user', content: 'test' }], 'faqGeneration');
  } catch (err: any) {
     console.log('Caught:', err.message);
  }
  process.exit(0);
}
testGen().catch(console.error);
