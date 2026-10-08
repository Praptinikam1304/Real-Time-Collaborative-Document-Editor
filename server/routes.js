import { Router } from 'express'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import * as Y from 'yjs'
import User from './models/User.js'
import Document from './models/Document.js'
import Version from './models/Version.js'
import { authenticate, createToken } from './auth.js'
import { getCollaborativeDocument, restoreCollaborativeDocument } from './collaboration.js'

const router = Router()
const safeUser = (user) => ({ id: user._id, username: user.username, email: user.email })
const populatedDocument = (id) => Document.findById(id).select('-state -content')
    .populate('owner', 'username email')
    .populate('collaborators.user', 'username email')

async function getRole(documentId, userId) {
    const document = await Document.findById(documentId).select('owner collaborators')
    if (!document) return { document: null, role: null }
    if (document.owner.equals(userId)) return { document, role: 'owner' }
    const collaborator = document.collaborators.find((item) => item.user.equals(userId))
    return { document, role: collaborator?.role || null }
}

async function requireRole(request, response, roles) {
    const documentId = request.params.documentId || request.params.id
    const result = await getRole(documentId, request.user._id)
    if (!result.document) {
        response.status(404).json({ message: 'Document not found.' })
        return null
    }
    if (!roles.includes(result.role)) {
        response.status(403).json({ message: 'You do not have permission to do that.' })
        return null
    }
    return result
}

router.post('/auth/register', async (request, response) => {
    const username = String(request.body.username || '').trim()
    const email = String(request.body.email || '').trim().toLowerCase()
    const password = String(request.body.password || '')
    if (username.length < 2 || username.length > 48 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
        return response.status(400).json({ message: 'Enter a name, valid email, and password with at least 8 characters.' })
    }
    try {
        const user = await User.create({ username, email, passwordHash: await bcrypt.hash(password, 12) })
        response.status(201).json({ token: createToken(user), user: safeUser(user) })
    } catch (error) {
        response.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'An account already exists for this email.' : 'Could not create your account.' })
    }
})

router.post('/auth/login', async (request, response) => {
    const email = String(request.body.email || '').trim().toLowerCase()
    const user = await User.findOne({ email }).select('+passwordHash')
    if (!user || !(await bcrypt.compare(String(request.body.password || ''), user.passwordHash))) {
        return response.status(401).json({ message: 'Email or password is incorrect.' })
    }
    response.json({ token: createToken(user), user: safeUser(user) })
})

router.get('/auth/me', authenticate, (request, response) => response.json({ user: safeUser(request.user) }))

router.get('/documents', authenticate, async (request, response) => {
    const documents = await Document.find({ $or: [{ owner: request.user._id }, { 'collaborators.user': request.user._id }] })
        .select('-state -content').sort({ updatedAt: -1 }).populate('owner', 'username email').populate('collaborators.user', 'username email')
    response.json({ documents: documents.map((document) => ({ ...document.toObject(), accessRole: document.owner._id.equals(request.user._id) ? 'owner' : document.collaborators.find((item) => item.user?._id.equals(request.user._id))?.role })) })
})

router.post('/documents', authenticate, async (request, response) => {
    const content = typeof request.body.content === 'string' ? request.body.content.slice(0, 500000) : ''
    const ydoc = new Y.Doc()
    if (content) ydoc.getText('markdown').insert(0, content)
    const document = await Document.create({
        title: String(request.body.title || 'Untitled document').trim().slice(0, 140) || 'Untitled document',
        owner: request.user._id, content, state: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    })
    const populated = await populatedDocument(document._id)
    response.status(201).json({ document: { ...populated.toObject(), accessRole: 'owner' } })
})

router.get('/documents/:id', authenticate, async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) return response.status(404).json({ message: 'Document not found.' })
    const { role } = await getRole(request.params.id, request.user._id)
    if (!role) return response.status(404).json({ message: 'Document not found.' })
    const document = await populatedDocument(request.params.id)
    response.json({ document: { ...document.toObject(), accessRole: role } })
})

