# CloudPulse API

All application requests use the same origin as the dashboard. JSON writes require `Content-Type: application/json`. The AWS/local production server protects every application endpoint with HTTP Basic Auth; `/api/health` remains unauthenticated for load-balancer readiness.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Database readiness; returns 200 or 503 |
| GET | `/api/dashboard` | Monitors, retained checks, incidents, computed metrics |
| POST | `/api/checks` | Run probes and automatic incident transitions |
| POST | `/api/services` | Add a practice or allowed HTTPS monitor |
| PATCH | `/api/services/:id` | Set `paused` or practice `demoState` |
| POST | `/api/incidents` | Report a manual incident |
| PATCH | `/api/incidents/:id` | Acknowledge or resolve with an optional note |

Example monitor:

```json
{"name":"Billing API","mode":"demo","region":"ap-south-1","group":"API"}
```

For a live monitor, use `"mode":"http"` and `"target":"https://your-allowed-host/health"`.

Example incident:

```json
{"title":"Checkout unavailable","description":"Customers receive errors.","serviceId":"svc-api","severity":"critical"}
```

Example transition:

```json
{"status":"resolved","note":"Restored the previous release and verified health."}
```

`400`: invalid input or disabled target. `401`: password required. `403`: cross-origin write. `404`: missing monitor/incident. `409`: checks already running or invalid incident transition. `413`: body too large. `415`: unsupported content type. `503`: persistence unavailable.

A monitor's group and region are labels provided by the user; they are not discovered from an AWS account. The dashboard does not read AWS metrics; its metrics come from health probes. The separate CloudWatch dashboard observes the actual deployed AWS resources.
