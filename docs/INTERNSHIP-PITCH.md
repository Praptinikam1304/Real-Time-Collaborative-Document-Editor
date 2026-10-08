# Folio: Internship Project Pitch

## 30-second overview

Folio is a full-stack collaborative Markdown editor. Multiple people can edit the same document in real time, while Yjs CRDT updates keep concurrent changes consistent. The project also includes account authentication, owner/editor/viewer access, MongoDB persistence, version snapshots, and rollback.

## Resume bullet draft

Built a MERN-based collaborative Markdown editor using Yjs CRDTs and Socket.IO, with JWT authentication, role-based document sharing, MongoDB persistence, and version restore.

Keep the bullet factual and add scale or impact only after measuring it yourself.

## Demo walkthrough

1. Register two accounts in separate browser sessions.
2. Create a document and add a heading, list, and paragraph in Markdown.
3. Share the document with the second account as an editor.
4. Open the shared document in both sessions and make overlapping edits.
5. Save a named version, make another change, then restore the saved version.
6. Re-share the second account with the Can view permission and confirm the document becomes read-only for that account.

## Technical discussion

- **Conflict handling:** Yjs models document text as a shared CRDT. Socket.IO distributes updates; each client merges updates rather than replacing the entire saved document.
- **Persistence:** MongoDB stores the Yjs state and a readable Markdown projection. Named versions store snapshots for rollback.
- **Access control:** JWTs identify users. The API checks document ownership and collaborator roles, and the Socket.IO join path checks access before joining a document room.
- **Tradeoff:** The editor uses a Markdown textarea rather than a rich-text block editor. This keeps the data model transparent and makes Markdown portable, while leaving richer formatting controls as a possible extension.

## Local demo setup

Follow the requirements and startup steps in the project [README](../README.md). For a real two-person demo, use two browser profiles or a private window so each account has a separate session.