router.patch('/documents/:id', authenticate, async (request, response) => {
    const access = await requireRole({ ...request, params: { id: request.params.id } }, response, ['owner', 'editor'])
    if (!access) return
    const title = String(request.body.title || '').trim()
    if (!title || title.length > 140) return response.status(400).json({ message: 'Title must be between 1 and 140 characters.' })
    await Document.updateOne({ _id: request.params.id }, { $set: { title } })
    const document = await populatedDocument(request.params.id)
    response.json({ document: { ...document.toObject(), accessRole: access.role } })
})

router.post('/documents/:id/share', authenticate, async (request, response) => {
    const access = await requireRole({ ...request, params: { id: request.params.id } }, response, ['owner'])
    if (!access) return
    const email = String(request.body.email || '').trim().toLowerCase()
    const role = request.body.role === 'viewer' ? 'viewer' : 'editor'
    const invitedUser = await User.findOne({ email }).select('_id')
    if (!invitedUser) return response.status(404).json({ message: 'No folio account was found for that email.' })
    if (invitedUser._id.equals(access.document.owner)) return response.status(400).json({ message: 'The owner already has full access.' })
    const existing = access.document.collaborators.find((item) => item.user.equals(invitedUser._id))
    if (existing) existing.role = role
    else access.document.collaborators.push({ user: invitedUser._id, role })
    await access.document.save()
    const document = await populatedDocument(request.params.id)
    response.json({ document: { ...document.toObject(), accessRole: 'owner' } })
})

router.delete('/documents/:id/share/:userId', authenticate, async (request, response) => {
    const access = await requireRole({ ...request, params: { id: request.params.id } }, response, ['owner'])
    if (!access) return
    access.document.collaborators = access.document.collaborators.filter((item) => !item.user.equals(request.params.userId))
    await access.document.save()
    response.json({ message: 'Access removed.' })
})

router.delete('/documents/:id', authenticate, async (request, response) => {
    const access = await requireRole({ ...request, params: { id: request.params.id } }, response, ['owner'])
    if (!access) return
    await Promise.all([Document.deleteOne({ _id: request.params.id }), Version.deleteMany({ document: request.params.id })])
    response.json({ message: 'Document deleted.' })
})

router.get('/documents/:documentId/versions', authenticate, async (request, response) => {
    const access = await requireRole(request, response, ['owner', 'editor', 'viewer'])
    if (!access) return
    const versions = await Version.find({ document: request.params.documentId }).sort({ createdAt: -1 }).populate('createdBy', 'username email')
    response.json({ versions })
})

router.post('/documents/:documentId/versions', authenticate, async (request, response) => {
    const access = await requireRole(request, response, ['owner', 'editor'])
    if (!access) return
    const title = String(request.body.title || '').trim()
    if (!title || title.length > 80) return response.status(400).json({ message: 'Version name must be between 1 and 80 characters.' })
    const ydoc = await getCollaborativeDocument(request.params.documentId)
    const content = ydoc?.getText('markdown').toString() || ''
    const version = await Version.create({ document: request.params.documentId, title, content, createdBy: request.user._id })
    response.status(201).json({ version })
})

router.post('/documents/:documentId/versions/:versionId/restore', authenticate, async (request, response) => {
    const access = await requireRole(request, response, ['owner', 'editor'])
    if (!access) return
    const version = await Version.findOne({ _id: request.params.versionId, document: request.params.documentId })
    if (!version) return response.status(404).json({ message: 'Version not found.' })
    const ydoc = await getCollaborativeDocument(request.params.documentId)
    const currentContent = ydoc?.getText('markdown').toString() || ''
    await Version.create({ document: request.params.documentId, title: 'Before restore', content: currentContent, createdBy: request.user._id })
    await restoreCollaborativeDocument(request.params.documentId, version.content)
    response.json({ message: 'Version restored.' })
})

export default router