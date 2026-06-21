import mongoose, { Document, Schema as MongooseSchema } from 'mongoose';

export interface IZoomSession extends Document {
  title: string;
  description: string;
  duration: string;
  zoomUrl: string;
  isActive: boolean;
  transcript: string;
  questionCount: number;
  passScore: number;
  dailyResetTime: string;
  createdAt: Date;
  updatedAt: Date;
}

const zoomSessionSchema = new MongooseSchema<IZoomSession>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    duration: { type: String, default: '60 minutes' },
    zoomUrl: { type: String, required: true },
    isActive: { type: Boolean, default: false, index: true },
    transcript: { type: String, default: '' },
    questionCount: { type: Number, default: 10, min: 5, max: 20 },
    passScore: { type: Number, default: 70, min: 0, max: 100 },
    dailyResetTime: { type: String, default: '09:00 AM' }
  },
  { timestamps: true }
);

export default mongoose.model<IZoomSession>(
  'ZoomSession',
  zoomSessionSchema,
  'yaksha_faq_zoom_sessions'
);
