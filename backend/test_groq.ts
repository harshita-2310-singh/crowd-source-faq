import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiClient from './services/aiClient.js';
import AiConfig from './models/AiConfig.js';

async function testGen() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');

  // Set the AiConfig to test custom (assuming user uses 'custom' for groq)
  await AiConfig.findOneAndUpdate({ isActive: true }, {
    $set: {
      activeProvider: 'custom',
      'providers.custom.baseURL': 'https://api.groq.com/openai/v1',
      'providers.custom.model': 'llama-3.3-70b-versatile',
      'providers.custom.apiKey': process.env.GROQ_API_KEY || 'fake_key',
    }
  }, { upsert: true, new: true });

  const aiClient = new AiClient();
  try {
     const result = await aiClient.chat([
          { role: 'user', content: "Hello" }
        ], 'faqGeneration');
     console.log('Result:', result);
  } catch (err) {
     console.error('FAILED:', err);
  }
  process.exit(0);
}

testGen().catch(console.error);
