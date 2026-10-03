import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const records = sqliteTable("records", {
  kind: text("kind").notNull(),
  id: text("id").notNull(),
  data: text("data").notNull(),
  expiresAt: integer("expires_at").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.kind, t.id] })]);
