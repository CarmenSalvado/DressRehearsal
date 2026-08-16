# Dress Rehearsal

Pre-production demand validation for fashion manufacturers, built for the [YouCam API Skin AI & Apparel VTO Hackathon](https://youcam-api.devpost.com/). An invited audience member uploads one photograph, auditions three unreleased samples through YouCam AI Clothes, selects a finalist, and backs it with the price they would genuinely pay. The private production room aggregates only those explicit signals and greenlights the first sample to reach the configured threshold.

## Stack

- Next.js 16 App Router and Node.js 22
- Node's built-in SQLite for durable session/task state
- `sharp` for decode validation, EXIF removal and JPEG normalization
- YouCam AI Clothes v3 REST API
- Native `fetch`, CSS and Web APIs; no ORM, queue service or client-exposed provider credentials

The current official integration uses `POST /s2s/v2.0/file/cloth-v3`, a credential-free PUT to its signed upload URL, `POST /s2s/v2.0/task/cloth-v3`, and polling at `GET /s2s/v2.0/task/cloth-v3/{task_id}`. See the [AI Clothes documentation](https://docs.perfectcorp.com/reference/ai_clothes/section/overview).

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Fill every required value in `.env.local`. The three garment URLs must be public HTTPS images that you have permission to use and that satisfy YouCam's reference-image requirements. Check readiness at `GET /api/health`.

## API flow

1. `POST /api/access` with `{ "code": "..." }` sets the short-lived access cookie.
2. `POST /api/sessions` with consent, rights confirmation and `scene: "main-stage"` creates an owned session.
3. `POST /api/sessions/:id/photo` accepts multipart field `photo`, validates 1–10 MB JPEG/PNG/WebP, strips metadata and uploads only the normalized in-memory bytes.
4. `POST /api/sessions/:id/start` with an `Idempotency-Key` creates exactly three bounded tasks.
5. `GET /api/sessions/:id` polls due provider tasks and returns only application states and private proxy URLs.
6. Selection, price-backed demand intent, one bounded retry, result proxy and session deletion complete the flow.

`GET /api/studio` returns the live manufacturer report: decisions, backers, conversion, average willing price and progress toward `GREENLIGHT_THRESHOLD`. The report contains no photographs or inferred body attributes. Backing records intent only; it does not take payment, create a preorder or commit production.

Provider file IDs, task IDs, signed URLs, bearer tokens and upstream response bodies never appear in client responses or logs. The original upload is never written to disk or SQLite. Perfect Corp currently retains uploaded files/task IDs for 30 days and result download URLs for two hours; deleting a local session cannot override provider retention. See [file retention](https://docs.perfectcorp.com/develop/file_retention_period).

## Verify

```bash
npm test
npm run typecheck
npm run build
```

Deploy as one Node process with a persistent volume mounted at `/data`. SQLite, one fixed campaign and the shared preview/studio access code are intentional hackathon ceilings; add manufacturer accounts and a managed relational database before multi-brand production deployment.
