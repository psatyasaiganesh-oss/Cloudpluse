import type { Store, Service, Check, Incident, Health, Snapshot } from "./types.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const iso = () => new Date().toISOString();
const healthStates: Health[] = ["healthy", "degraded", "down"];
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const result = (value: unknown, status = 200) => Response.json(value, { status, headers });
function text(value: unknown, field: string, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, `${field} must contain 1–${max} characters.`);
  return value.trim();
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 8192) throw new ApiError(413, "Request is too large.");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new ApiError(400, "Send a valid JSON object."); }
}
export function validateTarget(target: string, allowedHosts: string[]) {
  let url: URL;
  try { url = new URL(target); } catch { throw new ApiError(400, "Enter a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new ApiError(400, "Use HTTPS on port 443 without embedded credentials.");
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || /^(localhost|\d[\d.]*|.*\.local|.*\.internal|.*\.localhost)$/.test(host)) throw new ApiError(400, "Use a public domain name.");
  if (!allowedHosts.includes(host)) throw new ApiError(400, `This host is not enabled. Allowed hosts: ${allowedHosts.join(", ") || "none"}. See the deployment guide to enable your domain.`);
  if (url.href.length > 1024) throw new ApiError(400, "URL must be at most 1024 characters.");
  return url.href;
}

export async function seed(store: Store) {
  const now = Date.now();
  const rows: Service[] = [
    { id: "svc-api", name: "Commerce API", target: "demo://commerce-api", region: "ap-south-1", group: "API", mode: "demo", demoState: "healthy", paused: false, createdAt: iso() },
    { id: "svc-web", name: "Web storefront", target: "demo://web-storefront", region: "ap-south-1", group: "Web", mode: "demo", demoState: "healthy", paused: false, createdAt: iso() },
    { id: "svc-worker", name: "Order processor", target: "demo://order-processor", region: "ap-south-1", group: "Worker", mode: "demo", demoState: "degraded", paused: false, createdAt: iso() },
    { id: "svc-health", name: "CloudPulse API", target: "internal://health", region: "current runtime", group: "API", mode: "internal", demoState: "healthy", paused: false, createdAt: iso() },
  ];
  for (const svc of rows) {
    if (!await store.insert("service", svc.id, svc)) continue;
    if (svc.mode !== "demo") continue;
    const history: Check[] = Array.from({ length: 36 }, (_, i) => ({
      id: `sample-${svc.id}-${i}`, serviceId: svc.id,
      checkedAt: new Date(now - (36 - i) * 60000).toISOString(),
      status: svc.id === "svc-worker" && i >= 26 ? "degraded" : "healthy",
      latencyMs: Math.round((svc.id === "svc-web" ? 72 : svc.id === "svc-worker" && i >= 26 ? 1250 : 140) + Math.sin(i * 1.7) * 22 + i % 5 * 7),
      message: "Seeded practice measurement", simulated: true,
    }));
    await store.put("checks", svc.id, history);
  }
  await store.insert("incident", "sample-order-latency", {
    id: "sample-order-latency", title: "Order processing latency elevated", description: "Practice incident: the order processor is responding slowly. Use the simulator to restore health and observe recovery.", serviceId: "svc-worker", severity: "warning", status: "open", source: "manual", createdAt: new Date(now - 10 * 60000).toISOString(), updatedAt: iso(), resolvedAt: null, notes: [{ at: iso(), text: "Seeded practice incident. No live AWS workload is affected." }],
  } satisfies Incident);
}

export async function snapshot(store: Store, allowedHosts: string[], mode: string): Promise<Snapshot> {
  const [rawServices, incidents] = await Promise.all([store.list<Service>("service", 24), store.list<Incident>("incident", 300)]);
  const services = await Promise.all(rawServices.map(async svc => {
    const checks = (await store.get<Check[]>("checks", svc.id)) ?? [];
    const last = checks.at(-1);
    const up = checks.filter(c => c.status !== "down").length;
    return { ...svc, status: last?.status ?? "unknown" as const, checks, uptime: checks.length ? up / checks.length * 100 : null, latency: last?.latencyMs ?? null, lastCheckedAt: last?.checkedAt ?? null };
  }));
  services.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  incidents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const allChecks = services.flatMap(s => s.checks);
  const buckets = new Map<string, { latency: number; count: number }>();
  for (const check of allChecks) {
    if (check.latencyMs === null) continue;
    const at = check.checkedAt.slice(0, 16) + ":00Z";
    const b = buckets.get(at) ?? { latency: 0, count: 0 };
    b.latency += check.latencyMs; b.count++; buckets.set(at, b);
  }
  const latencies = services.flatMap(s => s.latency === null ? [] : [s.latency]);
  return {
    services, incidents, allowedHosts, generatedAt: iso(), mode,
    stats: { healthy: services.filter(s => !s.paused && s.status === "healthy").length, degraded: services.filter(s => !s.paused && s.status === "degraded").length, down: services.filter(s => !s.paused && s.status === "down").length, total: services.length, uptime: allChecks.length ? allChecks.filter(c => c.status !== "down").length / allChecks.length * 100 : null, latency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null, activeIncidents: incidents.filter(i => i.status !== "resolved").length, checks: allChecks.length },
    series: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-60).map(([at, b]) => ({ at, latency: Math.round(b.latency / b.count), count: b.count })),
  };
}

