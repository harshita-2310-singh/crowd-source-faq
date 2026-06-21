import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AiConfig from './models/AiConfig.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');

  // Let's assume the user put Groq into 'openai'
  const config = await AiConfig.findOne({ batchId: null, isActive: true });
  if (config) {
    config.activeProvider = 'openai';
    config.setApiKey('openai', 'gsk_fake_key_for_testing');
    config.providers.openai.baseURL = 'https://api.groq.com/openai/v1';
    config.providers.openai.model = 'llama-3.3-70b-versatile';
    
    // Make sure we clear the features model override so it uses Groq's model
    config.features.faqGeneration.model = '';
    
    await config.save();
    console.log("DB Fixed. Active Provider is now: ", config.activeProvider);
  }
  process.exit(0);
}
run().catch(console.error);
