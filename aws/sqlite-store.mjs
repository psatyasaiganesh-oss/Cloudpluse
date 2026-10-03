import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function sqliteStore(filename = './data/cloudpulse.db') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,expires_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind,id));');
  return {
    async get(kind,id) { const r=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.data):null; },
    async list(kind,limit=300) {return db.prepare('SELECT data FROM records WHERE kind=? ORDER BY id LIMIT ?').all(kind,limit).map(r=>JSON.parse(r.data));},
    async put(kind,id,value,expiresAt=0) {db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at').run(kind,id,JSON.stringify(value),expiresAt);},
    async insert(kind,id,value,expiresAt=0) {return db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO NOTHING').run(kind,id,JSON.stringify(value),expiresAt).changes>0;},
    async acquireLease(id,owner,seconds) {const now=Math.floor(Date.now()/1000);return db.prepare("INSERT INTO records VALUES('lease',?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at WHERE records.expires_at<?").run(id,JSON.stringify(owner),now+seconds,now).changes>0;},
    async releaseLease(id,owner) {db.prepare("DELETE FROM records WHERE kind='lease' AND id=? AND data=?").run(id,JSON.stringify(owner));},
    async ping() {db.prepare('SELECT 1 FROM records LIMIT 1').all();},
    close() {db.close();},
  };
}
