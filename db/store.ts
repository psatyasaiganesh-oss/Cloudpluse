import type { Store } from "../core/types.ts";

export function d1Store(db: D1Database): Store {
  return {
    async get<T>(kind: string, id: string) {
      const row = await db.prepare("SELECT data FROM records WHERE kind = ? AND id = ?").bind(kind, id).first<{ data: string }>();
      return row ? JSON.parse(row.data) as T : null;
    },
    async list<T>(kind: string, limit = 300) {
      const rows = await db.prepare("SELECT data FROM records WHERE kind = ? ORDER BY id LIMIT ?").bind(kind, limit).all<{ data: string }>();
      return rows.results.map(r => JSON.parse(r.data) as T);
    },
    async put<T>(kind: string, id: string, value: T, expiresAt = 0) {
      await db.prepare("INSERT INTO records(kind,id,data,expires_at) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at").bind(kind, id, JSON.stringify(value), expiresAt).run();
    },
    async insert<T>(kind: string, id: string, value: T, expiresAt = 0) {
      const r = await db.prepare("INSERT INTO records(kind,id,data,expires_at) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO NOTHING").bind(kind, id, JSON.stringify(value), expiresAt).run();
      return r.meta.changes > 0;
    },
    async acquireLease(id, owner, seconds) {
      const now = Math.floor(Date.now()/1000);
      const r = await db.prepare("INSERT INTO records(kind,id,data,expires_at) VALUES('lease',?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at WHERE records.expires_at < ?").bind(id, JSON.stringify(owner), now + seconds, now).run();
      return r.meta.changes > 0;
    },
    async releaseLease(id, owner) {
      await db.prepare("DELETE FROM records WHERE kind='lease' AND id=? AND data=?").bind(id, JSON.stringify(owner)).run();
    },
    async ping() { await db.prepare("SELECT 1 FROM records LIMIT 1").all(); },
  };
}
