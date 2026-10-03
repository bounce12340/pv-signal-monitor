# CLAUDE.md

Pharmacovigilance web app: AE-master extraction from drug labels + quarterly Poisson-CI signal
monitoring, merged with a PubMed literature-monitoring pipeline (search → AI review → library →
CIOMS/E2B draft) and a literature-based ingredient×MedDRA-PT signal aggregation. Single Cloudflare
Worker deployment (static assets + `/llm` proxy + `/api/sync`), no separate backend service.

## Layering — do not cross these boundaries

- **components/** (incl. `components/literature/`) are container UI only: no `fetch`, no LLM
  calls, no storage reads/writes of their own. Everything goes through `services/*`.
- **services/llm.ts** is the *only* place allowed to call an LLM (`geminiGenerate`/`openaiChat`) or
  parse model JSON (`parseJsonLoose`). `services/ai.ts` (label extraction) and
  `services/literature/llmService.ts` (literature prompts) both route through it — do not add a
  second `fetch` to an LLM endpoint or a second JSON-repair regex anywhere else.
- **services/storage.ts** is the *only* place allowed to touch IndexedDB/localStorage directly.
  `services/db.ts`, `services/settings.ts`, and `services/literature/storage.ts` are all thin
  callers of `loadSync`/`save`/`loadAsync` — do not add a raw `localStorage.*` or `indexedDB.*` call
  elsewhere. **One deliberate exception:** `services/sync.ts` keeps `pv_sync_meta` in raw
  localStorage on purpose. It is a *per-device* sync cursor (`server_updated_at`/`last_hash`), so it
  must NOT be routed through `storage.ts` or added to a `*_KEY_LIST` — doing so would pull it into
  `db.exportAll`'s D1 snapshot, replicate one device's cursor to every other device, and break
  drift detection.
- **worker/index.ts** routes requests. By itself it has no knowledge of PV domain logic — it
  proxies `/llm/*` and `/ollama-cloud/*` to an OpenAI-compatible upstream and persists sync
  snapshots to D1 under `/api/sync*`.
- **worker/ae/** is the adverse-event (AE) case API (`/api/ae-reports*`, `/api/me`), ported verbatim
  from PV-Link (plain JS; `services/ae/caseWorkModel.js` is shared with it). `worker/index.ts` only
  verifies identity and hands it the AE bindings (`AE_DB`, `AE_FILES`) — never `DB`, so AE code can't
  touch the sync snapshots and vice versa. `services/ae/aeReport.ts` is the frontend domain model whose
  seriousness/due-date rules `worker/ae/ae.js` mirrors; `worker/ae/ae.test.ts` cross-checks the two.

## Invariants that will silently break things if violated

- `PVRecord.dp` (and anywhere else a literature date is stored) must stay `YYYY-MM-DD`.
  `LiteratureLibraryMode.tsx` filters with `new Date(r.dp)` — a non-ISO string parses inconsistently
  across browsers and silently drops/keeps the wrong rows. `services/literature/pubmed.ts`'s
  `extractPubDate`/`resolveMonth` already encode this; don't bypass them.
  it is *edat* (PubMed entry date), not *pdat* (publication date) — see `pubmed.ts` esearch `datetype` param.
- No API key, upstream URL, or other secret belongs in frontend code, `wrangler.jsonc` `vars`, or
  git history. The only secret is `OLLAMA_API_KEY`, set via `wrangler secret put` and read solely by
  `worker/index.ts`. `wrangler.jsonc` intentionally sets `"workers_dev": false` — the Worker injects
  that key into unauthenticated requests, so a `workers.dev` URL would be an open proxy for it; the
  only route is the custom domain sitting behind an access-control layer in front of it.
- `services/db.ts` / `services/settings.ts` expose a **synchronous** read API backed by an
  in-memory cache hydrated at boot (`index.tsx` → `initStorage`). Don't add new persisted keys
  without adding them to the relevant `*_KEY_LIST` export, or they won't be hydrated, migrated, or
  captured in the D1 sync snapshot (`db.exportAll`/`importAll`, schema `pv-signal-monitor-backup`).
- AE API identity comes **only** from a verified Access JWT (`worker/accessJwt.ts`: signature, `iss`,
  `aud`, `exp`, pinned RS256) — not from the `Cf-Access-Authenticated-User-Email` header `/api/sync`
  uses. The actor is written into an append-only audit trail (`ae_audit`, guarded by DB triggers), so
  no request content may ever choose it. Half-configured Access (`ACCESS_TEAM_DOMAIN` without
  `ACCESS_AUD` or vice versa) is a 503, a missing/invalid token a 401.
- AE roles are enforced in `worker/ae/ae.js`, not in the UI: anyone not listed as PV (`AE_PV_EMAILS`
  secret or `ae_users.role = 'pv'`) is a rep and only sees cases they submitted. `AE_PV_EMAILS` holds
  real staff addresses — `wrangler secret put` only, never `vars`.
- AE schema changes (`worker/ae/schema.sql`, `worker/ae/migrations/`) are applied to D1 by hand after a
  backup; CI never runs migrations.
- MedDRA seed dictionary (`services/literature/meddra.ts`) is a small hand-picked list, not a
  licensed MedDRA distribution — don't treat an unmatched PT as an error; `matched: false` is an
  expected, common outcome that the UI must keep surfacing to the user for manual SOC assignment.

## Verification (run all three before claiming anything works)

```bash
npx tsc --noEmit   # must be 0 errors
npm test           # currently 20 test files / 285 tests passing (worker/ae tests need Node ≥ 22.5 for node:sqlite)
npm run build      # vite build must succeed (pdf.js/lucide chunk-size warning is expected, not an error)
```

## Deployment

`npm run build && npx wrangler deploy`. Requires the D1 database and `snapshots` table (see
`worker/index.ts`), and — for the platform-default LLM proxy and the Ollama-Cloud alias to actually
authenticate — the `OLLAMA_API_KEY` Worker secret. `wrangler.jsonc` `vars.LLM_BASE_URL` controls the
upstream for `/llm/*`; the app itself never reads a `.env` file.

The AE case API additionally binds the existing PV-Link D1 database `pv-link-ae` (`AE_DB`) and R2
bucket `pv-link-ae-attachments` (`AE_FILES`), verifies Access JWTs against `ACCESS_TEAM_DOMAIN` /
`ACCESS_AUD` (the AUD tag of the pv.uic-ai.com Access application), and needs the `AE_PV_EMAILS`
secret before anyone is treated as PV staff.
