import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiConfig from './models/AiConfig.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');
  const configs = await AiConfig.find({ isActive: true });
  console.log(`Found ${configs.length} active configs.`);
  for (const c of configs) {
     console.log(`- batchId: ${c.batchId}, provider: ${c.activeProvider}, anthropic key: ${c.getApiKey('anthropic') ? 'yes' : 'no'}`);
  }
  process.exit(0);
}

run().catch(console.error);
