// Pushes data/library.json into Firestore (items/* + meta/library). Runs in GitHub Actions with a service account.
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const lib = JSON.parse(readFileSync('data/library.json', 'utf8'));
const { items: _items, ...meta } = lib;
// Store the library in a few large documents so each app open costs 1 read per ~400 posts.
const SIZE = 400, chunks = [];
for (let i = 0; i < lib.items.length; i += SIZE) chunks.push(lib.items.slice(i, i + SIZE));
for (const [i, c] of chunks.entries()) await db.doc(`lib/chunk_${i}`).set({ items: c });
const old = (await db.doc('meta/library').get()).data()?.chunks || 0;
for (let i = chunks.length; i < old; i++) await db.doc(`lib/chunk_${i}`).delete();
await db.doc('meta/library').set({ ...meta, chunks: chunks.length });
console.log(`Library stored in ${chunks.length} chunk doc(s).`);
const existing = new Set((await db.collection('items').listDocuments()).map(d => d.id));
let batch = db.batch(), n = 0, added = 0;
for (const it of lib.items) {
  if (!existing.has(it.id)) added++;
  batch.set(db.doc(`items/${it.id}`), it);
  if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
}
await batch.commit();
console.log(`Upserted ${lib.items.length} items (${added} new).`);
