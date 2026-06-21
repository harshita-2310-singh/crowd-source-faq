import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { loadDbOverrides } from './utils/ai/aiProvider.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');
  const db = await loadDbOverrides();
  console.log("ANTHROPIC KEY:", JSON.stringify(db.anthropic.apiKey));
  console.log("OPENAI KEY:", JSON.stringify(db.openai.apiKey));
  console.log("CUSTOM KEY:", JSON.stringify(db.custom.apiKey));
  console.log("ENV ANTHROPIC:", JSON.stringify(process.env.ANTHROPIC_API_KEY));
  process.exit(0);
}

run().catch(console.error);
