import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiClient from './services/aiClient.js';

async function testGen() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');
  const aiClient = new AiClient();
  try {
     const result = await aiClient.chat([
          { role: 'system', content: 'You are a JSON API. Output only valid JSON arrays.' },
          { role: 'user', content: "Generate 1 test question in a JSON array format: [{ \"question\": \"...\", \"options\": [\"A\",\"B\",\"C\",\"D\"], \"correctOptionIndex\": 0, \"type\": \"MCQ\", \"sourceType\": \"transcript\" }]" }
        ], 'faqGeneration', { temperature: 0.4, maxTokens: 4096 });
     console.log(result);
  } catch (err) {
     console.error('FAILED:', err);
  }
  process.exit(0);
}

testGen().catch(console.error);
