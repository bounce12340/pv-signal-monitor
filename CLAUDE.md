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
- **worker/index.ts** is the only server-side code. It has no knowledge of PV domain logic — it
  only proxies `/llm/*` and `/ollama-cloud/*` to an OpenAI-compatible upstream and persists sync
  snapshots to D1 under `/api/*`.

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
- MedDRA seed dictionary (`services/literature/meddra.ts`) is a small hand-picked list, not a
  licensed MedDRA distribution — don't treat an unmatched PT as an error; `matched: false` is an
  expected, common outcome that the UI must keep surfacing to the user for manual SOC assignment.

## Verification (run all three before claiming anything works)

```bash
npx tsc --noEmit   # must be 0 errors
npm test           # currently 13 test files / 94 tests passing
npm run build      # vite build must succeed (pdf.js/lucide chunk-size warning is expected, not an error)
```

## Deployment

`npm run build && npx wrangler deploy`. Requires the D1 database and `snapshots` table (see
`worker/index.ts`), and — for the platform-default LLM proxy and the Ollama-Cloud alias to actually
authenticate — the `OLLAMA_API_KEY` Worker secret. `wrangler.jsonc` `vars.LLM_BASE_URL` controls the
upstream for `/llm/*`; the app itself never reads a `.env` file.
