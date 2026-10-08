import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import * as Y from 'yjs'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ArrowLeft, Check, ChevronDown, Clock3, FilePlus2, FileText, History, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Search, Share2, ShieldCheck, Sparkles, Users, X } from 'lucide-react'
import './Workspace.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const SOCKET = import.meta.env.VITE_SOCKET_URL || API
const SEED = '# Untitled document\n\nStart writing here. Your changes are shared live with everyone who has access.\n'
marked.setOptions({ breaks: true, gfm: true })

async function api(path, { token, ...options } = {}) {
    let response
    try {
        response = await fetch(`${API}/api${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
        })
    } catch {
        throw new Error('Cannot reach the Folio API. Configure .env, start MongoDB, then run npm run dev.')
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || 'Something went wrong')
    return data
}

export default function Workspace() {
    const [session, setSession] = useState(() => {
        try { return JSON.parse(localStorage.getItem('folio-session')) } catch { return null }
    })
    const [documents, setDocuments] = useState([])
    const [document, setDocument] = useState(null)
    const [content, setContent] = useState('')
    const [collaborators, setCollaborators] = useState([])
    const [presence, setPresence] = useState([])
    const [query, setQuery] = useState('')
    const [authMode, setAuthMode] = useState('login')
    const [auth, setAuth] = useState({ username: '', email: '', password: '' })
    const [modal, setModal] = useState('')
    const [message, setMessage] = useState('')
    const [saving, setSaving] = useState(false)
    const [preview, setPreview] = useState(true)
    const [sidebar, setSidebar] = useState(true)
    const [share, setShare] = useState({ email: '', role: 'editor' })
    const [versionTitle, setVersionTitle] = useState('')
    const [versions, setVersions] = useState([])
    const token = session?.token
    const documentId = document?._id
    const socketRef = useRef(null)
    const ydocRef = useRef(null)
    const textRef = useRef(null)
    const localChangeRef = useRef(false)
    const saveTimerRef = useRef(null)
    const filtered = useMemo(() => documents.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())), [documents, query])

    useEffect(() => {
        if (!token) return
        api('/auth/me', { token }).then(({ user }) => setSession((old) => ({ ...old, user }))).catch(signOut)
    }, [token])
    useEffect(() => {
        if (!token) return
        api('/documents', { token }).then(({ documents: items }) => setDocuments(items)).catch((error) => notify(error.message))
    }, [token])
    useEffect(() => {
        if (!documentId || !token) return undefined
        const ydoc = new Y.Doc()
        const text = ydoc.getText('markdown')
        const socket = io(SOCKET, { autoConnect: false, auth: { token } })
        ydocRef.current = ydoc
        textRef.current = text
        socketRef.current = socket
        const observeText = () => {
            setContent(text.toString())
            if (localChangeRef.current) {
                localChangeRef.current = false
                setSaving(true)
                clearTimeout(saveTimerRef.current)
                saveTimerRef.current = setTimeout(() => setSaving(false), 550)
            }
        }
        const observeUpdate = (update, origin) => {
            if (origin !== 'remote' && origin !== 'server' && socket.connected) {
                socket.emit('doc:update', { documentId, update: Array.from(update) })
            }
        }
        text.observe(observeText)
        ydoc.on('update', observeUpdate)
        socket.on('connect', () => socket.emit('doc:join', { documentId }))
        socket.on('doc:state', (update) => {
            Y.applyUpdate(ydoc, new Uint8Array(update), 'server')
            if (!text.length) Y.transact(ydoc, () => text.insert(0, SEED), 'server')
            setContent(text.toString())
        })
        socket.on('doc:update', (update) => Y.applyUpdate(ydoc, new Uint8Array(update), 'remote'))
        socket.on('presence:update', (users) => setPresence(users.filter((user) => user.id !== socket.id)))
        socket.on('doc:error', ({ message: error }) => notify(error || 'Could not join this document'))
        socket.connect()
        return () => {
            clearTimeout(saveTimerRef.current)
            text.unobserve(observeText)
            ydoc.off('update', observeUpdate)
            socket.disconnect()
            ydoc.destroy()
            if (socketRef.current === socket) socketRef.current = null
            if (ydocRef.current === ydoc) ydocRef.current = null
            setPresence([])
        }
    }, [documentId, token])
    useEffect(() => {
        if (!message) return undefined
        const timer = setTimeout(() => setMessage(''), 3000)
        return () => clearTimeout(timer)
    }, [message])

    function notify(text) { setMessage(text) }
    function signOut() {
        localStorage.removeItem('folio-session')
        setSession(null); setDocuments([]); setDocument(null); setCollaborators([])
    }
    async function submitAuth(event) {
        event.preventDefault()
        try {
            const result = await api(`/auth/${authMode}`, { method: 'POST', body: JSON.stringify(auth) })
            localStorage.setItem('folio-session', JSON.stringify(result))
            setSession(result)
        } catch (error) { notify(error.message) }
    }
    async function createDocument() {
        try {
            const { document: created } = await api('/documents', { token: session.token, method: 'POST', body: JSON.stringify({ title: 'Untitled document', content: SEED }) })
            setDocuments((items) => [created, ...items]); openDocument(created)
        } catch (error) { notify(error.message) }
    }
    async function openDocument(item) {
        setDocument(item)
        if (item._id !== document?._id) setContent('')
        setCollaborators([])
        try {
            const { document: full } = await api(`/documents/${item._id}`, { token: session.token })
            setDocument(full); setCollaborators(full.collaborators || [])
            setDocuments((items) => items.map((entry) => entry._id === full._id ? full : entry))
        } catch (error) { notify(error.message) }
    }
    function edit(next) {
        setContent(next)
        const text = textRef.current
        if (!text || next === text.toString()) return
        const before = text.toString()
        let start = 0
        while (start < before.length && start < next.length && before[start] === next[start]) start++
        let oldEnd = before.length, newEnd = next.length
        while (oldEnd > start && newEnd > start && before[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd-- }
        localChangeRef.current = true
        ydocRef.current.transact(() => {
            if (oldEnd > start) text.delete(start, oldEnd - start)
            if (newEnd > start) text.insert(start, next.slice(start, newEnd))
        }, 'local')
    }
    async function rename(title) {
        if (!title.trim() || title === document.title) return
        try {
            const { document: updated } = await api(`/documents/${document._id}`, { token: session.token, method: 'PATCH', body: JSON.stringify({ title: title.trim() }) })
            setDocument(updated); setDocuments((items) => items.map((item) => item._id === updated._id ? updated : item))
        } catch (error) { notify(error.message) }
    }
    async function loadVersions() {
        try { const result = await api(`/documents/${document._id}/versions`, { token: session.token }); setVersions(result.versions); setModal('history') }
        catch (error) { notify(error.message) }
    }
    async function saveVersion(event) {
        event.preventDefault()
        try {
            await api(`/documents/${document._id}/versions`, { token: session.token, method: 'POST', body: JSON.stringify({ title: versionTitle, content }) })
            setVersionTitle(''); setModal(''); notify('Version saved')
        } catch (error) { notify(error.message) }
    }
    async function restoreVersion(id) {
        try {
            await api(`/documents/${document._id}/versions/${id}/restore`, { token: session.token, method: 'POST' })
            setModal(''); notify('Version restored')
        } catch (error) { notify(error.message) }
    }
    async function shareDocument(event) {
        event.preventDefault()
        try {
            const { document: updated } = await api(`/documents/${document._id}/share`, { token: session.token, method: 'POST', body: JSON.stringify(share) })
            setDocument(updated); setCollaborators(updated.collaborators || []); setShare({ email: '', role: 'editor' }); notify('Access updated')
        } catch (error) { notify(error.message) }
    }
    const canEdit = document?.accessRole !== 'viewer'
    const isOwner = document?.accessRole === 'owner'

    if (!session?.token) return <main className="auth-shell">
        <section className="auth-side"><div className="brand brand-light"><span className="brand-mark">f</span> folio</div><div className="auth-pitch"><span className="eyebrow"><Sparkles size={14} /> A shared space for good thinking</span><h1>Write together.<br /><em>Stay in sync.</em></h1><p>A clear, calm place for your team’s ideas to take shape.</p><div className="auth-paper"><span>FIELD NOTES / 01</span><b>Ideas get better<br />when they meet.</b><i>Live collaboration · Versioned by design</i></div></div><span className="auth-footer">FOLIO WORKSPACE <span>© 2026</span></span></section>
        <section className="auth-main"><div className="auth-card"><div className="auth-mobile-brand brand"><span className="brand-mark">f</span> folio</div><span className="eyebrow auth-eyebrow">YOUR WORKSPACE AWAITS</span><h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p className="auth-subtitle">{authMode === 'login' ? 'Sign in to pick up where your team left off.' : 'Start a shared workspace for your best ideas.'}</p><form className="auth-form" onSubmit={submitAuth}>{authMode === 'register' && <label>Your name<input autoComplete="name" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} minLength={2} required /></label>}<label>Email address<input type="email" autoComplete="email" value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} required /></label><label>Password<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} minLength={8} required /></label><button className="button button-primary auth-submit">{authMode === 'login' ? 'Sign in' : 'Create account'} <ArrowLeft size={15} className="auth-arrow" /></button></form><p className="auth-switch">{authMode === 'login' ? 'New to folio?' : 'Already have an account?'} <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></p><div className="auth-assurance"><ShieldCheck size={15} /> Your documents are private and access-controlled.</div></div></section>{message && <div className="toast">{message}</div>}
    </main>

    return <main className={`app-shell ${sidebar ? '' : 'sidebar-collapsed'}`}>
        <aside className="sidebar"><div className="sidebar-head"><button className="brand" onClick={() => setDocument(null)}><span className="brand-mark">f</span> folio</button><button className="icon-button mobile-menu" title="Close sidebar" onClick={() => setSidebar(false)}><X size={17} /></button></div>
            <div className="workspace-picker"><span className="workspace-glyph">{session.user?.username?.[0]?.toUpperCase() || 'W'}</span><span className="workspace-label"><b>{session.user?.username || 'My workspace'}</b><small>Personal workspace</small></span><ChevronDown size={15} /></div>
            <button className="new-document" onClick={createDocument}><Plus size={16} /> New document <span>⌘ N</span></button>
            <div className="sidebar-section"><span className="section-label">YOUR DOCUMENTS</span><Search size={14} /></div><div className="search-wrap"><Search size={14} /><input placeholder="Find a document…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <nav className="document-list" aria-label="Documents">{filtered.map((item) => <button key={item._id} className={`document-link ${document?._id === item._id ? 'active' : ''}`} onClick={() => openDocument(item)}><FileText size={15} /><span>{item.title}</span>{item.accessRole !== 'owner' && <Users size={13} />}</button>)}{!filtered.length && <p className="empty-list">{query ? 'No matches found.' : 'Your documents will appear here.'}</p>}</nav>
            <div className="sidebar-bottom"><div className="profile-chip"><span className="profile-avatar">{session.user?.username?.[0]?.toUpperCase() || 'U'}</span><span><b>{session.user?.username}</b><small>{session.user?.email}</small></span><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={15} /></button></div></div>
        </aside>
        <section className="work-area"><header className="topbar"><div className="topbar-left"><button className="icon-button sidebar-toggle" title={sidebar ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button><span className="crumb">Workspace</span><span className="crumb-divider">/</span><span className="crumb-current">{document?.title || 'Documents'}</span></div>{document && <div className="topbar-right"><div className="presence-stack" aria-label={`${presence.length + 1} people online`}><span className="presence-avatar self-avatar" title={session.user?.username}>{session.user?.username?.[0]?.toUpperCase()}</span>{presence.slice(0, 3).map((person) => <span className="presence-avatar" key={person.id} title={person.username}>{person.username?.[0]?.toUpperCase()}</span>)}{presence.length > 3 && <span className="presence-more">+{presence.length - 3}</span>}</div><span className="save-state"><i className="live-dot" />{saving ? 'Saving' : 'Live'}</span><button className="button button-outline share-button" onClick={() => setModal('share')}><Share2 size={14} /> Share</button></div>}</header>
            {document ? <><div className="editor-toolbar"><div className="document-meta"><span><FileText size={14} /> Edited {new Date(document.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><i>·</i><span>{collaborators.length + 1} people with access</span></div><div className="toolbar-actions"><button className={`toolbar-tab ${!preview ? 'selected' : ''}`} onClick={() => setPreview(false)}>Write</button><button className={`toolbar-tab ${preview ? 'selected' : ''}`} onClick={() => setPreview(true)}>Preview</button><span className="toolbar-separator" /><button className="icon-button" title="Version history" onClick={loadVersions}><History size={16} /></button><button className="toolbar-save" onClick={() => setModal('save')}><Clock3 size={15} /><span>Save version</span></button></div></div>
                <div className={`editor-stage ${preview ? '' : 'write-only'}`}><div className="editor-pane"><div className="paper-column"><input className="document-title" aria-label="Document title" key={document._id} defaultValue={document.title} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} readOnly={!canEdit} /><div className="author-line"><span className="author-avatar">{(document.owner?.username || session.user?.username)?.[0]?.toUpperCase()}</span><span>{document.owner?.username || session.user?.username}</span><i>·</i><span>Markdown</span>{!canEdit && <span className="read-only-tag">VIEW ONLY</span>}</div><textarea className="markdown-input" aria-label="Markdown document content" value={content} onChange={(e) => edit(e.target.value)} readOnly={!canEdit} spellCheck /></div></div>
                    {preview && <div className="preview-pane"><div className="preview-heading"><span>PREVIEW</span><span>MARKDOWN</span></div><article className="markdown-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(content || '')) }} /></div>}</div>
                <footer className="editor-footer"><span><i className="footer-live-dot" /> All changes synced</span><span>{content.trim() ? content.trim().split(/\s+/).length : 0} words <i>·</i> {content.length} characters</span></footer></> : <section className="home-view"><div className="home-kicker"><i className="live-dot" /> YOUR WORKSPACE</div><h1>Make room for<br /><em>good ideas.</em></h1><p>Every document is a place to think clearly, write freely, and work together.</p><button className="button button-primary home-create" onClick={createDocument}><FilePlus2 size={16} /> Create a document</button><div className="home-rule"><span>RECENT DOCUMENTS</span><i /></div><div className="recent-list">{filtered.slice(0, 5).map((item) => <button className="recent-row" key={item._id} onClick={() => openDocument(item)}><span className="recent-icon"><FileText size={17} /></span><span className="recent-title"><b>{item.title}</b><small>Edited {new Date(item.updatedAt).toLocaleDateString()}</small></span><span className="recent-role">{item.accessRole === 'owner' ? 'Owner' : 'Shared'}</span></button>)}{!documents.length && <div className="empty-recent">No documents yet. Create one to start writing.</div>}</div></section>}</section>
        {modal === 'share' && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModal('')}><section className="modal"><div className="modal-head"><div><span className="eyebrow">COLLABORATION</span><h2>Share document</h2></div><button className="icon-button" onClick={() => setModal('')} aria-label="Close"><X size={18} /></button></div><p className="modal-intro">Invite someone by email. Editors can write; viewers can read.</p><form className="share-form" onSubmit={shareDocument}><label className="field-label">Email address<input type="email" placeholder="name@company.com" value={share.email} onChange={(e) => setShare({ ...share, email: e.target.value })} required /></label><label className="field-label">Permission<select value={share.role} onChange={(e) => setShare({ ...share, role: e.target.value })}><option value="editor">Can edit</option><option value="viewer">Can view</option></select></label><button className="button button-primary" disabled={!isOwner}>Invite to document <Plus size={15} /></button>{!isOwner && <small className="permission-note">Only the owner can change access.</small>}</form><div className="modal-list-label">PEOPLE WITH ACCESS <span>{collaborators.length + 1}</span></div><div className="access-list"><div className="access-person"><span className="profile-avatar">{document.owner?.username?.[0]?.toUpperCase() || 'U'}</span><span><b>{document.owner?.username || session.user?.username}</b><small>{document.owner?.email || session.user?.email}</small></span><span className="role-label">Owner</span></div>{collaborators.map((person) => <div className="access-person" key={person.user?._id}><span className="profile-avatar alt-avatar">{person.user?.username?.[0]?.toUpperCase() || '?'}</span><span><b>{person.user?.username || 'Collaborator'}</b><small>{person.user?.email}</small></span><span className="role-label">{person.role}</span></div>)}</div></section></div>}
        {modal === 'save' && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModal('')}><section className="modal modal-small"><div className="modal-head"><div><span className="eyebrow">VERSION HISTORY</span><h2>Save a version</h2></div><button className="icon-button" onClick={() => setModal('')} aria-label="Close"><X size={18} /></button></div><form className="share-form" onSubmit={saveVersion}><label className="field-label">Version name<input autoFocus placeholder="e.g. First draft" value={versionTitle} onChange={(e) => setVersionTitle(e.target.value)} required maxLength={80} /></label><button className="button button-primary">Save snapshot <Check size={15} /></button></form></section></div>}
        {modal === 'history' && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModal('')}><section className="modal"><div className="modal-head"><div><span className="eyebrow">DOCUMENT TIMELINE</span><h2>Version history</h2></div><button className="icon-button" onClick={() => setModal('')} aria-label="Close"><X size={18} /></button></div><p className="modal-intro">Restore a snapshot. The current document is saved before rollback.</p><div className="version-list">{versions.map((version) => <div className="version-row" key={version._id}><span className="version-icon"><History size={15} /></span><span className="version-details"><b>{version.title}</b><small>{new Date(version.createdAt).toLocaleString()} · {version.createdBy?.username || 'A collaborator'}</small></span><button className="button button-outline restore-button" onClick={() => restoreVersion(version._id)} disabled={!canEdit}>Restore</button></div>)}{!versions.length && <div className="empty-recent">No saved versions yet.</div>}</div></section></div>}
        {message && <div className="toast"><Check size={15} /> {message}</div>}
    </main>
}