async function probe(svc: Service, store: Store, hosts: string[]): Promise<Check> {
  const start = performance.now();
  let status: Health = "healthy", latencyMs: number | null = null, message = "HTTP 200";
  try {
    if (svc.mode === "demo") {
      status = svc.demoState;
      latencyMs = status === "down" ? null : Math.round((status === "degraded" ? 1200 : svc.group === "Web" ? 80 : 140) + Math.random() * 80);
      message = `Simulated ${status === "down" ? "timeout" : status === "degraded" ? "slow response" : "HTTP 200"}`;
    } else if (svc.mode === "internal") {
      await store.ping(); latencyMs = Math.max(1, Math.round(performance.now() - start)); message = "API and database ready";
    } else {
      const target = validateTarget(svc.target, hosts);
      const response = await fetch(target, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(7000), headers: { "User-Agent": "CloudPulse/1.0", "Accept": "application/json, text/plain, */*" } });
      latencyMs = Math.max(1, Math.round(performance.now() - start));
      await response.body?.cancel();
      status = response.status >= 200 && response.status < 300 ? (latencyMs > 1000 ? "degraded" : "healthy") : "down";
      message = `HTTP ${response.status}${response.status >= 300 && response.status < 400 ? " (redirects are not followed)" : ""}`;
    }
  } catch (e) { status = "down"; message = e instanceof ApiError ? e.message : "Probe failed or timed out"; }
  return { id: crypto.randomUUID(), serviceId: svc.id, checkedAt: iso(), status, latencyMs, message, simulated: svc.mode === "demo" };
}

export async function runChecks(store: Store, hosts: string[]) {
  const owner = crypto.randomUUID();
  if (!await store.acquireLease("probe-batch", owner, 60)) throw new ApiError(409, "Health checks are already running. Refresh in a few seconds.");
  try {
    const services = (await store.list<Service>("service", 24)).filter(s => !s.paused);
    const checks: Check[] = [];
    // Four probes at a time: bounded network and database load.
    for (let i = 0; i < services.length; i += 4) {
      const batch = await Promise.all(services.slice(i, i + 4).map(s => probe(s, store, hosts)));
      for (const check of batch) {
        const svc = services.find(s => s.id === check.serviceId)!;
        const history = await store.get<Check[]>("checks", svc.id) ?? [];
        await store.put("checks", svc.id, [...history, check].slice(-96));
        const incidents = (await store.list<Incident>("incident", 300)).filter(i => i.serviceId === svc.id && i.status !== "resolved");
        if (check.status !== "healthy" && !incidents.length) {
          const id = crypto.randomUUID(), at = iso();
          await store.put("incident", id, { id, title: `${svc.name} ${check.status === "down" ? "is unavailable" : "is responding slowly"}`, description: check.message, serviceId: svc.id, severity: check.status === "down" ? "critical" : "warning", status: "open", source: "monitor", createdAt: at, updatedAt: at, resolvedAt: null, notes: [{ at, text: `Opened automatically after a ${check.simulated ? "simulated" : "live"} probe.` }] } satisfies Incident);
        } else if (check.status === "healthy") {
          for (const incident of incidents.filter(i => i.source === "monitor")) {
            const at = iso(); await store.put("incident", incident.id, { ...incident, status: "resolved", updatedAt: at, resolvedAt: at, notes: [...incident.notes, { at, text: "Resolved automatically after a healthy probe." }].slice(-30) });
          }
        }
        checks.push(check);
      }
    }
    return checks;
  } finally { await store.releaseLease("probe-batch", owner); }
}

