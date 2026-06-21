import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import AppSetting from './models/AppSetting.js';
import ZoomTranscriptChunk from './models/ZoomTranscriptChunk.js';
import ZoomAssessmentQuestion from './models/ZoomAssessmentQuestion.js';

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yaksha');
  
  const settings = await AppSetting.findOne({ _id: 'singleton' });
  console.log('--- Zoom Settings ---');
  console.log('Active:', settings?.settings?.zoomActive);
  console.log('Transcript Length:', settings?.settings?.zoomTranscript?.length || 0);

  const chunkCount = await ZoomTranscriptChunk.countDocuments();
  console.log('--- ZoomTranscriptChunk ---');
  console.log('Count:', chunkCount);

  const questionCount = await ZoomAssessmentQuestion.countDocuments();
  console.log('--- ZoomAssessmentQuestion ---');
  console.log('Count:', questionCount);

  process.exit(0);
}

run().catch(console.error);
