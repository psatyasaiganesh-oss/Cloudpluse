import { env } from "cloudflare:workers";
import { handleApi } from "../../../core/api.ts";
import { d1Store } from "../../../db/store.ts";

async function handle(request: Request) {
  if (!env.DB) return Response.json({ error: "Database is unavailable. Please retry later." }, { status: 503 });
  return handleApi(request, d1Store(env.DB), { allowedHosts: env.MONITOR_ALLOWED_HOSTS, mode: "Private practice workspace" });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
