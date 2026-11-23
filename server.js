import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

const { Pool } = pg;
const {
  DATABASE_URL,
  SESSION_SECRET,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  OWNER_NAME = 'Principal Researcher',
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  PGSSL = 'false'
} = process.env;

for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'OWNER_EMAIL', 'OWNER_PASSWORD']) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (OWNER_PASSWORD.length < 12) {
  console.error('OWNER_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
  max: 10
});

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);
app.use(express.json({ limit: '150kb' }));

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'rf.sid',
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 14 * 24 * 60 * 60 * 1000
    }
  })
);

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' }
});
const aiLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many commands. Try again shortly.' }
});

const q = (s, params = []) => pool.query(s, params);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const clean = s => String(s || '').trim();
const statuses = ['To do', 'In progress', 'Blocked', 'Done'];
const priorities = ['Low', 'Medium', 'High'];
const phases = ['Planning', 'Literature review', 'Close reading', 'Archival research', 'Fieldwork', 'Analysis', 'Analytical', 'Numerical', 'Validation', 'Writing', 'Revision', 'Other'];
const readingStatuses = ['To Read', 'Skimming', 'Deep Read', 'Cited', 'Key Reference'];
const token = () => crypto.randomBytes(28).toString('hex');
const inviteCode = () => crypto.randomBytes(6).toString('hex');
const err = (res, msg, status = 400) => res.status(status).json({ error: msg });
const MAX_SEATS = 10;

function csrf(req, res, next) {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
    req.path === '/auth/login' ||
    req.path === '/auth/register' ||
    req.path === '/auth/accept'
  ) {
    return next();
  }
  const h = req.get('x-csrf-token');
  if (!req.session?.csrf || !h || h !== req.session.csrf) {
    return err(res, 'Invalid security token. Refresh the page.', 403);
  }
  next();
}
app.use('/api', csrf);

const userSafe = u => ({ id: u.id, email: u.email, name: u.name, role: u.role });

async function getUser(id) {
  const r = await q('SELECT id,email,name,role FROM users WHERE id=$1', [id]);
  return r.rows[0];
}

async function getUserWorkspaces(userId, client = pool) {
  const r = await client.query(
    `SELECT w.id, w.name, w.invite_code, wm.role
     FROM workspaces w
     JOIN workspace_members wm ON w.id = wm.workspace_id
     WHERE wm.user_id = $1
     ORDER BY w.id ASC`,
    [userId]
  );
  return r.rows;
}

async function resolveActiveWorkspace(req, client = pool) {
  const workspaces = await getUserWorkspaces(req.session.userId, client);
  if (!workspaces.length) return { workspace: null, workspaces: [] };
  let active = workspaces.find(w => w.id === Number(req.session.workspaceId));
  if (!active) {
    active = workspaces[0];
    req.session.workspaceId = active.id;
  }
  return { workspace: active, workspaces };
}

async function required(req, res, next) {
  try {
    if (!req.session?.userId) return err(res, 'Sign in required', 401);
    const { workspace, workspaces } = await resolveActiveWorkspace(req);
    if (!workspace) return err(res, 'No workspace membership found', 403);
    if (req.headers['x-workspace-id'] && Number(req.headers['x-workspace-id']) !== workspace.id) return err(res,'Workspace changed. Refresh the page.',409);
    if (workspace.role === 'viewer' && req.method !== 'GET' && !['/api/workspaces','/api/workspaces/switch','/api/agent/interpret','/api/files/compare'].includes(req.path)) return err(res,'Editor access required',403);
    req.workspace = workspace;
    req.workspaceId = workspace.id;
    req.workspaces = workspaces;
    next();
  } catch (e) {
    next(e);
  }
}

