import * as Y from 'yjs'
import Document from './models/Document.js'

const documents = new Map()
const documentLoads = new Map()
const persistQueues = new Map()
let io

export function configureCollaboration(socketServer) {
    io = socketServer
}

export async function getCollaborativeDocument(documentId) {
    if (documents.has(documentId)) return documents.get(documentId)
    if (documentLoads.has(documentId)) return documentLoads.get(documentId)
    const loading = loadCollaborativeDocument(documentId)
    documentLoads.set(documentId, loading)
    try {
        return await loading
    } finally {
        if (documentLoads.get(documentId) === loading) documentLoads.delete(documentId)
    }
}

async function loadCollaborativeDocument(documentId) {
    const record = await Document.findById(documentId).select('state content')
    if (!record) return null
    const ydoc = new Y.Doc()
    if (record.state?.length) Y.applyUpdate(ydoc, new Uint8Array(record.state))
    const text = ydoc.getText('markdown')
    if (!text.length && record.content) text.insert(0, record.content)
    ydoc.on('update', (update, origin) => {
        const excludedSocket = typeof origin === 'string' ? origin : null
        const room = io?.to(`document:${documentId}`)
        if (excludedSocket) room?.except(excludedSocket).emit('doc:update', Array.from(update))
        else room?.emit('doc:update', Array.from(update))
        const state = Buffer.from(Y.encodeStateAsUpdate(ydoc))
        const content = text.toString()
        const pending = persistQueues.get(documentId) || Promise.resolve()
        const next = pending.then(() => Document.updateOne({ _id: documentId }, {
            $set: { content, state, updatedAt: new Date() },
        })).catch((error) => console.error('Could not persist collaborative update:', error.message))
        persistQueues.set(documentId, next)
        next.finally(() => { if (persistQueues.get(documentId) === next) persistQueues.delete(documentId) })
    })
    documents.set(documentId, ydoc)
    return ydoc
}

export async function restoreCollaborativeDocument(documentId, content) {
    const ydoc = await getCollaborativeDocument(documentId)
    if (!ydoc) return false
    const text = ydoc.getText('markdown')
    ydoc.transact(() => {
        if (text.length) text.delete(0, text.length)
        if (content) text.insert(0, content)
    }, 'restore')
    return true
}