# Pathora backend

Express + TypeScript API for the Pathora workspace, run directly with `tsx` (no build step).

## Running

From the project root:

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API (port 4000) and the Vite frontend (port 3000) together |
| `npm run dev:api` | API only, restarts on file changes |
| `npm run build && npm start` | Builds the frontend and serves it plus the API from one server |

In development Vite forwards every `/api/*` request to the API, so the frontend always calls relative `/api/...` URLs.

Demo login: `coordinator@nairobi-screening.org` / `pathora-demo`.

## Data

Data is stored in `backend/data/db.json` (gitignored). It is created on first start, seeded from
`src/data/dashboardData.ts`. Delete the file and restart to reset to the sample data.
Set `PATHORA_DATA_DIR` to store it elsewhere.

## Layout

- `src/server.ts` – app setup, routes, error handling, static frontend in production
- `src/db.ts` – JSON-file store, seeding, ID counters
- `src/auth.ts` / `src/passwords.ts` – sessions (Bearer tokens, 12h) and scrypt password hashing
- `src/routes/authRoutes.ts` – `POST /api/auth/signup`, `/login`, `/logout`, `GET /api/auth/me`
- `src/routes/discoveryRoutes.ts` – `POST /api/discovery-requests`
- `src/routes/workspaceRoutes.ts` – everything under `/api/workspace` (auth required):
  - `GET /` – full workspace (cases, facilities, templates, comms log, rule packs, audit, team)
  - `POST /cases`, `POST /cases/import`
  - `POST /cases/:id/acknowledge | attendance | close | escalate | barrier-resolution | messages | opt-out/toggle`
  - `PATCH /cases/:id/owner`, `PATCH /rule-packs/:id`
  - `POST /team`, `POST /team/:id/toggle-active`, `POST /audit/exports`

Every workspace change writes an audit event and returns the updated workspace.
