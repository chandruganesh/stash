// Pushes data/library.json into Firestore (items/* + meta/library). Runs in GitHub Actions with a service account.
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const lib = JSON.parse(readFileSync('data/library.json', 'utf8'));
await db.doc('meta/library').set({ updated: lib.updated, shelves: lib.shelves });
const existing = new Set((await db.collection('items').listDocuments()).map(d => d.id));
let batch = db.batch(), n = 0, added = 0;
for (const it of lib.items) {
  if (!existing.has(it.id)) added++;
  batch.set(db.doc(`items/${it.id}`), it);
  if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
}
await batch.commit();
console.log(`Upserted ${lib.items.length} items (${added} new).`);
