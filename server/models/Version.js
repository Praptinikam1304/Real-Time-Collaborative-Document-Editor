import mongoose from 'mongoose'

const versionSchema = new mongoose.Schema({
  document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 80 },
  content: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

export default mongoose.model('Version', versionSchema)