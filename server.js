Go to server.js on GitHub:
Open [https://github.com/babiesiitr25-coder/Researchflow1/blob/main/server.js](https://github.com/babiesiitr25-coder/Researchflow1/blob/main/server.js) and click the Pencil icon (Edit this file).

Find line 183 (async function initialize() {):
Right below await q(\CREATE TABLE IF NOT EXISTS users(...)`);, add this single line to drop the old users_role_check` constraint on your existing PostgreSQL table:

JavaScript
await q(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
So lines 183–186 look like this:

JavaScript
async function initialize() {
  await q(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'owner',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
Commit the change:
Click the green Commit changes... button in the top-right corner, then click Commit changes in the popup.

Check Render Logs:
Go back to [https://dashboard.render.com/web/srv-dbuq3e49v7es739b05ng/logs](https://dashboard.render.com/web/srv-dbuq3e49v7es739b05ng/logs). Within ~45 seconds, you should see:Multi-tenant database schema verified.ResearchFlow listening on port 10000