async function activity(client, workspaceId, actor, description, kind = null, recordId = null) {
  await client.query(
    'INSERT INTO activities(workspace_id,actor_id,description,record_kind,record_id) VALUES($1,$2,$3,$4,$5)',
    [workspaceId, actor, description.slice(0, 450), kind, recordId]
  );
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function initialize() {
  await q(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'owner',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await q(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await q(`CREATE TABLE IF NOT EXISTS workspaces(id SERIAL PRIMARY KEY,name VARCHAR(150) NOT NULL,invite_code VARCHAR(32) UNIQUE NOT NULL,created_at TIMESTAMP DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS workspace_members(workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,role VARCHAR(20) DEFAULT 'member',joined_at TIMESTAMP DEFAULT NOW(),PRIMARY KEY(workspace_id,user_id))`);
  await q(`CREATE TABLE IF NOT EXISTS invitations(id SERIAL PRIMARY KEY,workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_by INTEGER REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ)`);
  await q(`CREATE TABLE IF NOT EXISTS tasks(id SERIAL PRIMARY KEY,workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',phase TEXT NOT NULL DEFAULT 'Other',status TEXT NOT NULL DEFAULT 'To do',priority TEXT NOT NULL DEFAULT 'Medium',assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,due_date DATE,created_by INTEGER REFERENCES users(id),updated_at TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS notes(id SERIAL PRIMARY KEY,workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,body TEXT NOT NULL,author_id INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS research_files(id SERIAL PRIMARY KEY,workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,original_name TEXT NOT NULL,mime_type TEXT NOT NULL,bytes INTEGER NOT NULL,content BYTEA NOT NULL,uploaded_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS activities(id SERIAL PRIMARY KEY,workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,actor_id INTEGER REFERENCES users(id),description TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())`);

  await q(`CREATE TABLE IF NOT EXISTS task_sources(
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES research_files(id) ON DELETE CASCADE,
    PRIMARY KEY(task_id,source_id)
  );
  ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_id INTEGER REFERENCES research_files(id) ON DELETE SET NULL;
  ALTER TABLE notes ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS record_kind TEXT;
  ALTER TABLE activities ADD COLUMN IF NOT EXISTS record_id INTEGER;`);

  await q(`
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    ALTER TABLE research_files ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    ALTER TABLE invitations ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
  `);

  await q(`
    ALTER TABLE research_files
      ADD COLUMN IF NOT EXISTS reading_status VARCHAR(30) DEFAULT 'To Read',
      ADD COLUMN IF NOT EXISTS project_phase VARCHAR(30) DEFAULT 'Other',
      ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS citation_meta JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS user_notes TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS ai_review_data JSONB DEFAULT NULL
  `);

  await transaction(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(723,1)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY)');
    if (!(await c.query("SELECT 1 FROM schema_migrations WHERE name='001-research-workspace'")).rowCount) {
      await c.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date date,
                  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS board_limits (
  workspace_id integer REFERENCES workspaces ON DELETE CASCADE,
  status text NOT NULL, capacity integer NOT NULL CHECK(capacity > 0),
  PRIMARY KEY(workspace_id,status)
);
CREATE TABLE IF NOT EXISTS task_dependencies (
  predecessor integer REFERENCES tasks ON DELETE CASCADE,
  successor integer REFERENCES tasks ON DELETE CASCADE,
  PRIMARY KEY(predecessor,successor), CHECK(predecessor <> successor)
);
CREATE INDEX IF NOT EXISTS dependencies_successor ON task_dependencies(successor);
CREATE TABLE IF NOT EXISTS task_comments (
  id serial PRIMARY KEY, task_id integer NOT NULL REFERENCES tasks ON DELETE CASCADE,
  author_id integer REFERENCES users, body text NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_task ON task_comments(task_id,id);
CREATE TABLE IF NOT EXISTS experiment_runs (
  id serial PRIMARY KEY, task_id integer NOT NULL REFERENCES tasks ON DELETE CASCADE,
  label text NOT NULL, parameters text NOT NULL, mesh text NOT NULL, time_step text NOT NULL,
  solver_status text NOT NULL, convergence text NOT NULL,
  output_id integer REFERENCES research_files ON DELETE SET NULL, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_task ON experiment_runs(task_id,id);
CREATE INDEX IF NOT EXISTS task_workspace_status ON tasks(workspace_id,status);
CREATE INDEX IF NOT EXISTS sources_reverse ON task_sources(source_id,task_id);
CREATE INDEX IF NOT EXISTS workspace_activity ON activities(workspace_id,id);
CREATE OR REPLACE FUNCTION researchflow_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap integer;
BEGIN
  IF TG_OP='UPDATE' THEN NEW.revision := OLD.revision+1; END IF;
  IF NEW.start_date > NEW.due_date THEN RAISE EXCEPTION 'Start date follows due date' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM pg_advisory_xact_lock(721,NEW.workspace_id);
    SELECT capacity INTO cap FROM board_limits WHERE workspace_id=NEW.workspace_id AND status=NEW.status;
    IF cap IS NOT NULL AND (SELECT count(*) FROM tasks WHERE workspace_id=NEW.workspace_id AND status=NEW.status)>=cap THEN
      RAISE EXCEPTION 'Column work limit reached' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS researchflow_task_guard ON tasks;
CREATE TRIGGER researchflow_task_guard BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION researchflow_task_guard();
`);
      await c.query("INSERT INTO schema_migrations VALUES('001-research-workspace')");
    }
  });
  const email = OWNER_EMAIL.trim().toLowerCase();
  const hash = await bcrypt.hash(OWNER_PASSWORD, 12);
  let ownerId;
  const existing = await q('SELECT id FROM users WHERE role=$1 ORDER BY id ASC LIMIT 1', ['owner']);
  if (!existing.rowCount) {
    const ins = await q(
      'INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',
      [email, OWNER_NAME, hash, 'owner']
    );
    ownerId = ins.rows[0].id;
    console.log('Research workspace owner account initialized.');
  } else {
    ownerId = existing.rows[0].id;
    await q('UPDATE users SET email=$1,name=$2,password_hash=$3 WHERE id=$4', [email, OWNER_NAME, hash, ownerId]);
    console.log('Research workspace owner account synced.');
  }

  let defaultWs = await q('SELECT id FROM workspaces ORDER BY id ASC LIMIT 1');
  let defaultWsId;
  if (!defaultWs.rowCount) {
    const wsIns = await q(
      'INSERT INTO workspaces(name,invite_code) VALUES($1,$2) RETURNING id',
      ['Research workspace', inviteCode()]
    );
    defaultWsId = wsIns.rows[0].id;
  } else {
    defaultWsId = defaultWs.rows[0].id;
  }

  await q(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING`,
    [defaultWsId, ownerId]
  );

  await q('UPDATE tasks SET workspace_id=$1 WHERE workspace_id IS NULL', [defaultWsId]);
  await q('UPDATE notes SET workspace_id=$1 WHERE workspace_id IS NULL', [defaultWsId]);
  await q('UPDATE research_files SET workspace_id=$1 WHERE workspace_id IS NULL', [defaultWsId]);
  await q('UPDATE activities SET workspace_id=$1 WHERE workspace_id IS NULL', [defaultWsId]);
  console.log('Multi-tenant database schema verified.');
}

// --- Helper: Safe Text Extraction for PDF, DOCX, and Plain-Text/Code ---
async function extractFileText(fileRow, maxChars = 40000) {
  const extension = path.extname(fileRow.original_name).toLowerCase();
  let rawText = '';

  if (['.txt', '.csv', '.md', '.json', '.inp', '.dat', '.log', '.sta', '.msg', '.py'].includes(extension)) {
    rawText = fileRow.content.toString('utf8');
  } else if (extension === '.pdf') {
    const parsed = await pdf(fileRow.content);
    rawText = parsed.text || '';
  } else if (extension === '.docx') {
    const parsed = await mammoth.extractRawText({ buffer: fileRow.content });
    rawText = parsed.value || '';
  } else {
    throw new Error('Text extraction supports PDF, DOCX, and plain-text/code files only.');
  }

  const normalized = clean(rawText).replace(/\s+/g, ' ');
  if (!normalized || normalized.length < 40) {
    throw new Error('Could not extract selectable text from this document (it may be a scanned image).');
  }

  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }

  const head = normalized.slice(0, Math.floor(maxChars * 0.7));
  const tail = normalized.slice(-Math.floor(maxChars * 0.3));
  return {
    text: `${head}\n\n[... MIDDLE SECTIONS TRUNCATED TO FIT MODEL LIMIT ...]\n\n${tail}`,
    truncated: true
  };
}

// --- Auth & Workspace Routes ---
app.post('/api/auth/register', authLimit, async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    const workspaceName = clean(req.body.workspaceName);
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || '');

    if (name.length < 2 || name.length > 90) return err(res, 'Enter your full name (2–90 characters)');
    if (workspaceName.length < 2 || workspaceName.length > 100) {
      return err(res, 'Enter a workspace/lab name (2–100 characters)');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return err(res, 'Enter a valid email address');
    }
    if (password.length < 12) return err(res, 'Password must be at least 12 characters');

    const hash = await bcrypt.hash(password, 12);
    const { user, workspace } = await transaction(async c => {
      const createdUser = await c.query(
        `INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,'owner') RETURNING *`,
        [email, name, hash]
      );
      const u = createdUser.rows[0];
      const createdWs = await c.query(
        `INSERT INTO workspaces(name,invite_code) VALUES($1,$2) RETURNING id,name,invite_code`,
        [workspaceName, inviteCode()]
      );
      const ws = { ...createdWs.rows[0], role: 'owner' };
      await c.query(
        `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')`,
        [ws.id, u.id]
      );
      await activity(c, ws.id, u.id, `Created workspace "${workspaceName}"`);
      return { user: u, workspace: ws };
    });

    req.session.regenerate(e => {
      if (e) return next(e);
      req.session.userId = user.id;
      req.session.workspaceId = workspace.id;
      req.session.csrf = token();
      res.status(201).json({
        user: userSafe(user),
        workspace,
        workspaces: [workspace],
        csrf: req.session.csrf
      });
    });
  } catch (e) {
    if (e.code === '23505') return err(res, 'That email address already has an account');
    next(e);
  }
});

app.post('/api/auth/login', authLimit, async (req, res, next) => {
  try {
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || '');
    const r = await q('SELECT * FROM users WHERE email=$1', [email]);
    if (!r.rowCount || !(await bcrypt.compare(password, r.rows[0].password_hash))) {
      return err(res, 'Invalid email or password', 401);
    }
    const user = r.rows[0];
    let workspaces = await getUserWorkspaces(user.id);
    if (!workspaces.length) {
      const wsIns = await q(
        'INSERT INTO workspaces(name,invite_code) VALUES($1,$2) RETURNING id,name,invite_code',
        [`${user.name.split(' ')[0]}'s Workspace`, inviteCode()]
      );
      await q(
        `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')`,
        [wsIns.rows[0].id, user.id]
      );
      workspaces = [{ ...wsIns.rows[0], role: 'owner' }];
    }
    req.session.regenerate(e => {
      if (e) return next(e);
      req.session.userId = user.id;
      req.session.workspaceId = workspaces[0].id;
      req.session.csrf = token();
      res.json({
        user: userSafe(user),
        workspace: workspaces[0],
        workspaces,
        csrf: req.session.csrf
      });
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/accept', authLimit, async (req, res, next) => {
  try {
    const invite = String(req.body.token || '');
    const name = clean(req.body.name);
    const password = String(req.body.password || '');
    if (!/^[a-f0-9]{56}$/.test(invite) || name.length < 2 || name.length > 90 || password.length < 12) {
      return err(res, 'Valid invitation, name and a password of at least 12 characters are required');
    }
    const digest = sha(invite);
    const hash = await bcrypt.hash(password, 12);
    const { user, workspace } = await transaction(async c => {
      const inv = await c.query(
        'SELECT * FROM invitations WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',
        [digest]
      );
      if (!inv.rowCount) throw new Error('Invitation is invalid, used, or expired');
      const targetWsId = inv.rows[0].workspace_id || 1;
      const wsRes = await c.query('SELECT id,name,invite_code FROM workspaces WHERE id=$1', [targetWsId]);
      if (!wsRes.rowCount) throw new Error('Target workspace no longer exists');

      const memberCount = await c.query(
        'SELECT count(*)::int AS total FROM workspace_members WHERE workspace_id=$1',
        [targetWsId]
      );
      if (memberCount.rows[0].total >= MAX_SEATS) {
        throw new Error(`This workspace has reached its ${MAX_SEATS}-member limit`);
      }

      const existingUser = await c.query('SELECT * FROM users WHERE email=$1', [inv.rows[0].email]);
      let memberUser;
      if (existingUser.rowCount) {
        memberUser = existingUser.rows[0];
      } else {
        const created = await c.query(
          `INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,'collaborator') RETURNING *`,
          [inv.rows[0].email, name, hash]
        );
        memberUser = created.rows[0];
      }

      await c.query(
        `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,
        [targetWsId, memberUser.id]
      );
      await c.query('UPDATE invitations SET used_at=NOW() WHERE id=$1', [inv.rows[0].id]);
      await activity(c, targetWsId, memberUser.id, `${memberUser.name} joined the workspace`);
      return { user: memberUser, workspace: { ...wsRes.rows[0], role: 'member' } };
    });

    const workspaces = await getUserWorkspaces(user.id);
    req.session.regenerate(e => {
      if (e) return next(e);
      req.session.userId = user.id;
      req.session.workspaceId = workspace.id;
      req.session.csrf = token();
      res.json({
        user: userSafe(user),
        workspace,
        workspaces,
        csrf: req.session.csrf
      });
    });
  } catch (e) {
    if (/Invitation|member limit|no longer exists/i.test(e.message)) return err(res, e.message);
    next(e);
  }
});

app.get('/api/bootstrap', async (req, res, next) => {
  try {
    if (!req.session.userId) return res.json({ authenticated: false });
    const user = await getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false });
    }
    const { workspace, workspaces } = await resolveActiveWorkspace(req);
    req.session.csrf ||= token();
    res.json({
      authenticated: true,
      user,
      workspace,
      workspaces,
      csrf: req.session.csrf,
      aiEnabled: !!clean(OPENAI_API_KEY)
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/logout', (req, res, next) =>
  req.session.destroy(e => (e ? next(e) : res.json({ ok: true })))
);

app.post('/api/workspaces', required, async (req, res, next) => {
  try {
    const name = clean(req.body.name);
    if (name.length < 2 || name.length > 100) return err(res, 'Workspace name must be 2–100 characters');
    const ws = await transaction(async c => {
      const created = await c.query(
        'INSERT INTO workspaces(name,invite_code) VALUES($1,$2) RETURNING id,name,invite_code',
        [name, inviteCode()]
      );
      const newWs = { ...created.rows[0], role: 'owner' };
      await c.query(
        `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')`,
        [newWs.id, req.session.userId]
      );
      await activity(c, newWs.id, req.session.userId, `Created workspace "${name}"`);
      return newWs;
    });
    req.session.workspaceId = ws.id;
    const workspaces = await getUserWorkspaces(req.session.userId);
    res.status(201).json({ workspace: ws, workspaces });
  } catch (e) {
    next(e);
  }
});

app.post('/api/workspaces/switch', required, async (req, res, next) => {
  try {
    const targetId = Number(req.body.workspaceId);
    const workspaces = await getUserWorkspaces(req.session.userId);
    const target = workspaces.find(w => w.id === targetId);
    if (!target) return err(res, 'Access denied to that workspace', 403);
    req.session.workspaceId = target.id;
    res.json({ workspace: target, workspaces });
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/invite', required, authLimit, async (req, res, next) => {
  try {
    if (req.workspace.role !== 'owner') {
      return err(res, 'Only the workspace owner can invite teammates', 403);
    }
    const email = clean(req.body.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return err(res, 'Provide a valid email address');
    }
    const members = await q(
      'SELECT count(*)::int AS total FROM workspace_members WHERE workspace_id=$1',
      [req.workspaceId]
    );
    if (members.rows[0].total >= MAX_SEATS) {
      return err(res, `All ${MAX_SEATS} workspace seats are occupied`);
    }
    const secret = token();
    await q(
      `INSERT INTO invitations(workspace_id,email,token_hash,created_by,expires_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days')`,
      [req.workspaceId, email, sha(secret), req.session.userId]
    );
    res.json({ invitePath: '/invite?token=' + secret, expiresIn: '7 days', email });
  } catch (e) {
    next(e);
  }
});

// --- Dashboard Data (Strictly Scoped to Active Workspace) ---
function workspaceRoutes({ app, required, transaction, pool, activity, checkRecord, normalTask, statuses, err }) {
  const streams = new Map();
  const send = (res,type,payload) => res.write('event: '+type+'\ndata: '+JSON.stringify(payload)+'\n\n');
  function broadcast(id,type,data) {
    for (const item of streams.get(id) || []) send(item.res,type,data);
  }
  function presence(id) {
    broadcast(id,'presence',[...(streams.get(id) || [])].map(({name,view,user})=>({name,view,user})));
  }
  app.get('/api/live',required,async (req,res,next)=>{
    try {
      if (Number(req.query.workspace)!==req.workspaceId) return err(res,'Workspace changed',409);
      const {rows} = await pool.query('SELECT name FROM users WHERE id=$1',[req.session.userId]);
      const id=req.workspaceId;
      res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});
      res.flushHeaders();
      const peer={res,name:rows[0].name,user:req.session.userId,view:String(req.query.view || 'Overview').slice(0,100)};
      if (!streams.has(id)) streams.set(id,new Set());
      streams.get(id).add(peer);
      presence(id);
      const pulse=setInterval(()=>res.write(': heartbeat\n\n'),20000);
      // Periodic reconnect revalidates session membership.
      const expiry=setTimeout(()=>res.end(),120000);
      res.on('close',()=>{
        clearInterval(pulse); clearTimeout(expiry);
        streams.get(id)?.delete(peer);
        if (!streams.get(id)?.size) streams.delete(id);
        else presence(id);
      });
    } catch(e){next(e);}
  });
  app.use('/api',(req,res,next)=>{
    if(req.method!=='GET') res.once('finish',()=>{
      if(res.statusCode<300 && req.workspaceId) broadcast(req.workspaceId,'change',{});
    });
    next();
  });
  const post=(route,handler)=>app.post('/api/'+route,required,async(req,res,next)=>{
    try {
      const result=await transaction(async c=>{
        await c.query('SELECT pg_advisory_xact_lock(721,$1)',[req.workspaceId]);
        return handler(c,req);
      });
      res.json(result || {ok:true});
    }catch(e){next(e);}
  });
  const invalid=message=>Object.assign(new Error(message),{status:400});
  post('board/batch',async(c,req)=>{
    const {items}=req.body;
    if(!Array.isArray(items)||!items.length||items.length>500) throw invalid('Select 1–500 tasks');
    const saved=[];
    for(const item of items){
      const fields=normalTask(item.changes || {},true);
      if(!Object.keys(fields).length) throw invalid('Choose a change');
      if(fields.assignee_id!=null){
        const member=await c.query('SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',[req.workspaceId,fields.assignee_id]);
        if(!member.rowCount) throw invalid('Unknown teammate');
      }
      const keys=Object.keys(fields);
      const r=await c.query('UPDATE tasks SET '+keys.map((k,i)=>k+'=$'+(i+4)).join(',')+',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id,revision',[req.workspaceId,item.id,item.revision,...Object.values(fields)]);
      if(!r.rowCount) throw Object.assign(new Error('A task changed. Review its current version and retry.'),{status:409});
      saved.push(r.rows[0]);
      await activity(c,req.workspaceId,req.session.userId,'Changed '+keys.join(', '),'task',item.id);
    }
    return saved;
  });
  post('board/limit',async(c,req)=>{
    const {status,capacity}=req.body;
    if(!statuses.includes(status)||!Number.isSafeInteger(capacity)||capacity<0) throw invalid('Invalid column limit');
    await c.query('DELETE FROM board_limits WHERE workspace_id=$1 AND status=$2',[req.workspaceId,status]);
    if(capacity) await c.query('INSERT INTO board_limits VALUES($1,$2,$3)',[req.workspaceId,status,capacity]);
  });
  post('tasks/:id/detail',async(c,req)=>{
    const task=Number(req.params.id),ws=req.workspaceId,b=req.body;
    await checkRecord(c,'tasks',ws,task);
    if(b.kind==='dependency'){
      await checkRecord(c,'tasks',ws,b.predecessor);
      const cycle=await c.query('WITH RECURSIVE reach(id) AS (SELECT $1::int UNION SELECT successor FROM task_dependencies d JOIN reach r ON d.predecessor=r.id) SELECT 1 FROM reach WHERE id=$2',[task,b.predecessor]);
      if(cycle.rowCount) throw invalid('These tasks would form a dependency cycle');
      await c.query('INSERT INTO task_dependencies VALUES($1,$2) ON CONFLICT DO NOTHING',[b.predecessor,task]);
    }else if(b.kind==='unlink'){
      await c.query('DELETE FROM task_dependencies WHERE predecessor=$1 AND successor=$2',[b.predecessor,task]);
    }else if(b.kind==='comment'){
      const body=String(b.body||'').trim();
      if(!body||body.length>5000) throw invalid('Enter a comment of up to 5000 characters');
      await c.query('INSERT INTO task_comments(task_id,author_id,body) VALUES($1,$2,$3)',[task,req.session.userId,body]);
    }else if(b.kind==='run'){
      if(!String(b.label||'').trim()) throw invalid('Enter a run name');
      await checkRecord(c,'research_files',ws,b.outputId);
      await c.query('INSERT INTO experiment_runs(task_id,label,parameters,mesh,time_step,solver_status,convergence,output_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[task,...['label','parameters','mesh','timeStep','status','convergence'].map(k=>String(b[k]||'').slice(0,5000)),b.outputId||null]);
    }else throw invalid('Unknown detail type');
    await activity(c,ws,req.session.userId,'Updated '+b.kind,'task',task);
  });
}

workspaceRoutes({app,required,transaction,pool,activity,checkRecord,normalTask,statuses,err});

app.get('/api/dashboard', required, async (req, res, next) => {
  try {
    const wsId = req.workspaceId;
    const [tasks, notes, files, activities, members, deps, comments, runs, limits] = await Promise.all([
      q(
        `SELECT t.*,to_char(t.start_date,'YYYY-MM-DD') AS start_date,ARRAY(SELECT source_id FROM task_sources WHERE task_id=t.id) AS source_ids,to_char(t.due_date,'YYYY-MM-DD') AS due_date,u.name AS assignee_name
         FROM tasks t LEFT JOIN users u ON t.assignee_id=u.id
         WHERE t.workspace_id=$1
         ORDER BY CASE t.status WHEN 'In progress' THEN 0 WHEN 'Blocked' THEN 1 WHEN 'To do' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 500`,
        [wsId]
      ),
      q(
        `SELECT n.id,n.source_id,n.task_id,n.body,n.created_at,u.name AS author_name
         FROM notes n LEFT JOIN users u ON u.id=n.author_id
         WHERE n.workspace_id=$1
         ORDER BY n.created_at DESC LIMIT 100`,
        [wsId]
      ),
      q(
        `SELECT f.id,f.original_name,f.mime_type,f.bytes,f.created_at,
                f.reading_status,f.project_phase,f.tags,f.citation_meta,f.user_notes,f.ai_review_data,
                u.name AS uploader_name
         FROM research_files f LEFT JOIN users u ON u.id=f.uploaded_by
         WHERE f.workspace_id=$1
         ORDER BY f.created_at DESC LIMIT 200`,
        [wsId]
      ),
      q(
        `SELECT a.id,a.record_kind,a.record_id,a.description,a.created_at,u.name AS actor_name
         FROM activities a LEFT JOIN users u ON u.id=a.actor_id
         WHERE a.workspace_id=$1
         ORDER BY a.created_at DESC LIMIT 100`,
        [wsId]
      ),
      q(
        `SELECT u.id,u.name,u.email,wm.role
         FROM users u
         JOIN workspace_members wm ON u.id = wm.user_id
         WHERE wm.workspace_id=$1
         ORDER BY wm.joined_at ASC`,
        [wsId]
      )
      ,q('SELECT d.* FROM task_dependencies d JOIN tasks t ON t.id=d.successor WHERE t.workspace_id=$1',[wsId]),
      q('SELECT c.*,u.name FROM task_comments c JOIN tasks t ON t.id=c.task_id JOIN users u ON u.id=c.author_id WHERE t.workspace_id=$1 ORDER BY c.id',[wsId]),
      q('SELECT r.* FROM experiment_runs r JOIN tasks t ON t.id=r.task_id WHERE t.workspace_id=$1 ORDER BY r.id',[wsId]),
      q('SELECT status,capacity FROM board_limits WHERE workspace_id=$1',[wsId])
    ]);
    res.json({
      dependencies:deps.rows,comments:comments.rows,runs:runs.rows,limits:limits.rows,
      workspace: req.workspace,
      maxSeats: MAX_SEATS,
      tasks: tasks.rows,
      notes: notes.rows,
      files: files.rows,
      activities: activities.rows,
      members: members.rows
    });
  } catch (e) {
    next(e);
  }
});

// --- Tasks Routes ---
const taskFields = {
  title: 'title',
  description: 'description',
  phase: 'phase',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee_id',
  startDate: 'start_date',
  dueDate: 'due_date'
};

function normalTask(payload, partial = false) {
  const out = {};
  for (const [from, to] of Object.entries(taskFields)) {
    if (Object.hasOwn(payload, from)) out[to] = payload[from];
  }
  if (!partial && (!clean(out.title) || clean(out.title).length > 180)) {
    throw new Error('Task title is required (maximum 180 characters)');
  }
  if (Object.hasOwn(out, 'title')) {
    out.title = clean(out.title);
    if (!out.title || out.title.length > 180) throw new Error('Invalid task title');
  }
  if (Object.hasOwn(out, 'description')) {
    out.description = clean(out.description);
    if (out.description.length > 5000) throw new Error('Description is too long');
  }
  if (Object.hasOwn(out, 'status') && !statuses.includes(out.status)) throw new Error('Invalid status');
  if (Object.hasOwn(out, 'priority') && !priorities.includes(out.priority)) throw new Error('Invalid priority');
  if (Object.hasOwn(out, 'phase') && !phases.includes(out.phase)) throw new Error('Invalid phase');
  if (Object.hasOwn(out, 'due_date') && out.due_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(out.due_date)) {
    throw new Error('Invalid due date');
  }
  if (Object.hasOwn(out, 'assignee_id') && out.assignee_id !== null && !Number.isInteger(Number(out.assignee_id))) {
    throw new Error('Invalid assignee');
  }
  return out;
}

async function checkRecord(client, table, workspace, id) {
  if (id == null) return;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid linked record');
  const r = await client.query(`SELECT id FROM ${table} WHERE id=$1 AND workspace_id=$2 FOR KEY SHARE`, [id, workspace]);
  if (!r.rowCount) throw new Error('Invalid linked record in this workspace');
}

async function updateSources(client, workspace, task, changes = {}) {
  for (const [action, ids] of Object.entries(changes)) {
    if (!['add','remove'].includes(action) || !Array.isArray(ids) || ids.length > 200) throw new Error('Invalid source links');
    for (const id of new Set(ids)) {
      await checkRecord(client, 'research_files', workspace, id);
      if (action === 'add') await client.query('INSERT INTO task_sources VALUES($1,$2) ON CONFLICT DO NOTHING', [task,id]);
      else await client.query('DELETE FROM task_sources WHERE task_id=$1 AND source_id=$2', [task,id]);
    }
  }
}

app.post('/api/tasks', required, async (req, res, next) => {
  try {
    const t = normalTask(req.body);
    const wsId = req.workspaceId;
    const r = await transaction(async c => {
      if (t.assignee_id != null) {
        const m = await c.query(
          'SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
          [wsId, t.assignee_id]
        );
        if (!m.rowCount) throw new Error('Invalid assignee for this workspace');
      }
      const result = await c.query(
        `INSERT INTO tasks(workspace_id,title,description,phase,status,priority,assignee_id,due_date,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [wsId, t.title, t.description || '', t.phase || 'Other', t.status || 'To do', t.priority || 'Medium', t.assignee_id || null, t.due_date || null, req.session.userId]
      );
      await updateSources(c, wsId, result.rows[0].id, req.body.sources);
      await activity(c, wsId, req.session.userId, `Created task: ${t.title}`, 'task', result.rows[0].id);
      return result.rows[0];
    });
    res.status(201).json(r);
  } catch (e) {
    if (/Invalid|title|long/i.test(e.message)) return err(res, e.message);
    next(e);
  }
});

app.patch('/api/tasks/:id', required, async (req, res, next) => {
  try {
    const t = normalTask(req.body, true);
    const wsId = req.workspaceId;
    if (!Object.keys(t).length) return err(res, 'No changes supplied');
    const saved = await transaction(async c => {
      if (t.assignee_id != null) {
        const m = await c.query(
          'SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
          [wsId, t.assignee_id]
        );
        if (!m.rowCount) throw new Error('Invalid assignee for this workspace');
      }
      if (req.body.revision != null && !(await c.query('SELECT 1 FROM tasks WHERE workspace_id=$1 AND id=$2 AND revision=$3 FOR UPDATE',[wsId,req.params.id,req.body.revision])).rowCount) return Promise.reject(Object.assign(new Error('Task changed. Reopen to edit the current version.'),{status:409}));
      const fields = Object.keys(t);
      const values = fields.map(k => t[k]);
      const r = await c.query(
        `UPDATE tasks SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(',')},updated_at=NOW()
         WHERE id=$${fields.length + 1} AND workspace_id=$${fields.length + 2} RETURNING *`,
        [...values, req.params.id, wsId]
      );
      if (!r.rowCount) throw new Error('Task not found');
      await updateSources(c, wsId, r.rows[0].id, req.body.sources);
      await activity(c, wsId, req.session.userId, `Updated task: ${r.rows[0].title}${t.status ? ' → ' + t.status : ''}`, 'task', r.rows[0].id);
      return r.rows[0];
    });
    res.json(saved);
  } catch (e) {
    if (/Invalid|not found|long|title/i.test(e.message)) return err(res, e.message);
    next(e);
  }
});

app.delete('/api/tasks/:id', required, async (req, res, next) => {
  try {
    const wsId = req.workspaceId;
    await transaction(async c => {
      const r = await c.query(
        'DELETE FROM tasks WHERE id=$1 AND workspace_id=$2 RETURNING title',
        [req.params.id, wsId]
      );
      if (!r.rowCount) throw new Error('Task not found');
      await activity(c, wsId, req.session.userId, 'Deleted task: ' + r.rows[0].title);
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.message === 'Task not found') return err(res, e.message, 404);
    next(e);
  }
});

// --- Lab Notebook Routes ---
app.post('/api/notes', required, async (req, res, next) => {
  try {
    const body = clean(req.body.body);
    const wsId = req.workspaceId;
    if (!body || body.length > 10000) return err(res, 'Note must be 1–10000 characters');
    const created = await transaction(async c => {
      const {sourceId = null, taskId = null} = req.body;
      await checkRecord(c, 'research_files', wsId, sourceId);
      await checkRecord(c, 'tasks', wsId, taskId);
      const r = await c.query(
        'INSERT INTO notes(workspace_id,body,author_id,source_id,task_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [wsId, body, req.session.userId, sourceId, taskId]
      );
      await activity(c, wsId, req.session.userId, 'Added research note: ' + body.slice(0, 90), 'note', r.rows[0].id);
      return r.rows[0];
    });
    res.status(201).json(created);
  } catch (e) {
    if (/Invalid linked/.test(e.message)) return err(res, e.message);
    next(e);
  }
});

app.delete('/api/notes/:id', required, async (req, res, next) => {
  try {
    const wsId = req.workspaceId;
    await transaction(async c => {
      const r = await c.query('DELETE FROM notes WHERE id=$1 AND workspace_id=$2 RETURNING id', [req.params.id, wsId]);
      if (!r.rowCount) throw new Error('Note not found');
      await activity(c, wsId, req.session.userId, 'Deleted a research note');
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.message === 'Note not found') return err(res, e.message, 404);
    next(e);
  }
});

// --- Research Library File Routes ---
const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

app.post('/api/files', required, uploads.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return err(res, 'Choose a file');
    const wsId = req.workspaceId;
    const original = path.basename(req.file.originalname).slice(0, 240);
    const allowed = /\.(pdf|docx|xlsx|csv|txt|md|json|inp|dat|log|sta|msg|odb|py|png|jpg|jpeg|zip)$/i;
    if (!allowed.test(original)) return err(res, 'This file type is not supported');
    const phase = phases.includes(req.body?.project_phase) ? req.body.project_phase : 'Other';

    const stored = await transaction(async c => {
      const r = await c.query(
        `INSERT INTO research_files(workspace_id,original_name,mime_type,bytes,content,uploaded_by,project_phase)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,original_name,mime_type,bytes,created_at,reading_status,project_phase,tags,citation_meta,user_notes,ai_review_data`,
        [wsId, original, req.file.mimetype || 'application/octet-stream', req.file.size, req.file.buffer, req.session.userId, phase]
      );
      await activity(c, wsId, req.session.userId, 'Uploaded file: ' + original, 'file', r.rows[0].id);
      return r.rows[0];
    });
    res.status(201).json(stored);
  } catch (e) {
    next(e);
  }
});

app.get('/api/files/:id/download', required, async (req, res, next) => {
  try {
    const r = await q(
      'SELECT original_name,mime_type,bytes,content FROM research_files WHERE id=$1 AND workspace_id=$2',
      [req.params.id, req.workspaceId]
    );
    if (!r.rowCount) return err(res, 'File not found', 404);
    const f = r.rows[0];
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    res.setHeader('Content-Length', String(f.bytes));
    res.send(f.content);
  } catch (e) {
    next(e);
  }
});

app.patch('/api/files/:id/metadata', required, async (req, res, next) => {
  try {
    const { reading_status, project_phase, tags, user_notes, citation_meta } = req.body;
    const wsId = req.workspaceId;

    if (reading_status !== undefined && !readingStatuses.includes(reading_status)) {
      return err(res, 'Invalid reading status');
    }
    if (project_phase !== undefined && !phases.includes(project_phase)) {
      return err(res, 'Invalid project phase');
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 25)) {
      return err(res, 'Tags must be an array of up to 25 items');
    }
    if (user_notes !== undefined && String(user_notes).length > 20000) {
      return err(res, 'Notes cannot exceed 20,000 characters');
    }

    const cleanTags = tags !== undefined ? tags.map(t => clean(t).slice(0, 40)).filter(Boolean) : null;

    const updated = await transaction(async c => {
      const r = await c.query(
        `UPDATE research_files
         SET reading_status = COALESCE($1, reading_status),
             project_phase  = COALESCE($2, project_phase),
             tags           = COALESCE($3, tags),
             user_notes     = COALESCE($4, user_notes),
             citation_meta  = COALESCE($5::jsonb, citation_meta)
         WHERE id = $6 AND workspace_id = $7
         RETURNING id,original_name,mime_type,bytes,created_at,reading_status,project_phase,tags,citation_meta,user_notes,ai_review_data`,
        [
          reading_status ?? null,
          project_phase ?? null,
          cleanTags,
          user_notes !== undefined ? String(user_notes) : null,
          citation_meta !== undefined ? JSON.stringify(citation_meta) : null,
          req.params.id,
          wsId
        ]
      );
      if (!r.rowCount) throw new Error('File not found');
      await activity(c, wsId, req.session.userId, `Updated literature metadata: ${r.rows[0].original_name}`, 'file', r.rows[0].id);
      return r.rows[0];
    });

    res.json(updated);
  } catch (e) {
    if (e.message === 'File not found') return err(res, e.message, 404);
    next(e);
  }
});

app.post('/api/files/compare', required, async (req, res, next) => {
  try {
    const fileIds = Array.isArray(req.body.fileIds) ? req.body.fileIds.map(Number).filter(Number.isInteger) : [];
    if (fileIds.length < 2 || fileIds.length > 10) {
      return err(res, 'Select between 2 and 10 files to compare');
    }
    const r = await q(
      `SELECT id, original_name, reading_status, project_phase, tags, citation_meta, user_notes, ai_review_data
       FROM research_files WHERE workspace_id = $1 AND id = ANY($2::int[]) ORDER BY created_at DESC`,
      [req.workspaceId, fileIds]
    );
    res.json({ papers: r.rows });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/files/:id', required, async (req, res, next) => {
  try {
    const wsId = req.workspaceId;
    await transaction(async c => {
      const r = await c.query(
        'DELETE FROM research_files WHERE id=$1 AND workspace_id=$2 RETURNING original_name',
        [req.params.id, wsId]
      );
      if (!r.rowCount) throw new Error('File not found');
      await activity(c, wsId, req.session.userId, 'Deleted file: ' + r.rows[0].original_name);
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.message === 'File not found') return err(res, e.message, 404);
    next(e);
  }
});

// --- AI Research Agent Routes ---
const commonWords = new Set(['i', 'we', 'the', 'and', 'for', 'all', 'with', 'have', 'was', 'our', 'this', 'that', 'now', 'are', 'from', 'into', 'today', 'done', 'completed', 'finished', 'started', 'update', 'task', 'mark', 'progress']);

function matchTask(message, tasks) {
  const m = message.toLowerCase();
  return tasks
    .map(t => ({
      t,
      score: t.title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length >= 3 && !commonWords.has(w) && m.includes(w)).length
    }))
    .sort((a, b) => b.score - a.score)[0];
}

function fallbackAgent(message, tasks) {
  const trimmed = message.trim();
  const low = trimmed.toLowerCase();
  let actions = [];
  let reply = '';
  const add = trimmed.match(/^(?:add|create|new)\s+task\s*[:\-]\s*(.+)/i);
  const note = trimmed.match(/^(?:note|log|research note)\s*[:\-]\s*(.+)/is);
  if (add) {
    actions = [{ type: 'add_task', title: add[1].slice(0, 180), phase: 'Other', priority: 'Medium' }];
    reply = 'I can create this task. Review and confirm.';
  } else if (note) {
    actions = [{ type: 'add_note', body: note[1].slice(0, 10000) }];
    reply = 'I can save this research note. Review and confirm.';
  } else if (/\b(completed|finished|done|started|beginning|blocked)\b/.test(low)) {
    const match = matchTask(low, tasks);
    if (match?.score >= 1) {
      const status = /completed|finished|done/.test(low) ? 'Done' : /blocked/.test(low) ? 'Blocked' : 'In progress';
      actions = [{ type: 'update_task', taskId: match.t.id, status }];
      reply = `Matched “${match.t.title}”. Review the proposed status change.`;
    } else {
      reply = 'No existing task confidently matches that update. Try “Add task: [name]” or create the task in the Tasks view.';
    }
  } else if (/progress|summary|report|overview/i.test(low)) {
    const done = tasks.filter(t => t.status === 'Done').length;
    const active = tasks.filter(t => t.status === 'In progress').length;
    const blocked = tasks.filter(t => t.status === 'Blocked').length;
    reply = `Current project: ${tasks.length} tasks; ${done} complete, ${active} in progress, ${blocked} blocked. ${tasks.length ? Math.round((done / tasks.length) * 100) : 0}% completed. Outstanding tasks: ${tasks.filter(t => t.status !== 'Done').slice(0, 8).map(t => t.title).join('; ') || 'none'}.`;
  } else {
    reply = 'Quick command mode understands “Add task: ...”, “Note: ...”, “Completed [task]”, “Started [task]”, “Blocked [task]”, and “Show progress”. Add OPENAI_API_KEY in deployment Secrets to enable natural-language AI interpretation.';
  }
  return { reply, actions, mode: 'quick-command' };
}

function validateActions(actions, tasks) {
  return actions.slice(0, 8).flatMap(a => {
    if (!a || typeof a !== 'object') return [];
    if (a.type === 'add_task' && clean(a.title).length > 0 && clean(a.title).length <= 180) {
      return [{
        type: 'add_task',
        title: clean(a.title),
        description: clean(a.description || '').slice(0, 1500),
        phase: phases.includes(a.phase) ? a.phase : 'Other',
        priority: priorities.includes(a.priority) ? a.priority : 'Medium'
      }];
    }
    if (a.type === 'add_note' && clean(a.body).length > 0) {
      return [{ type: 'add_note', body: clean(a.body).slice(0, 10000) }];
    }
    if (a.type === 'update_task' && Number.isInteger(Number(a.taskId)) && tasks.some(t => t.id === Number(a.taskId)) && statuses.includes(a.status)) {
      return [{ type: 'update_task', taskId: Number(a.taskId), status: a.status }];
    }
    return [];
  });
}

async function openaiInterpret(message, workspaceName, tasks, notes, files) {
  const apiKey = clean(OPENAI_API_KEY);
  const sys = `You are a research-collaboration task assistant for the "${workspaceName}" research workspace. Interpret the user's command based ONLY on supplied existing tasks, notes, and file names. Respond as a JSON object with keys "reply" (brief human-readable text) and "actions" (array, maximum 8). Actions are {"type":"add_task","title":"...","description":"...","phase":"${phases.join('|')}","priority":"Low|Medium|High"} or {"type":"update_task","taskId":INTEGER,"status":"To do|In progress|Blocked|Done"} or {"type":"add_note","body":"..."}. Do NOT mutate anything unless specifically requested. Do NOT fabricate experiment results, file contents, completion statuses, numerical parameters, or task IDs. Never claim to have analyzed the actual contents of attached files: only filenames are provided. If the user asks for a summary, produce a read-only reply and actions=[]. If the request is ambiguous, explain and use actions=[]. A sentence saying someone did a completed piece of work may justify marking a clearly matching existing task Done; if unclear ask. Keep reply concise.`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        {
          role: 'user',
          content: JSON.stringify({
            message,
            existingTasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, phase: t.phase })),
            recentNotes: notes.map(n => n.body.slice(0, 250)),
            uploadedFileNames: files.map(f => f.original_name)
          })
        }
      ]
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error('AI service returned ' + r.status + ': ' + body.slice(0, 140));
  }
  const raw = await r.json();
  const parsed = JSON.parse(raw.choices?.[0]?.message?.content || '{}');
  return {
    reply: String(parsed.reply || 'Please review the suggested changes.').slice(0, 3000),
    actions: validateActions(Array.isArray(parsed.actions) ? parsed.actions : [], tasks),
    mode: 'ai'
  };
}

app.post('/api/agent/interpret', required, aiLimit, async (req, res, next) => {
  try {
    const message = clean(req.body.message);
    const wsId = req.workspaceId;
    if (!message || message.length > 3000) return err(res, 'Enter a command of up to 3000 characters');
    const [tr, nr, fr] = await Promise.all([
      q('SELECT id,title,status,phase FROM tasks WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 200', [wsId]),
      q('SELECT body FROM notes WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20', [wsId]),
      q('SELECT original_name FROM research_files WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30', [wsId])
    ]);
    let result;
    if (clean(OPENAI_API_KEY)) {
      try {
        result = await openaiInterpret(message, req.workspace.name, tr.rows, nr.rows, fr.rows);
      } catch (e) {
        console.error('AI interpretation error:', e.message);
        result = fallbackAgent(message, tr.rows);
        result.reply += ' (AI temporarily unavailable; using quick-command interpretation.)';
      }
    } else {
      result = fallbackAgent(message, tr.rows);
    }
    res.json(result);
  } catch (e) {
    next(e);
  }
});

app.post('/api/agent/apply', required, async (req, res, next) => {
  try {
    const actions = req.body.actions;
    const wsId = req.workspaceId;
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > 8) {
      return err(res, 'Provide 1–8 proposed actions');
    }
    const tr = await q('SELECT id FROM tasks WHERE workspace_id=$1', [wsId]);
    const safe = validateActions(actions, tr.rows);
    if (safe.length !== actions.length) {
      return err(res, 'One or more actions are invalid. Please request a new interpretation.');
    }
    await transaction(async c => {
      for (const a of safe) {
        if (a.type === 'add_task') {
          const created = await c.query(
            'INSERT INTO tasks(workspace_id,title,description,phase,priority,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
            [wsId, a.title, a.description, a.phase, a.priority, req.session.userId]
          );
          await activity(c, wsId, req.session.userId, 'AI-assisted: created task ' + a.title, 'task', created.rows[0].id);
        }
        if (a.type === 'update_task') {
          const r = await c.query(
            'UPDATE tasks SET status=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3 RETURNING title',
            [a.status, a.taskId, wsId]
          );
          if (!r.rowCount) throw new Error('Task disappeared; request a new interpretation');
          await activity(c, wsId, req.session.userId, `AI-assisted: ${r.rows[0].title} → ${a.status}`, 'task', a.taskId);
        }
        if (a.type === 'add_note') {
          const created = await c.query('INSERT INTO notes(workspace_id,body,author_id) VALUES($1,$2,$3) RETURNING id', [wsId, a.body, req.session.userId]);
          await activity(c, wsId, req.session.userId, 'AI-assisted: added research note', 'note', created.rows[0].id);
        }
      }
    });
    res.json({ ok: true, count: safe.length });
  } catch (e) {
    if (/Task disappeared|invalid/i.test(e.message)) return err(res, e.message);
    next(e);
  }
});

