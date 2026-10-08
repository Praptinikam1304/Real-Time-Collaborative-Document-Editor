import mongoose from 'mongoose'

const collaboratorSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['editor', 'viewer'], default: 'editor' },
}, { _id: false })

const documentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 140, default: 'Untitled document' },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  collaborators: { type: [collaboratorSchema], default: [] },
  content: { type: String, default: '' },
  state: { type: Buffer, default: () => Buffer.alloc(0) },
}, { timestamps: true })

export default mongoose.model('Document', documentSchema)