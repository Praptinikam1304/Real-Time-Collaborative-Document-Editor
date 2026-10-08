import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { Server } from 'socket.io'
import * as Y from 'yjs'
import routes from './routes.js'
import User from './models/User.js'
import Document from './models/Document.js'
import { configureCollaboration, getCollaborativeDocument } from './collaboration.js'

const app = express()
const server = http.createServer(app)
const clientOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim())
const io = new Server(server, { cors: { origin: clientOrigins, credentials: true } })

if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production.')
    process.env.JWT_SECRET = randomBytes(48).toString('base64url')
    console.warn('JWT_SECRET is unset; using an ephemeral development secret. Add JWT_SECRET to .env to keep sessions across restarts.')
}
app.use(cors({ origin: clientOrigins, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
app.use('/api', routes)
app.use((error, _request, response, _next) => {
    console.error(error)
    response.status(500).json({ message: 'An unexpected server error occurred.' })
})

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token
        if (!token) return next(new Error('Authentication required.'))
        const payload = jwt.verify(token, process.env.JWT_SECRET)
        const user = await User.findById(payload.sub).select('_id username')
        if (!user) return next(new Error('Your session is no longer valid.'))
        socket.data.user = { id: user._id.toString(), username: user.username }
        next()
    } catch {
        next(new Error('Your session is no longer valid.'))
    }
})

configureCollaboration(io)

io.on('connection', (socket) => {
    socket.on('doc:join', async ({ documentId } = {}) => {
        try {
            if (!mongoose.isValidObjectId(documentId)) return socket.emit('doc:error', { message: 'Document not found.' })
            const document = await Document.findById(documentId).select('owner collaborators')
            if (!document) return socket.emit('doc:error', { message: 'Document not found.' })
            const owner = document.owner.equals(socket.data.user.id)
            const collaborator = document.collaborators.find((item) => item.user.equals(socket.data.user.id))
            if (!owner && !collaborator) return socket.emit('doc:error', { message: 'You do not have access to this document.' })
            socket.data.documentId = documentId
            socket.data.canEdit = owner || collaborator?.role === 'editor'
            const ydoc = await getCollaborativeDocument(documentId)
            if (!ydoc) return socket.emit('doc:error', { message: 'Document is unavailable.' })
            await socket.join(`document:${documentId}`)
            socket.emit('doc:state', Array.from(Y.encodeStateAsUpdate(ydoc)))
            emitPresence(documentId)
        } catch (error) {
            console.error('Could not join document:', error.message)
            socket.emit('doc:error', { message: 'Could not open this document.' })
        }
    })

    socket.on('doc:update', ({ documentId, update } = {}) => {
        if (documentId !== socket.data.documentId || !socket.data.canEdit || !Array.isArray(update)) return
        getCollaborativeDocument(documentId).then((ydoc) => {
            if (ydoc) Y.applyUpdate(ydoc, new Uint8Array(update), socket.id)
        }).catch((error) => console.error('Could not apply document update:', error.message))
    })

    socket.on('disconnect', () => {
        if (socket.data.documentId) emitPresence(socket.data.documentId)
    })
})

function emitPresence(documentId) {
    const room = io.sockets.adapter.rooms.get(`document:${documentId}`)
    const users = [...(room || [])].map((socketId) => {
        const user = io.sockets.sockets.get(socketId)?.data.user
        return user ? { id: user.id, username: user.username } : null
    }).filter(Boolean)
    io.to(`document:${documentId}`).emit('presence:update', users)
}

const port = Number(process.env.PORT) || 4000
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/folio'
mongoose.connect(mongoUri).then(() => {
    server.listen(port, () => console.log(`Folio API and Socket.IO listening on http://localhost:${port}`))
}).catch((error) => {
    console.error(`MongoDB connection failed: ${error.message}`)
    process.exit(1)
})