export async function handleApi(request: Request, store: Store, options: { allowedHosts?: string; mode?: string } = {}) {
  const url = new URL(request.url), path = url.pathname.replace(/\/$/, "");
  const hosts = (options.allowedHosts ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  try {
    if (path === "/api/health" && request.method === "GET") { await store.ping(); return result({ status: "ok", database: "ready", timestamp: iso() }); }
    if (!["GET", "POST", "PATCH"].includes(request.method)) throw new ApiError(405, "Method not allowed.");
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) throw new ApiError(403, "Cross-origin writes are not allowed.");
      if (request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "Cross-site writes are not allowed.");
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ApiError(415, "Use application/json.");
    }
    await seed(store);
    if (path === "/api/dashboard" && request.method === "GET") return result(await snapshot(store, hosts, options.mode ?? "practice"));
    if (path === "/api/checks" && request.method === "POST") return result({ checks: await runChecks(store, hosts) });
    if (path === "/api/services" && request.method === "POST") {
      const b = await body(request);
      if ((await store.list("service", 25)).length >= 24) throw new ApiError(400, "This workspace supports up to 24 monitors.");
      const mode = b.mode === "demo" ? "demo" : "http";
      const svc: Service = { id: crypto.randomUUID(), name: text(b.name, "Name", 80), target: mode === "http" ? validateTarget(text(b.target, "URL", 1024), hosts) : "demo://custom-service", mode, region: text(b.region ?? "ap-south-1", "Region", 40), group: text(b.group ?? "API", "Group", 40), demoState: "healthy", paused: false, createdAt: iso() };
      await store.put("service", svc.id, svc); return result({ service: svc }, 201);
    }
    const svcMatch = path.match(/^\/api\/services\/([a-zA-Z0-9-]+)$/);
    if (svcMatch && request.method === "PATCH") {
      const svc = await store.get<Service>("service", svcMatch[1]); if (!svc) throw new ApiError(404, "Monitor not found.");
      const b = await body(request);
      if (b.demoState !== undefined) {
        if (svc.mode !== "demo" || !healthStates.includes(b.demoState as Health)) throw new ApiError(400, "Only practice monitors support simulated states.");
        svc.demoState = b.demoState as Health;
      }
      if (b.paused !== undefined) { if (typeof b.paused !== "boolean") throw new ApiError(400, "Paused must be a boolean."); svc.paused = b.paused; }
      await store.put("service", svc.id, svc); return result({ service: svc });
    }
    if (path === "/api/incidents" && request.method === "POST") {
      const b = await body(request), serviceId = text(b.serviceId, "Monitor", 80);
      if (!await store.get("service", serviceId)) throw new ApiError(404, "Monitor not found.");
      if (!(["warning", "critical"].includes(b.severity as string))) throw new ApiError(400, "Choose warning or critical severity.");
      if ((await store.list("incident", 301)).length >= 300) throw new ApiError(400, "Incident history is full (300 records).");
      const at = iso(), id = crypto.randomUUID();
      const incident: Incident = { id, title: text(b.title, "Title", 160), description: text(b.description, "Description", 2000), serviceId, severity: b.severity as Incident["severity"], status: "open", source: "manual", createdAt: at, updatedAt: at, resolvedAt: null, notes: [{ at, text: "Incident reported manually." }] };
      await store.put("incident", id, incident); return result({ incident }, 201);
    }
    const incidentMatch = path.match(/^\/api\/incidents\/([a-zA-Z0-9-]+)$/);
    if (incidentMatch && request.method === "PATCH") {
      const incident = await store.get<Incident>("incident", incidentMatch[1]); if (!incident) throw new ApiError(404, "Incident not found.");
      const b = await body(request);
      if (!["acknowledged", "resolved"].includes(b.status as string)) throw new ApiError(400, "Choose acknowledged or resolved.");
      if (incident.status === "resolved") throw new ApiError(409, "This incident is already resolved.");
      if (incident.status === "acknowledged" && b.status === "acknowledged") throw new ApiError(409, "This incident is already acknowledged.");
      const at = iso(); incident.status = b.status as Incident["status"]; incident.updatedAt = at;
      if (incident.status === "resolved") incident.resolvedAt = at;
      incident.notes = [...incident.notes, { at, text: `${incident.status === "resolved" ? "Resolved" : "Acknowledged"}${b.note ? `: ${text(b.note, "Note", 1000)}` : "."}` }].slice(-30);
      await store.put("incident", incident.id, incident); return result({ incident });
    }
    throw new ApiError(404, "Endpoint not found.");
  } catch (e) {
    if (e instanceof ApiError) return result({ error: e.message }, e.status);
    console.error("cloudpulse_api_failure", e); return result({ error: "The workspace is temporarily unavailable. Please retry." }, 503);
  }
}