// --- Structured Literature Extraction + Caching ---
app.post('/api/agent/summarize-file/:id', required, aiLimit, async (req, res, next) => {
  try {
    const apiKey = clean(OPENAI_API_KEY);
    if (!apiKey) return err(res, 'Set OPENAI_API_KEY in Render Environment to enable document analysis', 503);

    const forceRefresh = Boolean(req.body?.forceRefresh);
    const r = await q(
      'SELECT id, original_name, content, bytes, tags, ai_review_data FROM research_files WHERE id=$1 AND workspace_id=$2',
      [req.params.id, req.workspaceId]
    );
    if (!r.rowCount) return err(res, 'File not found', 404);
    const f = r.rows[0];

    if (f.ai_review_data && !forceRefresh) {
      return res.json({
        cached: true,
        summary: f.ai_review_data.formatted_summary || '',
        review: f.ai_review_data,
        truncated: Boolean(f.ai_review_data.truncated)
      });
    }

    const { text: excerpt, truncated } = await extractFileText(f, 40000);

    const sysPrompt = `You are a careful academic research assistant.
Analyze ONLY the provided document text. Do not fabricate equations, parameters, or results.
Return ONLY valid JSON with these exact keys:
{
  "citation": {
    "authors": "Author list from document",
    "year": "Publication year",
    "title": "Full paper or document title",
    "journal": "Journal, conference, or source",
    "bibtex": "Valid @article or @misc BibTeX entry"
  },
  "objective": "Primary research objective and problem statement",
  "methodology": "Research approach, interpretive framework or technical method used",
  "governing_equations_and_params": "Relevant concepts, textual evidence, archival materials or technical equations and parameters. Include page references only when present.",
  "key_findings": "Main quantitative and qualitative conclusions",
  "limitations_and_gaps": "Limitations, assumptions, and open research questions",
  "suggested_tags": ["short-tag-1", "short-tag-2", "short-tag-3"],
  "formatted_summary": "A clear, structured Markdown literature review summary covering Objective, Methodology, Evidence and Concepts, Main Findings, and Open Questions/Next Tasks."
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sysPrompt },
          {
            role: 'user',
            content: `Filename: ${f.original_name}\n${truncated ? 'NOTE: Middle sections truncated due to document length.\n' : ''}\n${excerpt}`
          }
        ]
      }),
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) {
      const errDetail = await response.text();
      console.error(`OpenAI Summarize Error (${response.status}):`, errDetail);
      if (response.status === 401) {
        return err(res, 'OpenAI rejected OPENAI_API_KEY (401 Unauthorized). Verify the key in Render Environment.', 502);
      }
      return err(res, `AI summary service failed with status ${response.status}`, 502);
    }

    const json = await response.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || '{}');
    parsed.truncated = truncated;
    parsed.analyzed_at = new Date().toISOString();

    const suggestedTags = Array.isArray(parsed.suggested_tags)
      ? parsed.suggested_tags.map(t => clean(t).slice(0, 40)).filter(Boolean).slice(0, 8)
      : [];

    await q(
      `UPDATE research_files
       SET ai_review_data = $1::jsonb,
           citation_meta  = $2::jsonb,
           tags           = CASE WHEN COALESCE(array_length(tags, 1), 0) = 0 THEN $3 ELSE tags END
       WHERE id = $4 AND workspace_id = $5`,
      [JSON.stringify(parsed), JSON.stringify(parsed.citation || {}), suggestedTags, f.id, req.workspaceId]
    );

    res.json({
      cached: false,
      summary: String(parsed.formatted_summary || 'No summary returned'),
      review: parsed,
      truncated
    });
  } catch (e) {
    if (/Text extraction|Could not extract/i.test(e.message)) return err(res, e.message, 400);
    next(e);
  }
});

// --- Static Frontend Serving ---
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
app.use(express.static(publicDir, { index: false, maxAge: '15m' }));
app.get(['/', '/invite'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use('/api', (req, res) => err(res, 'Endpoint not found', 404));
app.use((e, req, res, next) => {
  if ([400,409].includes(e.status) || /^(Invalid|Unknown teammate)/.test(e.message) || ['23514','22007','22008'].includes(e.code)) return err(res,e.message,e.status || 400);
  console.error('Request error:', e);
  if (e instanceof multer.MulterError) {
    return err(res, e.code === 'LIMIT_FILE_SIZE' ? 'File exceeds 15 MB limit' : e.message, 413);
  }
  if (e instanceof SyntaxError && e.status === 400) return err(res, 'Invalid JSON');
  return err(res, 'Unexpected server error', 500);
});

initialize()
  .then(() =>
    app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () =>
      console.log('ResearchFlow listening on port ' + (process.env.PORT || 3000))
    )
  )
  .catch(e => {
    console.error('Could not initialize database:', e);
    process.exit(1);
  });
