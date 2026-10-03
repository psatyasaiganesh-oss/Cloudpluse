export type Health = "healthy" | "degraded" | "down";
export type Service = {
  id: string; name: string; target: string; region: string;
  group: string; mode: "demo" | "http" | "internal";
  demoState: Health; paused: boolean; createdAt: string;
};
export type Check = {
  id: string; serviceId: string; checkedAt: string; status: Health;
  latencyMs: number | null; message: string; simulated: boolean;
};
export type Incident = {
  id: string; title: string; description: string; serviceId: string;
  severity: "critical" | "warning"; status: "open" | "acknowledged" | "resolved";
  source: "manual" | "monitor"; createdAt: string; updatedAt: string;
  resolvedAt: string | null; notes: { at: string; text: string }[];
};
export type Store = {
  get<T>(kind: string, id: string): Promise<T | null>;
  list<T>(kind: string, limit?: number): Promise<T[]>;
  put<T>(kind: string, id: string, value: T, expiresAt?: number): Promise<void>;
  insert<T>(kind: string, id: string, value: T, expiresAt?: number): Promise<boolean>;
  acquireLease(id: string, owner: string, seconds: number): Promise<boolean>;
  releaseLease(id: string, owner: string): Promise<void>;
  ping(): Promise<void>;
};
export type Snapshot = {
  services: (Service & { status: Health | "unknown"; checks: Check[]; uptime: number | null; latency: number | null; lastCheckedAt: string | null })[];
  incidents: Incident[];
  stats: { healthy: number; degraded: number; down: number; total: number; uptime: number | null; latency: number | null; activeIncidents: number; checks: number };
  series: { at: string; latency: number; count: number }[];
  generatedAt: string; mode: string; allowedHosts: string[];
};
