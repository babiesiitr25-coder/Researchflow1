# Free hosting option

**For free deployment without Replit, start with [`FREE_HOSTING_GUIDE.md`](FREE_HOSTING_GUIDE.md).** It explains GitHub + Render Free + Neon Free.

---

# ResearchFlow — private two-person research workspace

ResearchFlow is a responsive Node.js + PostgreSQL website for two researchers to collaborate on a geotechnical engineering research project. It includes task assignment and status tracking, a shared lab notebook, version-independent research file uploads and downloads, an activity timeline, and an optional OpenAI-based research command interpreter. **AI-suggested changes must be approved before they are saved.**

## Features

- Private sign-in for the project owner and one invited collaborator (no open registration)
- Task board: title, notes, phase, priority, status, assignee, due date
- Research phases: Analytical, Numerical, Validation, Writing, Other
- Shared notes, an activity audit trail, status reporting and 30-second polling
- Documents: PDF, DOCX, XLSX, CSV, TXT, MD, JSON, INP, DAT, LOG, STA, MSG, ODB, PY, PNG, JPG, ZIP (15 MB each)
- AI agent interprets natural-language changes with OpenAI when configured; basic quick-command parser works without an AI key
- AI document summarization for PDF, DOCX and text/code files if OpenAI is configured (only first 18,000 extracted characters)
- All records, sessions, and binary uploads stored in PostgreSQL (not a temporary local filesystem)

## Deploy on Replit

1. Create a new **Node.js** Replit App and import the contents of this project folder. You can unzip this package and add its contents to the root of your Replit project. The root must contain `package.json`, `server.js`, `.replit`, and `public/`.
2. Provision a **PostgreSQL** database in Replit. Verify the application environment contains a `DATABASE_URL` connection string. Depending on the Replit publishing setup, development and production databases may be different. Each must have its own accessible connection string.
3. Under **Secrets**, add the environment variables below. **Never** commit actual credentials in `.env`, source code, or public GitHub repositories.
4. In the Shell, run `npm install`, then click **Run** or execute `npm start`. The server binds to `0.0.0.0:$PORT` (default `3000`). The database tables and owner record are initialized automatically on first launch.
5. Sign in with `OWNER_EMAIL` and `OWNER_PASSWORD`. In **Invite / team**, generate a one-time invitation link for the colleague. Share it privately; the colleague creates their own password.
6. In Replit **Publishing**, publish as a hosted web app using the run command **`npm start`**. Confirm that the **production deployment** has its own `DATABASE_URL`, `SESSION_SECRET`, `OWNER_EMAIL`, and `OWNER_PASSWORD` secrets set. Republish when changing production secrets. Then test from a separate browser/private window.

### Required secrets

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL for the active app environment |
| `SESSION_SECRET` | A randomly generated secret at least 32 characters long, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `OWNER_EMAIL` | Your account email |
| `OWNER_PASSWORD` | A unique long password, minimum 12 characters |
| `OWNER_NAME` | Optional name, default Principal Researcher |
| `NODE_ENV` | `production` for HTTPS-deployed app; use `development` for testing over local HTTP |
| `OPENAI_API_KEY` | Optional, required for full AI mode and document summaries |
| `OPENAI_MODEL` | Optional; default `gpt-4.1-mini` |
| `PGSSL` | Set `true` only if your PostgreSQL provider requires TLS and has valid certificates |
| `PORT` | Optional, default `3000` |

**Important:** In Replit, secret values for the publishing/production environment can be distinct from the development environment. An app that works in preview may fail after publishing if deployment secrets or database access are not configured.

## Sample commands

- `Add task: Derive beta for half-sine loading`
- `Started equivalent stress validation`
- `Completed analytical derivation`
- `Note: We decided to use an alternate stress distribution factor for comparison`
- `Show progress`

If `OPENAI_API_KEY` is not configured, use explicit `Add task: ...` or `Note: ...` commands; updates require keywords matching existing task titles. With OpenAI enabled, more natural-language requests can be interpreted, but ambiguous inputs may be declined or require clarification. **No AI agent should be treated as evidence of numerical or scientific validity.**

## Security and data retention

- Cookies are HTTP-only, `SameSite=Lax`, and marked `Secure` in production. Sessions are stored in PostgreSQL, and write operations require a CSRF token.
- Sign-in and agent routes are rate-limited. Two user seats are supported. Invite links are hashed at rest, expire after seven days, and become invalid after one use.
- The invite link is **bearer-based**; it does not verify that the person accepting controls the intended email address. Share only through a secure channel. Add email verification or institutional SSO for a stricter identity assurance model.
- Downloaded files are restricted to authenticated members and always served as attachments; original filename display is escaped to prevent script injection.
- Research documents remain in your PostgreSQL database until deleted. AI summaries send *extracted document text* to your configured AI provider when deliberately requested. Normal task commands send task titles and recent note snippets, plus file **names**, not full file bytes. Review research confidentiality and your institution's data-handling policies before enabling AI on unpublished materials.
- Configure database backups, monitoring, and production access logging before treating the app as an archival system. This starter does not support full document version history, SSO, email delivery, enterprise auditing, or more than two seats.

## Local development

Create a PostgreSQL database, copy `.env.example` to `.env`, populate secrets (set `NODE_ENV=development` if serving over HTTP), then:

```bash
npm install
npm start
```

Visit `http://localhost:3000`. `npm run check` validates JavaScript syntax. The `.env` file is ignored by Git.

## Project structure

- `server.js` — Express API, PostgreSQL schema, authentication, upload and AI routes
- `public/index.html` — accessible page shell and task editor
- `public/styles.css` — responsive, custom UI
- `public/app.js` — client-side routing and interaction
- `.replit` — Replit run command and port
- `.env.example` — safe environment variable template

## Honest deployment status

This archive contains implementation code. It does **not** contain a hosted instance, deployment credentials, or an already published URL. To make it accessible from any computer, import it into Replit, configure the database and secrets, and publish it.
