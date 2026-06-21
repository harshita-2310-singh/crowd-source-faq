import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiClient from './services/aiClient.js';
import AiConfig from './models/AiConfig.js';

async function testGen() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');

  await AiConfig.findOneAndUpdate({ isActive: true }, {
    $set: {
      activeProvider: 'openai',
      'providers.openai.baseURL': 'https://api.groq.com/openai/v1',
      'providers.openai.model': 'llama-3.3-70b-versatile',
      'providers.openai.apiKey': 'fake', // we just want to see the logs
    }
  }, { upsert: true, new: true });

  const aiClient = new AiClient();
  try {
     await aiClient.chat([{ role: 'user', content: 'test' }], 'faqGeneration');
  } catch (err: any) {
     console.log('Caught:', err.message);
  }
  process.exit(0);
}
testGen().catch(console.error);
