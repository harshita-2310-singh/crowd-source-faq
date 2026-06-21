import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiConfig from './models/AiConfig.js';
import { resolveActiveAiConfig } from './utils/ai/aiProvider.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');
  const dbConfig = await AiConfig.findOne({ isActive: true });
  console.log('--- Raw AiConfig ---');
  console.log(JSON.stringify(dbConfig, null, 2));

  const resolved = await resolveActiveAiConfig(null);
  console.log('--- Resolved Config ---');
  console.log(JSON.stringify(resolved, null, 2));

  process.exit(0);
}

run().catch(console.error);
