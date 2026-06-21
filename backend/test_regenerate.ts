import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiClient from './services/aiClient.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');

  const aiClient = new AiClient();
  try {
     const result = await aiClient.chat([{ role: 'user', content: 'test' }], 'faqGeneration');
     console.log('Result:', result.content);
  } catch (err: any) {
     console.log('Caught:', err.message);
  }
  process.exit(0);
}

run().catch(console.error);
