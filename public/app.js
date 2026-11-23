const state = {
  user: null,
  workspace: null,
  workspaces: [],
  csrf: null,
  aiEnabled: false,
  authMode: 'login', // 'login' | 'register'
  data: { tasks: [], notes: [], files: [], activities: [], members: [], maxSeats: 10 },
  page: 'overview',
  filter: 'All',
  phaseFilter: 'All',
  search: '',
  // Literature library state
  libSearch: '',
  libStatusFilter: 'All',
  libPhaseFilter: 'All',
  libView: 'list',
  selectedFiles: [],
  activeReviewFileId: null,
  comparisonPapers: null,
  messages: [],
  pendingActions: [],
  busy: false
};

const $ = id => document.getElementById(id);
const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, x => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[x]));
const shortDate = d =>
  d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const timeDate = d =>
  d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const initials = name =>
  String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

const statuses = ['To do', 'In progress', 'Blocked', 'Done'];
const phases = ['Planning', 'Literature review', 'Close reading', 'Archival research', 'Fieldwork', 'Analysis', 'Analytical', 'Numerical', 'Validation', 'Writing', 'Revision', 'Other'];
const readingStatuses = ['To Read', 'Skimming', 'Deep Read', 'Cited', 'Key Reference'];

const toast = (message, error = false) => {
  const e = $('toast');
  e.textContent = message;
  e.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (e.className = 'toast'), 4300);
};

async function api(path, { method = 'GET', body, form = false } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET' && state.csrf) opts.headers['X-CSRF-Token'] = state.csrf;
  if (body !== undefined) {
    if (form) {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  if (method !== 'GET' && state.workspace?.id) opts.headers['X-Workspace-Id'] = String(state.workspace.id);
  const response = await fetch('/api' + path, opts);
  let result = {};
  try {
    result = await response.json();
  } catch {
    if (response.ok) throw Error('Unexpected server response');
  }
  if (!response.ok) {
    if (response.status === 401) {
      state.user = null;
      authView();
    }
    throw Error(result.error || 'Request failed');
  }
  return result;
}

async function reload({ quiet = false } = {}) {
  try {
    const data = await api('/dashboard');
    state.data = data;
    if (data.workspace) state.workspace = data.workspace;
    const validIds = new Set(data.files.map(f => f.id));
    state.selectedFiles = state.selectedFiles.filter(id => validIds.has(id));
    if (state.activeReviewFileId && !validIds.has(state.activeReviewFileId)) {
      state.activeReviewFileId = null;
    }
    renderWorkspaceHeader();
    renderSidebar();
    render();
    connectLive();
    $('sync-status').innerHTML = '<span class="online-dot"></span> Synced';
  } catch (e) {
    if (!quiet) toast(e.message, true);
    $('sync-status').textContent = 'Sync unavailable';
  }
}

function authView() {
  closeLive();
  $('workspace').classList.add('hidden');
  $('auth').classList.remove('hidden');
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('token');
  const el = $('auth-form-container');

  if (invite) {
    el.innerHTML = `
      <div class="eyebrow">YOU'RE INVITED</div>
      <h2>Join your research workspace</h2>
      <p>Your teammate has invited you to collaborate. Create your account (or sign in with your invited email) to join.</p>
      <form id="accept-invite-form">
        <label>Your full name<input name="name" class="field" placeholder="Full name" required maxlength="90" /></label>
        <label>Create password<input name="password" class="field" type="password" minlength="12" autocomplete="new-password" placeholder="Minimum 12 characters" required /></label>
        <button class="button solid" type="submit">Accept invitation →</button>
      </form>
      <div class="mini-help">Invitation links expire after seven days and can only be used once.</div>`;
    return;
  }

  if (state.authMode === 'register') {
    el.innerHTML = `
      <div class="eyebrow">OPEN RESEARCH OPERATING SYSTEM</div>
      <h2>Create your workspace.</h2>
      <p>Set up a private workspace for your lab, thesis, or research team in seconds.</p>
      <form id="register-form">
        <label>Your full name<input name="name" class="field" placeholder="Dr. Jane Doe" required maxlength="90" /></label>
        <label>Workspace name<input name="workspaceName" class="field" placeholder="e.g. Research and Writing Group" required maxlength="100" /></label>
        <label>Email address<input name="email" type="email" class="field" autocomplete="username" placeholder="researcher@institution.edu" required /></label>
        <label>Password<input name="password" type="password" class="field" minlength="12" autocomplete="new-password" placeholder="Minimum 12 characters" required /></label>
        <button class="button solid" type="submit">Create workspace →</button>
      </form>
      <div class="mini-help" style="margin-top:14px">
        Already have an account? <button type="button" class="text-link" data-auth-mode="login">Sign in here →</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="eyebrow">RESEARCH COLLABORATION PLATFORM</div>
    <h2>Welcome back.</h2>
    <p>Sign in to access your research workspaces, literature reviews, and team tasks.</p>
    <form id="login-form">
      <label>Email address<input name="email" type="email" class="field" autocomplete="username" placeholder="researcher@institution.edu" required /></label>
      <label>Password<input name="password" type="password" class="field" autocomplete="current-password" placeholder="Enter your password" required /></label>
      <button class="button solid" type="submit">Sign in to workspace →</button>
    </form>
    <div class="mini-help" style="margin-top:14px">
      New to ResearchFlow? <button type="button" class="text-link" data-auth-mode="register">Create a free workspace →</button>
    </div>`;
}

function renderWorkspaceHeader() {
  const ws = state.workspace || { name: 'Research Workspace', role: 'owner' };
  const pill = document.querySelector('.workspace-pill');
  if (!pill) return;
  pill.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;width:100%">
      <span class="workspace-badge">${esc(initials(ws.name).slice(0, 1))}</span>
      <div style="flex:1;min-width:0">
        <select id="workspace-switcher" aria-label="Switch workspace" style="width:100%;background:transparent;border:none;font-weight:600;font-size:13px;color:inherit;cursor:pointer;padding:0">
          ${state.workspaces
            .map(w => `<option value="${w.id}" ${w.id === ws.id ? 'selected' : ''}>${esc(w.name)}</option>`)
            .join('')}
          <option value="__new__">＋ Create new workspace…</option>
        </select>
        <small style="display:block;opacity:0.75;font-size:11px">${ws.role === 'owner' ? 'Workspace owner' : 'Shared workspace'}</small>
      </div>
    </div>`;
}

function showApp() {
  $('auth').classList.add('hidden');
  $('workspace').classList.remove('hidden');
  const activeRole = state.workspace?.role || state.user.role || 'owner';
  $('my-name').textContent = state.user.name;
  $('my-role').textContent = activeRole === 'owner' ? 'Workspace owner' : 'Research collaborator';
  $('my-avatar').textContent = initials(state.user.name);
  $('top-avatar').textContent = initials(state.user.name);
  renderWorkspaceHeader();
  renderSidebar();
  render();
}

function renderSidebar() {
  const t = state.data.tasks;
  const f = state.data.files;
  $('sidebar-phases').innerHTML = phases
    .map(p => {
      const taskCount = t.filter(x => x.phase === p).length;
      const fileCount = f.filter(x => (x.project_phase || 'Other') === p).length;
      if (!taskCount && !fileCount) return '';
      return `<div class="sidebar-phase" title="${taskCount} task(s), ${fileCount} file(s)"><span><span class="phase-dot"></span>${p}</span><span class="phase-count">${taskCount + fileCount}</span></div>`;
    })
    .join('');
}

function render() {
  if (!state.user) return;
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === state.page));
  const names = {
    overview: 'Overview',
    tasks: 'Task board',
    agent: 'AI research agent',
    files: 'Research library',
    notes: 'Research notebook',
    activity: 'Activity timeline',
    team: 'Team'
  };
  $('breadcrumb-current').textContent = names[state.page] || 'Overview';
  $('content').innerHTML = (
    {
      overview: overviewPage,
      tasks: tasksPage,
      agent: agentPage,
      files: filesPage,
      notes: notesPage,
      activity: activityPage,
      team: teamPage
    }[state.page] || overviewPage
  )();
}

function goto(page) {
  state.page = page;
  connectLive();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function pageHeading(kicker, title, description, actions = '') {
  return `<div class="page-header"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

function statusPill(s) {
  const cn = { 'To do': 'todo', 'In progress': 'progress', Done: 'done', Blocked: 'blocked' }[s] || 'todo';
  return `<span class="pill ${cn}">${esc(s)}</span>`;
}

function priorityPill(p) {
  return `<span class="pill priority${esc((p || 'low').toLowerCase())}">${esc(p)}</span>`;
}

function table(tasks, limit = 0) {
  const arr = limit ? tasks.slice(0, limit) : tasks;
  if (!arr.length)
    return `<div class="empty-state"><div class="empty-symbol">☷</div><strong>Nothing here yet</strong><span>Add a research task to start tracking progress.</span></div>`;
  return `<div class="task-table-wrap"><table class="task-table"><thead><tr><th>Task</th><th>Research phase</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th><th>Actions</th></tr></thead><tbody>${arr
    .map(
      t =>
        `<tr><td>${state.page==="tasks"?pick(t):""}<button class="text-link task-title" data-edit="${t.id}" title="Edit task">${esc(t.title)}</button></td><td>${esc(t.phase)}</td><td>${esc(t.assignee_name || 'Unassigned')}</td><td>${statusPill(t.status)}</td><td>${priorityPill(t.priority)}</td><td>${t.due_date ? shortDate(t.due_date + 'T12:00:00') : '—'}</td><td><div class="inline-actions"><button class="tiny-btn" data-edit="${t.id}">Edit</button>${t.status !== 'Done' ? `<button class="tiny-btn" data-complete="${t.id}" title="Mark completed">✓</button>` : ''}<button class="tiny-btn" data-delete-task="${t.id}" title="Delete task">✕</button></div></td></tr>`
    )
    .join('')}</tbody></table></div>`;
}

function overviewPage() {
  const tasks = state.data.tasks,
    done = tasks.filter(t => t.status === 'Done').length,
    active = tasks.filter(t => t.status === 'In progress').length,
    blocked = tasks.filter(t => t.status === 'Blocked').length,
    percent = tasks.length ? Math.round((100 * done) / tasks.length) : 0;
  const current = tasks.filter(t => t.status !== 'Done');
  const f = state.data.files;
  const wsName = state.workspace?.name || 'Shared research workspace';
  return `${pageHeading(esc(wsName.toUpperCase()) + ' · ' + new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase(), 'Good to see you, ' + state.user.name.split(' ')[0] + '.', 'Here is the current state of your shared research workspace.', `<button class="button secondary" data-go="team">↗ Invite / team</button><button class="button solid" data-new-task>＋ New task</button>`)}
 <div class="cards"><div class="card stat-card"><span class="stat-caption">Total research tasks</span><span class="stat-icon">▦</span><div class="stat-number">${tasks.length}</div><div class="stat-foot">Across ${new Set(tasks.map(t => t.phase)).size} active phases</div></div><div class="card stat-card"><span class="stat-caption">Completed</span><span class="stat-icon green">✓</span><div class="stat-number">${done}</div><div class="stat-foot">Tasks completed</div></div><div class="card stat-card"><span class="stat-caption">Currently active</span><span class="stat-icon orange">◷</span><div class="stat-number">${active}</div><div class="stat-foot">${blocked} task(s) blocked</div></div><div class="card stat-card"><span class="stat-caption">Research documents</span><span class="stat-icon purple">▤</span><div class="stat-number">${f.length}</div><div class="stat-foot">${f.filter(x => x.ai_review_data).length} analyzed for lit review</div></div></div>
 <div class="dashboard-grid"><section class="card panel"><div class="panel-heading">Project health <button class="text-link" data-go="tasks">View all tasks ↗</button></div><div class="progress-layout"><div class="donut" style="--percentage:${percent}%"><div class="donut-center"><strong>${percent}%</strong><small>COMPLETE</small></div></div><div class="progress-breakdown"><div class="key-row"><span class="key-label"><span class="key-dot green"></span> Completed</span><strong>${done}</strong></div><div class="key-row"><span class="key-label"><span class="key-dot orange"></span> In progress</span><strong>${active}</strong></div><div class="key-row"><span class="key-label"><span class="key-dot"></span> To do</span><strong>${tasks.filter(t => t.status === 'To do').length}</strong></div><div class="key-row"><span class="key-label"><span class="key-dot red"></span> Blocked</span><strong>${blocked}</strong></div></div></div><p class="small-text muted" style="margin:18px 0 0">Progress shows the share of tasks marked done.</p></section>
 <section class="agent-feature"><div class="eyebrow">✧ RESEARCH COPILOT</div><h3>Update work in seconds.</h3><p>Tell the agent what you accomplished. Review its proposed updates and apply them with one click.</p><form id="quick-form" class="agent-inline"><input name="message" placeholder="e.g. Completed literature synthesis for Section 2" required /><button type="submit">Send ↗</button></form><div class="suggestions"><button data-prompt="Show project progress">Summarize progress</button><button data-prompt="Add task: Compare two primary sources">＋ Add reading task</button></div></section></div>
 ${overviewAnalytics()}<div class="two-col section-spacer"><section class="card panel"><div class="panel-heading">Priority tasks <button class="text-link" data-go="tasks">Open task board ↗</button></div>${table(current, 5)}</section><section class="card panel"><div class="panel-heading">Latest activity <button class="text-link" data-go="activity">View timeline ↗</button></div>${activityRows(state.data.activities.slice(0, 5))}</section></div>`;
}

function filteredTasks() {
  let arr = state.data.tasks;
  if (state.filter !== 'All') arr = arr.filter(t => t.status === state.filter);
  if (state.phaseFilter !== 'All') arr = arr.filter(t => t.phase === state.phaseFilter);
  if (state.search)
    arr = arr.filter(t =>
      [t.title, t.description, t.assignee_name, t.phase].join(' ').toLowerCase().includes(state.search.toLowerCase())
    );
  return arr;
}

function tasksPage() {
  const total = state.data.tasks.length;
  return `${pageHeading('WORK MANAGEMENT', 'Task board', 'Organise reading, fieldwork, analysis and writing. Link each task to its sources.', `<button class="button solid" data-new-task>＋ Create task</button>`)}<div class="card panel">${boardTools()}<div class="filter-bar"><div class="search-box"><input class="field" id="task-search" placeholder="Search tasks..." value="${esc(state.search)}" /></div><select class="field" id="status-filter"><option>All</option>${statuses.map(s => `<option ${state.filter === s ? 'selected' : ''}>${s}</option>`).join('')}</select><select class="field" id="phase-filter"><option>All</option>${phases.map(p => `<option ${state.phaseFilter === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div><div class="panel-heading"><span>Research tasks <span class="muted small-text" id="task-count">(${filteredTasks().length} of ${total})</span></span></div><div id="task-table-target">${boardContent()}</div></div><div class="hint section-spacer">Tip: Open a task to assign it to any teammate, set a due date, or change its status. Changes are saved in the shared workspace database.</div>`;
}

function agentPage() {
  const messages = state.messages.length
    ? state.messages
    : [
        {
          role: 'assistant',
          text: 'Welcome to your research copilot. I can turn updates into proposed task changes, create research notes, and summarize your project. Every write action requires your confirmation.'
        }
      ];
  const proposals = state.pendingActions.length
    ? `<div class="action-review"><strong>PROPOSED CHANGES · REVIEW BEFORE APPLYING</strong><ul>${state.pendingActions.map(a => `<li>${esc(describeAction(a))}</li>`).join('')}</ul><div class="action-buttons"><button class="button teal small" id="confirm-actions">✓ Apply ${state.pendingActions.length} update(s)</button><button class="button secondary small" id="discard-actions">Discard</button></div></div>`
    : '';
  return `${pageHeading('NATURAL LANGUAGE WORKFLOW', 'AI research agent', 'Talk to your project workspace instead of navigating multiple forms.', `<span class="meta-tag">${state.aiEnabled ? 'AI-POWERED' : 'QUICK COMMAND MODE'}</span>`)}<div class="agent-page-layout"><section class="card panel agent-main"><div class="panel-heading">✧ Research copilot <span class="small-text muted">Actions require approval</span></div><div class="chat-scroll" id="chat-scroll">${messages.map(m => `<div class="chat-bubble ${m.role}">${esc(m.text)}</div>`).join('')}</div>${proposals}<form id="agent-form" class="agent-compose"><textarea id="agent-message" name="message" rows="2" placeholder="Type what you completed, started, or want to add..." required maxlength="3000"></textarea><button class="button solid" type="submit">Send ↗</button></form><p class="muted" style="font-size:10px">${state.aiEnabled ? 'Commands are sent securely from the server to the configured AI provider.' : 'Add OPENAI_API_KEY on the server for full natural-language AI. Basic commands work without it.'}</p></section><aside class="card panel"><div class="panel-heading">Things you can ask</div>${['“Completed literature review matrix”', '“Started chapter revision”', '“Add task: Compare two translations”', '“Note: Check the edition before citing this passage”', '“Show project progress”'].map(x => `<button class="mini-tip text-link" data-prompt="${esc(x.slice(1, -1))}" style="text-align:left;display:block;width:100%;white-space:normal">${esc(x)} ↗</button>`).join('')}<div class="hint" style="margin-top:22px">The agent will never mark work complete or add notes without presenting the proposed changes for your approval.</div></aside></div>`;
}

function describeAction(a) {
  if (a.type === 'add_task') return 'Create task: ' + a.title;
  if (a.type === 'add_note') return 'Add research note: ' + a.body.slice(0, 140);
  if (a.type === 'update_task') {
    const t = state.data.tasks.find(t => t.id === a.taskId);
    return 'Set ' + (t?.title || 'task #' + a.taskId) + ' to ' + a.status;
  }
  return 'Unknown action';
}

// =========================================================================
// LITERATURE REVIEW & RESEARCH LIBRARY
// =========================================================================

function filteredFiles() {
  let arr = state.data.files || [];
  if (state.libStatusFilter !== 'All') {
    arr = arr.filter(f => (f.reading_status || 'To Read') === state.libStatusFilter);
  }
  if (state.libPhaseFilter !== 'All') {
    arr = arr.filter(f => (f.project_phase || 'Other') === state.libPhaseFilter);
  }
  if (state.libSearch) {
    const q = state.libSearch.toLowerCase();
    arr = arr.filter(f => {
      const rev = f.ai_review_data || {};
      const cit = f.citation_meta || {};
      return [
        f.original_name,
        f.uploader_name,
        f.reading_status,
        f.project_phase,
        (f.tags || []).join(' '),
        f.user_notes,
        cit.authors,
        cit.title,
        cit.year,
        rev.objective,
        rev.methodology,
        rev.key_findings
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }
  return arr;
}

function isTextExtractable(filename) {
  return /\.(pdf|docx|txt|csv|md|json|inp|dat|log|sta|msg|py)$/i.test(filename);
}

function renderFileListOrMatrix(files) {
  if (!files.length) {
    return empty(
      '▤',
      state.data.files.length ? 'No matching papers' : 'No research files yet',
      state.data.files.length
        ? 'Try clearing your search or status/phase filters.'
        : 'Upload your first research document and it will appear here for your team.'
    );
  }

  if (state.libView === 'matrix') {
    return `<div class="task-table-wrap"><table class="task-table">
      <thead>
        <tr>
          <th style="width:28px"><input type="checkbox" id="select-all-files" ${files.every(f => state.selectedFiles.includes(f.id)) ? 'checked' : ''} /></th>
          <th>Paper / File</th>
          <th>Phase & Status</th>
          <th>Objective & Methodology</th>
          <th>Evidence & Concepts</th>
          <th>Key Findings & Gaps</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${files
          .map(f => {
            const rev = f.ai_review_data;
            const cit = f.citation_meta || {};
            const checked = state.selectedFiles.includes(f.id);
            return `<tr>
              <td><input type="checkbox" data-select-file="${f.id}" ${checked ? 'checked' : ''} /></td>
              <td style="min-width:170px">
                <strong>${esc(f.original_name)}</strong>
                ${cit.authors || cit.year ? `<div class="small-text muted">${esc(cit.authors || '')} ${cit.year ? `(${esc(cit.year)})` : ''}</div>` : ''}
                <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">
                  ${(f.tags || []).map(t => `<span class="meta-tag" style="font-size:10px;padding:1px 6px">#${esc(t)}</span>`).join('')}
                </div>
              </td>
              <td style="min-width:130px">
                <select class="field" style="padding:4px 6px;font-size:11px;margin-bottom:5px" data-file-status="${f.id}">
                  ${readingStatuses.map(s => `<option ${f.reading_status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
                </select>
                <select class="field" style="padding:4px 6px;font-size:11px" data-file-phase="${f.id}">
                  ${phases.map(p => `<option ${(f.project_phase || 'Other') === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
                </select>
              </td>
              <td style="min-width:210px;max-width:260px;white-space:normal;font-size:12px">
                ${
                  rev
                    ? `<div><strong>Obj:</strong> ${esc((rev.objective || '—').slice(0, 140))}${rev.objective?.length > 140 ? '…' : ''}</div>
                       <div style="margin-top:4px"><strong>Method:</strong> ${esc((rev.methodology || '—').slice(0, 140))}${rev.methodology?.length > 140 ? '…' : ''}</div>`
                    : `<span class="muted">Not extracted yet. Click <strong>Analyze</strong>.</span>`
                }
              </td>
              <td style="min-width:180px;max-width:230px;white-space:normal;font-size:12px">
                ${rev ? esc((rev.governing_equations_and_params || '—').slice(0, 180)) + (rev.governing_equations_and_params?.length > 180 ? '…' : '') : '<span class="muted">—</span>'}
              </td>
              <td style="min-width:210px;max-width:260px;white-space:normal;font-size:12px">
                ${
                  rev
                    ? `<div><strong>Findings:</strong> ${esc((rev.key_findings || '—').slice(0, 140))}${rev.key_findings?.length > 140 ? '…' : ''}</div>
                       <div style="margin-top:4px" class="muted"><strong>Gaps:</strong> ${esc((rev.limitations_and_gaps || '—').slice(0, 110))}</div>`
                    : '<span class="muted">—</span>'
                }
              </td>
              <td>
                <div class="inline-actions" style="flex-wrap:wrap">
                  <button class="tiny-btn" data-open-review="${f.id}">${rev ? '✧ Review' : '✧ Analyze'}</button>
                  <button class="tiny-btn" data-copy-bibtex="${f.id}" title="Copy BibTeX">📋 BibTeX</button>
                  <button class="tiny-btn" data-download="${f.id}" title="Download">↓</button>
                </div>
              </td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table></div>`;
  }

  return `<div class="file-list">${files
    .map(f => {
      const hasReview = Boolean(f.ai_review_data);
      const hasNotes = Boolean((f.user_notes || '').trim());
      const checked = state.selectedFiles.includes(f.id);
      const cit = f.citation_meta || {};
      const tags = Array.isArray(f.tags) ? f.tags : [];
      return `<div class="file-item" style="align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px;padding-top:4px">
          <input type="checkbox" data-select-file="${f.id}" ${checked ? 'checked' : ''} title="Select for side-by-side comparison" />
          <span class="file-type">${esc(f.original_name.split('.').pop().slice(0, 5).toUpperCase())}</span>
        </div>
        <div class="file-info" style="min-width:220px;flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong title="${esc(f.original_name)}">${esc(f.original_name)}</strong>
            ${hasReview ? `<span class="pill done" style="font-size:10px;padding:1px 7px">✓ Extracted</span>` : ''}
            ${hasNotes ? `<span class="pill progress" style="font-size:10px;padding:1px 7px">📝 Notes</span>` : ''}
          </div>
          <small style="display:block;margin-top:2px">
            ${esc(f.uploader_name)} · ${shortDate(f.created_at)} · ${formatBytes(f.bytes)}
            ${cit.authors || cit.year ? ` · <em>${esc(cit.authors || '')}${cit.year ? ' (' + esc(cit.year) + ')' : ''}</em>` : ''}
          </small>
          ${
            tags.length
              ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">
                  ${tags.map(t => `<span class="meta-tag" style="font-size:10px;padding:1px 7px">#${esc(t)}</span>`).join('')}
                </div>`
              : ''
          }
        </div>
        <div class="file-actions" style="flex-wrap:wrap;gap:6px;align-items:center">
          <select class="field" style="width:auto;padding:4px 8px;font-size:11px" data-file-status="${f.id}" title="Reading status">
            ${readingStatuses.map(s => `<option ${(f.reading_status || 'To Read') === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
          <select class="field" style="width:auto;padding:4px 8px;font-size:11px" data-file-phase="${f.id}" title="Project phase">
            ${phases.map(p => `<option ${(f.project_phase || 'Other') === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
          ${
            isTextExtractable(f.original_name)
              ? `<button class="button secondary small" data-open-review="${f.id}">${hasReview ? '✧ View Review' : '✧ Analyze'}</button>`
              : `<button class="button secondary small" data-open-review="${f.id}">📝 Notes</button>`
          }
          <button class="button secondary small" data-copy-bibtex="${f.id}" title="Copy BibTeX citation">📋 BibTeX</button>
          <button class="button secondary small" data-download="${f.id}">↓ Download</button>
          <button class="button ghost small" data-delete-file="${f.id}">Delete</button>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

function renderActiveReviewDrawer() {
  if (!state.activeReviewFileId) return '';
  const f = state.data.files.find(x => x.id === state.activeReviewFileId);
  if (!f) return '';
  const rev = f.ai_review_data;
  const cit = f.citation_meta || {};
  const extractable = isTextExtractable(f.original_name);

  return `<div id="file-summary" class="card panel section-spacer" style="border-left:3px solid var(--accent,#0d9488)">
    <div class="mini-tip"><strong>Linked tasks</strong> ${state.data.tasks.filter(t => t.source_ids?.includes(f.id)).map(t => recordLink('task',t.id)).join(' ') || 'No linked tasks yet.'}
    ${relatedNotes('source_id',f.id)}${recordHistory('file',f.id)}</div>
    <div class="panel-heading" style="flex-wrap:wrap;gap:8px">
      <span>✧ Literature Review & Notes · <strong>${esc(f.original_name)}</strong></span>
      <div class="inline-actions" style="flex-wrap:wrap">
        ${
          extractable
            ? `<button class="button secondary small" data-summarize="${f.id}" data-force="${rev ? '1' : '0'}" ${state.aiEnabled ? '' : 'disabled'}>
                ${rev ? '↻ Re-analyze Paper' : '✧ Run AI Extraction'}
              </button>`
            : ''
        }
        <button class="button secondary small" data-copy-bibtex="${f.id}">📋 Copy BibTeX</button>
        <button class="button secondary small" data-send-to-notebook="${f.id}">＋ Send to Research Notebook</button>
        <button class="button secondary small" data-task-from-file="${f.id}">＋ Follow-up Task</button>
        <button class="text-link" id="dismiss-summary">Close ✕</button>
      </div>
    </div>

    ${
      cit.title || cit.authors
        ? `<div class="hint" style="margin-bottom:14px">
            <strong>${esc(cit.title || f.original_name)}</strong><br/>
            <span class="small-text">${esc(cit.authors || '')} ${cit.year ? `(${esc(cit.year)})` : ''} ${cit.journal ? `· <em>${esc(cit.journal)}</em>` : ''}</span>
          </div>`
        : ''
    }

    ${
      rev
        ? `<div class="two-col" style="margin-bottom:16px">
            <div class="mini-tip"><strong>1. Research Objective</strong><p style="margin:6px 0 0;white-space:pre-wrap">${esc(rev.objective || '—')}</p></div>
            <div class="mini-tip"><strong>2. Methodology & Model</strong><p style="margin:6px 0 0;white-space:pre-wrap">${esc(rev.methodology || '—')}</p></div>
            <div class="mini-tip"><strong>3. Evidence, Concepts & Parameters</strong><p style="margin:6px 0 0;white-space:pre-wrap">${esc(rev.governing_equations_and_params || '—')}</p></div>
            <div class="mini-tip"><strong>4. Key Findings & Conclusions</strong><p style="margin:6px 0 0;white-space:pre-wrap">${esc(rev.key_findings || '—')}</p></div>
          </div>
          <div class="mini-tip" style="margin-bottom:16px"><strong>5. Limitations & Research Gaps</strong><p style="margin:6px 0 0;white-space:pre-wrap">${esc(rev.limitations_and_gaps || '—')}</p></div>
          ${rev.truncated ? '<div class="hint" style="margin-bottom:14px">Note: Middle sections were truncated to fit model context limits.</div>' : ''}`
        : extractable
          ? `<div class="hint" style="margin-bottom:16px">No structured AI review cached yet. Click <strong>Run AI Extraction</strong> above to extract Objective, Methodology, Evidence, Findings, and BibTeX automatically.</div>`
          : ''
    }

    <form id="file-notes-form" data-file-id="${f.id}">
      <div class="two-col" style="margin-bottom:10px">
        <label style="display:block">
          <span class="small-text"><strong>Topic Tags</strong> (comma-separated)</span>
          <input name="tags" class="field" value="${esc((f.tags || []).join(', '))}" placeholder="e.g. Methodology, Baseline, Simulation, Theory" />
        </label>
        <div style="display:flex;gap:10px">
          <label style="flex:1">
            <span class="small-text"><strong>Reading Status</strong></span>
            <select name="reading_status" class="field">
              ${readingStatuses.map(s => `<option ${(f.reading_status || 'To Read') === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
          </label>
          <label style="flex:1">
            <span class="small-text"><strong>Project Phase</strong></span>
            <select name="project_phase" class="field">
              ${phases.map(p => `<option ${(f.project_phase || 'Other') === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
      <label style="display:block">
        <span class="small-text"><strong>Personal Literature Notes, Evidence & Concepts</strong></span>
        <textarea name="user_notes" class="field" rows="4" placeholder="Record a passage and page number, an archival reference, a model assumption or your interpretation...">${esc(f.user_notes || '')}</textarea>
      </label>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button type="submit" class="button solid small">✓ Save Notes & Tags</button>
      </div>
    </form>
  </div>`;
}

function renderComparisonPanel() {
  if (!state.comparisonPapers || state.comparisonPapers.length < 2) return '';
  const papers = state.comparisonPapers;
  const rows = [
    { label: 'Citation / Year', fn: p => `${p.citation_meta?.authors || '—'} (${p.citation_meta?.year || '—'})` },
    { label: 'Phase & Status', fn: p => `${p.project_phase || 'Other'} · ${p.reading_status || 'To Read'}` },
    { label: 'Objective', fn: p => p.ai_review_data?.objective || 'Not extracted yet' },
    { label: 'Methodology', fn: p => p.ai_review_data?.methodology || 'Not extracted yet' },
    { label: 'Evidence & Concepts', fn: p => p.ai_review_data?.governing_equations_and_params || 'Not extracted yet' },
    { label: 'Key Findings', fn: p => p.ai_review_data?.key_findings || 'Not extracted yet' },
    { label: 'Limitations & Gaps', fn: p => p.ai_review_data?.limitations_and_gaps || 'Not extracted yet' },
    { label: 'Your Notes', fn: p => p.user_notes || '—' }
  ];

  return `<div id="comparison-panel" class="card panel section-spacer" style="border-left:3px solid #6366f1">
    <div class="panel-heading">
      <span>⇄ Side-by-Side Literature Comparison (${papers.length} papers)</span>
      <button class="text-link" id="close-comparison">Close ✕</button>
    </div>
    <div class="task-table-wrap">
      <table class="task-table">
        <thead>
          <tr>
            <th style="width:160px">Dimension</th>
            ${papers.map(p => `<th style="min-width:240px">${esc(p.original_name)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              r => `<tr>
                <td><strong>${esc(r.label)}</strong></td>
                ${papers.map(p => `<td style="white-space:normal;vertical-align:top;font-size:12px">${esc(r.fn(p))}</td>`).join('')}
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

let uploadReport = null;
let uploading = false;
function uploadFeedback() {
  if (!uploadReport || uploadReport.workspace !== state.workspace?.id) return '';
  const {done,total,failures,current} = uploadReport;
  return '<p>' + (current ? 'Uploading ' + esc(current) + '… · ' : '') + done + ' of ' + total + ' uploaded</p>' +
    failures.map(message => '<div class="small-text">' + esc(message) + '</div>').join('');
}
function filesPage() {
  const allFiles = state.data.files;
  const shownFiles = filteredFiles();
  const analyzedCount = allFiles.filter(f => f.ai_review_data).length;
  const citedCount = allFiles.filter(f => f.reading_status === 'Cited' || f.reading_status === 'Key Reference').length;

  return `${pageHeading(
    'KNOWLEDGE BASE & LITERATURE REVIEW',
    'Research library',
    'Collect primary texts, articles and research materials. Compare evidence and connect it to your notes and tasks.',
    `<span class="meta-tag">${allFiles.length} files · ${analyzedCount} extracted · ${citedCount} key/cited</span>`
  )}
  <div id="drop-zone" class="file-drop" style="display:block">
    <span class="upload-icon">⇧</span>
    <h3>Drop research files here, or browse</h3>
    <p>PDF, DOCX, XLSX, CSV, INP, DAT, LOG, STA, MSG, TXT, ZIP and more · 15 MiB per file</p>
    <button type="button" class="button secondary small" id="browse-files">Browse files</button>
    <input id="file-input" type="file" hidden multiple accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json,.inp,.dat,.log,.sta,.msg,.odb,.py,.png,.jpg,.jpeg,.zip" />
  </div>
  <div id="upload-feedback" role="status" aria-live="polite">${uploadFeedback()}</div>

  ${renderActiveReviewDrawer()}
  ${renderComparisonPanel()}

  <div class="card panel section-spacer">
    <div class="filter-bar" style="margin-bottom:14px">
      <div class="search-box">
        <input class="field" id="lib-search" placeholder="Search title, author, tag, concept, or note..." value="${esc(state.libSearch)}" />
      </div>
      <select class="field" id="lib-status-filter">
        <option value="All">All statuses</option>
        ${readingStatuses.map(s => `<option value="${esc(s)}" ${state.libStatusFilter === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
      <select class="field" id="lib-phase-filter">
        <option value="All">All phases</option>
        ${phases.map(p => `<option value="${esc(p)}" ${state.libPhaseFilter === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
    </div>

    <div class="panel-heading" style="flex-wrap:wrap;gap:10px">
      <span>Files shared by your team <span class="muted small-text" id="lib-count">(${shownFiles.length} of ${allFiles.length})</span></span>
      <div class="inline-actions" style="flex-wrap:wrap">
        ${
          state.selectedFiles.length >= 2
            ? `<button class="button solid small" id="compare-selected-btn">⇄ Compare Selected (${state.selectedFiles.length})</button>`
            : ''
        }
        ${
          state.selectedFiles.length > 0
            ? `<button class="button ghost small" id="clear-selected-btn">Clear (${state.selectedFiles.length})</button>`
            : ''
        }
        <button class="tiny-btn ${state.libView === 'list' ? 'active' : ''}" data-lib-view="list">☰ List View</button>
        <button class="tiny-btn ${state.libView === 'matrix' ? 'active' : ''}" data-lib-view="matrix">⊞ Literature Matrix</button>
      </div>
    </div>

    <div id="lib-files-target">
      ${renderFileListOrMatrix(shownFiles)}
    </div>
  </div>

  <div class="hint section-spacer">Privacy: files are isolated to your workspace in PostgreSQL. Only invited members of this workspace can access them.</div>`;
}

// =========================================================================

const formatBytes = n =>
  n < 1024 ? n + ' bytes' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const empty = (symbol, title, help) =>
  `<div class="empty-state"><div class="empty-symbol">${symbol}</div><strong>${esc(title)}</strong><span>${esc(help)}</span></div>`;

function recordLink(kind, id) {
  const rows = {task: state.data.tasks, file: state.data.files, note: state.data.notes}[kind];
  const row = rows?.find(r => r.id === id);
  if (!row) return '';
  const label = row.title || row.original_name || row.body.slice(0,65);
  return `<button type="button" class="tiny-btn" data-record="${kind}" data-record-id="${id}">${esc(label)}</button>`;
}

function relatedNotes(key, id) {
  const rows = state.data.notes.filter(n => n[key] === id);
  return rows.length ? `<p><strong>Notebook</strong> ${rows.map(n => recordLink('note',n.id)).join(' ')}</p>` : '';
}

function recordHistory(kind, id) {
  const rows = state.data.activities.filter(a => a.record_kind === kind && a.record_id === id);
  return rows.length ? `<details><summary>Recent activity (${rows.length})</summary>${rows.map(a => `<p>${timeDate(a.created_at)} · ${esc(a.actor_name)} · ${esc(a.description)}</p>`).join('')}</details>` : '';
}

function recordOptions(rows, field) {
  return '<option value="">None</option>' + rows.map(r => `<option value="${r.id}">${esc(r[field])}</option>`).join('');
}

function notesPage() {
  const notes = state.data.notes;
  return `${pageHeading('RESEARCH JOURNAL', 'Research notebook', 'Document decisions, meetings, methods, breakthroughs, and next steps.')}
 <div class="two-col"><section><div class="card panel"><div class="panel-heading">Add a research note</div><form id="note-form"><div class="form-grid"><label>Related task<select class="field" name="taskId">${recordOptions(state.data.tasks,'title')}</select></label><label>Library source<select class="field" name="sourceId">${recordOptions(state.data.files,'original_name')}</select></label></div><textarea name="body" class="field" rows="5" maxlength="10000" required placeholder="Record a passage, observation or decision. Include a page or archive reference."></textarea><div style="display:flex;justify-content:flex-end;margin-top:11px"><button type="submit" class="button solid">＋ Save to notebook</button></div></form></div><div class="note-list section-spacer">${notes.length ? notes.map(n => `<div class="card note-card" id="note-${n.id}" tabindex="-1"><div class="note-meta"><span><strong>${esc(n.author_name || 'Researcher')}</strong> · ${timeDate(n.created_at)}</span><button class="text-link" data-delete-note="${n.id}">Delete</button></div><p>${esc(n.body)}</p>${recordLink('task',n.task_id)} ${recordLink('file',n.source_id)}${recordHistory('note',n.id)}</div>`).join('') : empty('≡', 'Notebook is empty', 'Create the first research note.')}</div></section><section class="card panel" style="align-self:start"><div class="panel-heading">Suggested note format</div><div class="mini-tip"><strong>Research activity</strong><br/>Which sources, methods or questions did you work on?</div><div class="mini-tip"><strong>Observations</strong><br/>What results, errors or limitations emerged?</div><div class="mini-tip"><strong>Decisions</strong><br/>Which interpretations or assumptions did you agree on?</div><div class="mini-tip"><strong>Next steps</strong><br/>What should each collaborator do next?</div></section></div>`;
}

function activityRows(rows) {
  if (!rows.length) return empty('◷', 'No activity yet', 'Task and file changes will appear here.');
  return rows
    .map(
      a =>
        `<div class="timeline-entry"><span class="timeline-avatar">${esc(initials(a.actor_name))}</span><div><strong>${esc(a.description)}</strong><p>${esc(a.actor_name || 'Workspace')} · ${timeDate(a.created_at)}</p>${recordLink(a.record_kind,a.record_id)}</div></div>`
    )
    .join('');
}

function activityPage() {
  return `${pageHeading('RESEARCH HISTORY', 'Activity timeline', 'See who updated what and when, in chronological order.')}<div class="card panel">${activityRows(state.data.activities)}</div>`;
}

function teamPage() {
  const m = state.data.members;
  const maxSeats = state.data.maxSeats || 10;
  const isOwner = (state.workspace?.role || state.user.role) === 'owner';
  const wsName = state.workspace?.name || 'Research Workspace';

  return `${pageHeading('COLLABORATION', 'Research team', `Manage members for ${wsName}.`)}
 <div class="two-col">
   <div class="card panel">
     <div class="panel-heading">Workspace members <span class="meta-tag">${m.length} of ${maxSeats} seats</span></div>
     ${m
       .map(
         u =>
           `<div class="member-row"><div class="avatar">${esc(initials(u.name))}</div><div class="member-info"><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></div><div class="member-role">${u.role === 'owner' ? 'OWNER' : 'COLLABORATOR'}</div></div>`
       )
       .join('')}
   </div>
   <div class="card panel">
     <div class="panel-heading">Invite a teammate</div>
     ${
       isOwner && m.length < maxSeats
         ? `<p class="small-text muted">Invite a research colleague to <strong>${esc(wsName)}</strong> using their email address. A private one-time link will be generated for you to share securely.</p>
            <form id="invite-form">
              <input type="email" name="email" class="field" required placeholder="colleague@university.edu" />
              <button class="button solid" style="margin-top:11px" type="submit">Generate invitation link</button>
            </form>
            <div id="invite-result"></div>`
         : m.length >= maxSeats
           ? `<div class="hint">All ${maxSeats} workspace seats are occupied.</div>`
           : `<div class="hint">Ask the workspace owner to generate new teammate invitations.</div>`
     }
   </div>
 </div>`;
}

function openTask(task = null) {
  const dlg = $('task-dialog');
  const f = $('task-form');
  f.reset();
  f.dataset.revision=task?.revision || '';
  $('task-dialog-title').textContent = task && task.id ? 'Edit research task' : 'New research task';
  f.elements.id.value = task?.id || '';
  f.elements.title.value = task?.title || '';
  f.elements.description.value = task?.description || '';
  f.elements.phase.innerHTML = phases.map(p => `<option>${esc(p)}</option>`).join('');
  f.elements.phase.value = task?.phase || 'Planning';
  $('task-links')?.remove();
  const links = document.createElement('section');
  links.id = 'task-links';
  links.className = 'mini-tip';
  const original = task?.id ? task.source_ids || [] : [];
  const selected = task?.source_ids || [];
  links.innerHTML = `<details><summary>Library sources (${selected.length})</summary>
    <div style="max-height:12rem;overflow:auto">${state.data.files.map(file => `<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-source-id="${file.id}" data-original="${original.includes(file.id)}" ${selected.includes(file.id) ? 'checked' : ''}>${esc(file.original_name)}</label>`).join('') || 'Upload a source in the research library.'}</div></details>
    ${selected.map(id => recordLink('file',id)).join(' ')}
    ${task?.id ? relatedNotes('task_id',task.id) + recordHistory('task',task.id) : ''}`;
  f.querySelector('.dialog-actions').before(links);
  f.elements.status.value = task?.status || 'To do';
  f.elements.priority.value = task?.priority || 'Medium';
  f.elements.dueDate.value = task?.due_date ? String(task.due_date).slice(0, 10) : '';
  $('task-assign').innerHTML =
    `<option value="">Unassigned</option>` +
    state.data.members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  f.elements.assigneeId.value = task?.assignee_id || '';
  if(task?.id) links.insertAdjacentHTML('beforeend',detailPanel(task));
  dlg.showModal();
  connectLive();
}

async function createTask(form) {
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  const body = {
    sources: {
      add: [...form.querySelectorAll('[data-source-id]:checked')].filter(i => i.dataset.original === 'false').map(i => Number(i.dataset.sourceId)),
      remove: [...form.querySelectorAll('[data-source-id]:not(:checked)')].filter(i => i.dataset.original === 'true').map(i => Number(i.dataset.sourceId))
    },
    revision: id ? Number(form.dataset.revision) : undefined,
    title: data.title,
    description: data.description,
    phase: data.phase,
    status: data.status,
    priority: data.priority,
    assigneeId: data.assigneeId ? Number(data.assigneeId) : null,
    dueDate: data.dueDate || null
  };
  if (id) await api('/tasks/' + id, { method: 'PATCH', body });
  else await api('/tasks', { method: 'POST', body });
  $('task-dialog').close();
  toast(id ? 'Task updated' : 'New research task created');
  await reload();
}

async function handleAgent(message) {
  if (state.busy) return;
  state.busy = true;
  state.pendingActions = [];
  state.messages.push({ role: 'user', text: message });
  goto('agent');
  state.messages.push({ role: 'assistant', text: 'Interpreting your update…' });
  render();
  try {
    const result = await api('/agent/interpret', { method: 'POST', body: { message } });
    state.messages.pop();
    state.messages.push({ role: 'assistant', text: result.reply || 'No response.' });
    state.pendingActions = result.actions || [];
  } catch (e) {
    state.messages.pop();
    state.messages.push({ role: 'assistant', text: 'Unable to process this command: ' + e.message });
  } finally {
    state.busy = false;
    render();
    const chat = $('chat-scroll');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }
}

async function uploadFiles(files) {
  if (uploading) { toast('An upload is in progress. Add more files after it finishes.', true); return; }
  const list = Array.from(files);
  const workspace = state.workspace.id;
  const phase = state.libPhaseFilter;
  const report = {workspace, total:list.length, done:0, current:'', failures:[]};
  uploadReport = report;
  uploading = true;
  function display() {
    const feedback = $('upload-feedback');
    if (feedback) feedback.innerHTML = uploadFeedback();
  }
  try {
    for (const file of list) {
      if (state.workspace?.id !== workspace) { report.failures.push('Workspace switched. Remaining files were skipped.'); break; }
      report.current = file.name;
      display();
      try {
        if (file.size > 15 * 1024 * 1024) throw Error('exceeds the 15 MiB limit');
        if (!/\.(pdf|docx|xlsx|csv|txt|md|json|inp|dat|log|sta|msg|odb|py|png|jpg|jpeg|zip)$/i.test(file.name)) throw Error('unsupported file type');
        const form = new FormData();
        form.append('file', file);
        if (phase !== 'All') form.append('project_phase', phase);
        await api('/files', {method:'POST', body:form, form:true});
        report.done++;
      } catch (error) {
        report.failures.push(file.name + ' — ' + error.message);
      }
    }
  } finally {
    uploading = false;
    report.current = '';
    display();
    if (state.workspace?.id === workspace) await reload();
  }
}

async function runFileAnalysis(fileId, forceRefresh = false) {
  toast(forceRefresh ? 'Re-analyzing paper…' : 'Extracting structured literature review…');
  const r = await api('/agent/summarize-file/' + fileId, {
    method: 'POST',
    body: { forceRefresh }
  });
  toast(r.cached ? 'Loaded cached literature extraction' : 'Literature review extracted & saved');
  state.activeReviewFileId = Number(fileId);
  await reload({ quiet: true });
}

function buildBibtexFallback(f) {
  const cit = f.citation_meta || {};
  if (cit.bibtex && cit.bibtex.trim()) return cit.bibtex.trim();
  const slug = f.original_name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '');
  return `@article{${slug || 'ref' + f.id},\n  title = {${cit.title || f.original_name}},\n  author = {${cit.authors || 'Unknown'}},\n  year = {${cit.year || new Date(f.created_at).getFullYear()}}\n}`;
}

async function boot() {
  try {
    const r = await api('/bootstrap');
    if (!r.authenticated) {
      authView();
      return;
    }
    state.user = r.user;
    state.workspace = r.workspace;
    state.workspaces = r.workspaces || [];
    state.csrf = r.csrf;
    state.aiEnabled = r.aiEnabled;
    showApp();
    await reload();
    setInterval(() => {
      if (
        state.user &&
        !state.busy &&
        $('task-dialog').open === false &&
        document.visibilityState === 'visible' &&
        !document.querySelector('#content input:focus,#content textarea:focus,#content select:focus')
      )
        reload({ quiet: true });
    }, 30000);
  } catch (e) {
    authView();
    toast('Unable to connect: ' + e.message, true);
  }
}

document.addEventListener('input', e => {
  if (e.target.id !== 'find-query') return;
  const term = e.target.value.trim().toLowerCase();
  const groups = [
    ['Tasks','task',state.data.tasks,r => [r.title,r.description,r.phase]],
    ['Library','file',state.data.files,r => [r.original_name,r.user_notes,r.tags,r.citation_meta?.authors]],
    ['Notebook','note',state.data.notes,r => [r.body,r.author_name]]
  ];
  $('find-results').innerHTML = term ? groups.map(([label,kind,records,fields]) => {
    const rows = records.filter(r => fields(r).join(' ').toLowerCase().includes(term)).slice(0,12);
    return rows.length ? `<section><h3>${label}</h3><p>${rows.map(r => recordLink(kind,r.id)).join(' ')}</p></section>` : '';
  }).join('') || '<p>No matching records in the current workspace view.</p>' : '';
});

document.addEventListener('submit', async e => {
  const form = e.target;
  if (
    ![
      'login-form',
      'register-form',
      'accept-invite-form',
      'task-form',
      'note-form',
      'agent-form',
      'quick-form',
      'invite-form',
      'file-notes-form'
    ].includes(form.id)
  )
    return;
  e.preventDefault();
  const btn = form.querySelector('button[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (form.id === 'login-form') {
      const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      state.user = r.user;
      state.workspace = r.workspace;
      state.workspaces = r.workspaces || [];
      state.csrf = r.csrf;
      const b = await api('/bootstrap');
      state.aiEnabled = b.aiEnabled;
      showApp();
      await reload();
    }
    if (form.id === 'register-form') {
      const r = await api('/auth/register', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      state.user = r.user;
      state.workspace = r.workspace;
      state.workspaces = r.workspaces || [];
      state.csrf = r.csrf;
      const b = await api('/bootstrap');
      state.aiEnabled = b.aiEnabled;
      toast('Workspace created!');
      showApp();
      await reload();
    }
    if (form.id === 'accept-invite-form') {
      const invite = new URLSearchParams(location.search).get('token');
      const data = Object.fromEntries(new FormData(form));
      const r = await api('/auth/accept', { method: 'POST', body: { ...data, token: invite } });
      state.user = r.user;
      state.workspace = r.workspace;
      state.workspaces = r.workspaces || [];
      state.csrf = r.csrf;
      history.replaceState({}, '', '/');
      const b = await api('/bootstrap');
      state.aiEnabled = b.aiEnabled;
      toast('Joined workspace!');
      showApp();
      await reload();
    }
    if (form.id === 'task-form') await createTask(form);
    if (form.id === 'note-form') {
      const body = form.elements.body.value;
      await api('/notes', { method: 'POST', body: { body, sourceId: Number(form.elements.sourceId.value) || null, taskId: Number(form.elements.taskId.value) || null } });
      toast('Research note saved');
      await reload();
    }
    if (form.id === 'file-notes-form') {
      const fileId = form.dataset.fileId;
      const tags = form.elements.tags.value
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
      const reading_status = form.elements.reading_status.value;
      const project_phase = form.elements.project_phase.value;
      const user_notes = form.elements.user_notes.value;
      await api(`/files/${fileId}/metadata`, {
        method: 'PATCH',
        body: { tags, reading_status, project_phase, user_notes }
      });
      toast('Literature notes & tags saved');
      await reload({ quiet: true });
    }
    if (form.id === 'agent-form' || form.id === 'quick-form') {
      const msg = form.elements.message.value.trim();
      if (msg) await handleAgent(msg);
    }
    if (form.id === 'invite-form') {
      const email = form.elements.email.value;
      const r = await api('/auth/invite', { method: 'POST', body: { email } });
      const url = new URL(r.invitePath, location.origin).href;
      const el = $('invite-result');
      if (el)
        el.innerHTML = `<div class="hint" style="margin-top:13px">Invitation for <strong>${esc(email)}</strong> · expires in ${esc(r.expiresIn)}.<div class="code-box">${esc(url)}</div><button class="button secondary small" id="copy-invite" data-copy="${esc(url)}">Copy invitation link</button><p style="font-size:10px">Anyone with this link can claim the invitation for the specified email. Share it privately.</p></div>`;
      toast('Invitation link generated');
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.addEventListener('click', async e => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.id === 'browse-files') { $('file-input').click(); return; }
  if (el.id === 'open-finder') {
    const finder = $('find-records');
    finder.showModal();
    $('find-query').value = '';
    $('find-query').dispatchEvent(new Event('input',{bubbles:true}));
    $('find-query').focus();
    return;
  }
  if (el.dataset.record) {
    if ($('task-dialog').open) $('task-dialog').close();
    const id = Number(el.dataset.recordId);
    $('find-records')?.close();
    if (el.dataset.record === 'task') {
      goto('tasks');
      openTask(state.data.tasks.find(t => t.id === id));
    } else if (el.dataset.record === 'file') {
      state.activeReviewFileId = id;
      goto('files');
      $('file-summary')?.scrollIntoView({block:'start'});
    } else {
      goto('notes');
      $('note-' + id)?.focus();
    }
    return;
  }
  if (el.hasAttribute('data-auth-mode')) {
    state.authMode = el.dataset.authMode;
    authView();
    return;
  }
  if (el.hasAttribute('data-page')) {
    goto(el.dataset.page);
    return;
  }
  if (el.hasAttribute('data-go')) {
    goto(el.dataset.go);
    return;
  }
  if (el.hasAttribute('data-new-task')) {
    openTask();
    return;
  }
  if (el.hasAttribute('data-edit')) {
    openTask(state.data.tasks.find(t => t.id === Number(el.dataset.edit)));
    return;
  }
  if (el.hasAttribute('data-close-dialog')) {
    $('task-dialog').close();
    return;
  }
  if (el.hasAttribute('data-prompt')) {
    await handleAgent(el.dataset.prompt);
    return;
  }
  if (el.hasAttribute('data-copy')) {
    try {
      await navigator.clipboard.writeText(el.dataset.copy);
      toast('Invitation link copied');
    } catch {
      toast('Copy failed; select the link above', true);
    }
    return;
  }
  if (el.hasAttribute('data-lib-view')) {
    state.libView = el.dataset.libView;
    render();
    return;
  }

  try {
    if (el.id === 'logout') {
      await api('/auth/logout', { method: 'POST' });
      state.user = null;
      state.workspace = null;
      state.workspaces = [];
      state.csrf = null;
      state.messages = [];
      state.pendingActions = [];
      authView();
      return;
    }
    if (el.hasAttribute('data-complete')) {
      await api('/tasks/' + el.dataset.complete, { method: 'PATCH', body: { status: 'Done' } });
      toast('Task marked completed');
      await reload();
      return;
    }
    if (el.hasAttribute('data-delete-task')) {
      if (!confirm('Permanently delete this task?')) return;
      await api('/tasks/' + el.dataset.deleteTask, { method: 'DELETE' });
      toast('Task deleted');
      await reload();
      return;
    }
    if (el.hasAttribute('data-delete-note')) {
      if (!confirm('Delete this research note?')) return;
      await api('/notes/' + el.dataset.deleteNote, { method: 'DELETE' });
      toast('Note deleted');
      await reload();
      return;
    }
    if (el.hasAttribute('data-delete-file')) {
      if (!confirm('Permanently delete this uploaded file?')) return;
      await api('/files/' + el.dataset.deleteFile, { method: 'DELETE' });
      toast('File deleted');
      await reload();
      return;
    }
    if (el.hasAttribute('data-download')) {
      window.location.href = '/api/files/' + encodeURIComponent(el.dataset.download) + '/download';
      return;
    }
    if (el.hasAttribute('data-open-review')) {
      const fileId = Number(el.dataset.openReview);
      const file = state.data.files.find(x => x.id === fileId);
      state.activeReviewFileId = fileId;
      render();
      const slot = $('file-summary');
      if (slot) slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (el.hasAttribute('data-summarize')) {
      el.disabled = true;
      const force = el.dataset.force === '1';
      await runFileAnalysis(el.dataset.summarize, force);
      return;
    }
    if (el.hasAttribute('data-copy-bibtex')) {
      const f = state.data.files.find(x => x.id === Number(el.dataset.copyBibtex));
      if (f) {
        const bib = buildBibtexFallback(f);
        await navigator.clipboard.writeText(bib);
        toast('BibTeX citation copied to clipboard');
      }
      return;
    }
    if (el.hasAttribute('data-send-to-notebook')) {
      const f = state.data.files.find(x => x.id === Number(el.dataset.sendToNotebook));
      if (f) {
        const rev = f.ai_review_data;
        const body = rev
          ? `Literature Review — ${f.original_name}\n\nObjective: ${rev.objective || '—'}\n\nMethodology: ${rev.methodology || '—'}\n\nEvidence & Concepts: ${rev.governing_equations_and_params || '—'}\n\nKey Findings: ${rev.key_findings || '—'}${f.user_notes ? `\n\nNotes: ${f.user_notes}` : ''}`
          : `Literature Notes — ${f.original_name}\n\n${f.user_notes || 'Added from Research Library.'}`;
        await api('/notes', { method: 'POST', body: { body: body.slice(0, 10000), sourceId: f.id } });
        toast('Sent to Research Notebook');
        await reload({ quiet: true });
      }
      return;
    }
    if (el.hasAttribute('data-task-from-file')) {
      const f = state.data.files.find(x => x.id === Number(el.dataset.taskFromFile));
      if (f) {
        openTask({
          title: `Review ${f.original_name}`,
          description: f.ai_review_data?.limitations_and_gaps || '',
          source_ids: [f.id],
          phase: f.project_phase || 'Literature review',
          status: 'To do',
          priority: 'Medium'
        });
      }
      return;
    }
    if (el.id === 'compare-selected-btn') {
      if (state.selectedFiles.length < 2) return;
      el.disabled = true;
      const res = await api('/files/compare', { method: 'POST', body: { fileIds: state.selectedFiles } });
      state.comparisonPapers = res.papers || [];
      render();
      const panel = $('comparison-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (el.id === 'clear-selected-btn') {
      state.selectedFiles = [];
      state.comparisonPapers = null;
      render();
      return;
    }
    if (el.id === 'close-comparison') {
      state.comparisonPapers = null;
      render();
      return;
    }
    if (el.id === 'dismiss-summary') {
      state.activeReviewFileId = null;
      render();
      return;
    }
    if (el.id === 'discard-actions') {
      state.pendingActions = [];
      render();
      return;
    }
    if (el.id === 'confirm-actions') {
      if (state.busy) return;
      state.busy = true;
      await api('/agent/apply', { method: 'POST', body: { actions: state.pendingActions } });
      state.messages.push({ role: 'assistant', text: 'Confirmed. Your approved changes were saved to the shared workspace.' });
      state.pendingActions = [];
      state.busy = false;
      toast('Research workspace updated');
      await reload();
      return;
    }
    if (el.id === 'save-task') {
      const form = $('task-form');
      if (!form.reportValidity()) return;
      el.disabled = true;
      try {
        await createTask(form);
      } catch (err) {
        toast(err.message, true);
      } finally {
        el.disabled = false;
      }
      return;
    }
  } catch (error) {
    state.busy = false;
    toast(error.message, true);
    if (el.hasAttribute('data-summarize') || el.id === 'compare-selected-btn') el.disabled = false;
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'task-search') {
    state.search = e.target.value;
    $('task-table-target').innerHTML = boardContent();
    $('task-count').textContent = '(' + filteredTasks().length + ' of ' + state.data.tasks.length + ')';
  }
  if (e.target.id === 'lib-search') {
    state.libSearch = e.target.value;
    const shown = filteredFiles();
    $('lib-files-target').innerHTML = renderFileListOrMatrix(shown);
    $('lib-count').textContent = '(' + shown.length + ' of ' + state.data.files.length + ')';
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'workspace-switcher') {
    if (t.value === '__new__') {
      const name = prompt('Enter a name for your new research workspace:');
      if (!name || !name.trim()) {
        renderWorkspaceHeader();
        return;
      }
      try {
        const res = await api('/workspaces', { method: 'POST', body: { name: name.trim() } });
        state.workspace = res.workspace;
        state.workspaces = res.workspaces;
        state.activeReviewFileId = null;
        state.selectedFiles = [];
        state.comparisonPapers = null;
        toast(`Switched to "${res.workspace.name}"`);
        showApp();
        await reload();
      } catch (err) {
        toast(err.message, true);
        renderWorkspaceHeader();
      }
      return;
    }
    try {
      const res = await api('/workspaces/switch', { method: 'POST', body: { workspaceId: Number(t.value) } });
      state.workspace = res.workspace;
      state.workspaces = res.workspaces;
      state.activeReviewFileId = null;
      state.selectedFiles = [];
      state.comparisonPapers = null;
      toast(`Switched to "${res.workspace.name}"`);
      showApp();
      await reload();
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (t.id === 'status-filter') {
    state.filter = t.value;
    render();
    return;
  }
  if (t.id === 'phase-filter') {
    state.phaseFilter = t.value;
    render();
    return;
  }
  if (t.id === 'lib-status-filter') {
    state.libStatusFilter = t.value;
    render();
    return;
  }
  if (t.id === 'lib-phase-filter') {
    state.libPhaseFilter = t.value;
    render();
    return;
  }
  if (t.id === 'file-input' && t.files?.length) {
    const files = Array.from(t.files);
    t.value = '';
    uploadFiles(files);
    return;
  }
  if (t.id === 'select-all-files') {
    const shownIds = filteredFiles().map(f => f.id);
    state.selectedFiles = t.checked ? shownIds : [];
    render();
    return;
  }
  if (t.hasAttribute('data-select-file')) {
    const id = Number(t.dataset.selectFile);
    if (t.checked) {
      if (!state.selectedFiles.includes(id)) state.selectedFiles.push(id);
    } else {
      state.selectedFiles = state.selectedFiles.filter(x => x !== id);
    }
    render();
    return;
  }
  if (t.hasAttribute('data-file-status')) {
    const id = t.dataset.fileStatus;
    try {
      await api(`/files/${id}/metadata`, { method: 'PATCH', body: { reading_status: t.value } });
      toast(`Status updated to ${t.value}`);
      await reload({ quiet: true });
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (t.hasAttribute('data-file-phase')) {
    const id = t.dataset.filePhase;
    try {
      await api(`/files/${id}/metadata`, { method: 'PATCH', body: { project_phase: t.value } });
      toast(`Assigned to ${t.value} phase`);
      await reload({ quiet: true });
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
});

const drop = $('workspace');
drop.addEventListener('dragover', e => {
  const target = e.target.closest('#drop-zone');
  if (target) {
    e.preventDefault();
    target.classList.add('dragover');
  }
});
drop.addEventListener('dragleave', e => {
  const target = e.target.closest('#drop-zone');
  if (target) target.classList.remove('dragover');
});
drop.addEventListener('drop', e => {
  const target = e.target.closest('#drop-zone');
  if (target) {
    e.preventDefault();
    target.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  }
});


let boardView='Board', selectedTasks=new Set(), undoStack=[],redoStack=[],activeWorkspace=null;
let live=null, liveKey='', liveTimer, busyMutation=false;
const taskById=id=>state.data.tasks.find(t=>t.id===Number(id));
const localDay=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const today=()=>localDay(new Date());
const dayMs=86400000;
const shiftDate=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*dayMs).toISOString().slice(0,10);
const options=vals=>vals.map(v=>'<option>'+esc(v)+'</option>').join('');
function closeLive(){live?.close();live=null;liveKey='';clearTimeout(liveTimer);$('presence')?.replaceChildren();}
function connectLive(){
  if(!state.user||!state.workspace) return;
  const w=state.workspace.id;
  if(activeWorkspace!==w){
    activeWorkspace=w; selectedTasks.clear(); undoStack=[];redoStack=[];state.messages=[];state.pendingActions=[];
  }
  const task=$('task-dialog').open && taskById($('task-form').elements.id.value);
  const view=task?'Editing '+task.title:({tasks:'Task board',notes:'Research notebook',files:'Research library',activity:'Activity timeline',agent:'AI agent',overview:'Overview',team:'Team'}[state.page]);
  const key=w+'|'+view;
  if(key===liveKey)return;
  closeLive();liveKey=key;
  live=new EventSource('/api/live?'+new URLSearchParams({workspace:w,view}));
  live.addEventListener('presence',e=>{
    const peers=JSON.parse(e.data);
    $('presence').textContent=peers.map(p=>p.name+' · '+p.view).join('  /  ');
  });
  live.onerror=()=>{$('presence').textContent='Reconnecting…';};
  live.addEventListener('change',()=>{
    clearTimeout(liveTimer);
    liveTimer=setTimeout(()=>{
      if(!busyMutation&&!state.busy&&!$('task-dialog').open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&['tasks','overview','activity','team'].includes(state.page))reload({quiet:true});
    },250);
  });
}
$('task-dialog').addEventListener('close',connectLive);
function pick(t){return '<input type="checkbox" aria-label="Select '+esc(t.title)+'" data-pick="'+t.id+'" '+(selectedTasks.has(t.id)?'checked':'')+'>';}
function boardTools(){
  return '<div class="rf-tools">'+['Board','Table','Schedule'].map(v=>'<button class="button secondary" aria-pressed="'+(boardView===v)+'" data-board="'+v+'">'+v+'</button>').join('')+
    '<button class="button secondary" data-history="undo" '+(!undoStack.length?'disabled':'')+'>Undo</button><button class="button secondary" data-history="redo" '+(!redoStack.length?'disabled':'')+'>Redo</button><button class="button secondary" data-export="CSV">Export CSV</button></div><div id="bulk-tools">'+bulkTools()+'</div>';
}
function bulkTools(){
  if(!selectedTasks.size)return '';
  return '<div class="rf-tools"><strong>'+selectedTasks.size+' selected</strong><label>Action <select id="batch-kind">'+options(['Set status','Assign','Research phase','Shift dates'])+'</select></label><span id="batch-options">'+bulkOptions('Set status')+'</span><button class="button solid" data-batch>Apply</button><button class="tiny-btn" data-clear-picks>Clear</button></div>';
}
function bulkOptions(kind){
  if(kind==='Shift dates')return '<input id="batch-value" aria-label="Shift by days" type="number" value="1" min="-3650" max="3650">';
  return '<select aria-label="New value" id="batch-value">'+(kind==='Assign'?recordOptions(state.data.members,'name'):options(kind==='Research phase'?phases:statuses))+'</select>';
}
function boardContent(){
  const rows=filteredTasks();
  if(boardView==='Table')return table(rows);
  if(boardView==='Schedule')return schedule(rows);
  return '<div class="rf-board">'+statuses.map((s,i)=>{
    const cards=rows.filter(t=>t.status===s),cap=state.data.limits?.find(l=>l.status===s)?.capacity;
    return '<section class="rf-lane lane-'+i+'" data-lane="'+s+'"><header><strong>'+s+'</strong><button class="tiny-btn" data-limit="'+s+'" title="Set work-in-progress limit">'+cards.length+(cap?' / '+cap:' · ∞')+'</button></header>'+cards.map(t=>'<article draggable="true" data-drag="'+t.id+'" class="rf-card"><div>'+pick(t)+' <small>'+esc(t.phase)+'</small></div><button class="text-link" data-edit="'+t.id+'">'+esc(t.title)+'</button><small>'+esc(t.assignee_name||'Unassigned')+' · '+esc(t.due_date||'No due date')+'</small><select class="field" data-card-status="'+t.id+'" aria-label="Move '+esc(t.title)+'">'+statuses.map(v=>'<option '+(v===t.status?'selected':'')+'>'+v+'</option>').join('')+'</select></article>').join('')+'</section>';
  }).join('')+'</div>';
}
function schedule(rows){
  const dates=rows.flatMap(t=>[t.start_date,t.due_date]).filter(Boolean).sort();
  const first=dates[0]||today(), last=dates.at(-1)||first;
  const days=Math.max(7,Math.round((Date.parse(last)-Date.parse(first))/dayMs)+3);
  return '<p>'+first+' — '+shiftDate(first,days-1)+'</p>'+rows.map(t=>{
    const start=t.start_date||t.due_date,end=t.due_date||start;
    const left=start?100*(Date.parse(start)-Date.parse(first))/dayMs/days:0;
    const width=start?100*((Date.parse(end)-Date.parse(start))/dayMs+1)/days:0;
    return '<div class="rf-schedule">'+pick(t)+'<button class="text-link" data-edit="'+t.id+'">'+esc(t.title)+'</button><div class="rf-track" data-days="'+days+'">'+(start?'<button class="rf-bar" data-bar="'+t.id+'" title="'+start+' to '+end+'" style="left:'+left+'%;width:'+width+'%"><span data-edge="start">‹</span><span data-edge="end">›</span></button>':'Unscheduled')+'</div><button class="tiny-btn" data-dates="'+t.id+'">Dates</button></div>';
  }).join('');
}
function detailPanel(t){
  const deps=state.data.dependencies||[], comments=(state.data.comments||[]).filter(c=>c.task_id===t.id), runs=(state.data.runs||[]).filter(r=>r.task_id===t.id);
  const text=(label,key)=>'<label>'+label+'<input class="field" data-run-field="'+key+'"></label>';
  return '<section class="rf-detail"><h3>Dependencies</h3>'+deps.filter(d=>d.successor===t.id).map(d=>'Blocked by '+recordLink('task',d.predecessor)+' <button type="button" data-unlink="'+d.predecessor+'">Remove</button>').join(' ')+deps.filter(d=>d.predecessor===t.id).map(d=>' Blocks '+recordLink('task',d.successor)).join(' ')+
    '<label>Preceding task<select class="field" id="predecessor">'+recordOptions(state.data.tasks.filter(x=>x.id!==t.id),'title')+'</select></label><button type="button" class="tiny-btn" data-detail="dependency">Link dependency</button><h3>Discussion</h3>'+comments.map(c=>'<p><b>'+esc(c.name)+'</b> '+esc(c.body)+'</p>').join('')+'<textarea aria-label="Comment" class="field" id="new-comment"></textarea><button type="button" class="tiny-btn" data-detail="comment">Post comment</button>'+
    (['Analytical','Numerical'].includes(t.phase)?'<details><summary>Experiment runs ('+runs.length+')</summary><div class="task-table-wrap"><table class="task-table"><tr>'+['Run','Parameters','Mesh','Time step','Solver','Convergence','Output'].map(x=>'<th>'+x+'</th>').join('')+'</tr>'+runs.map((r,i)=>'<tr>'+['label','parameters','mesh','time_step','solver_status','convergence'].map(k=>'<td class="'+(i&&runs[i-1][k]!==r[k]?'rf-diff':'')+'">'+esc(r[k])+'</td>').join('')+'<td>'+recordLink('file',r.output_id)+'</td></tr>').join('')+'</table></div><div class="form-grid">'+[['Run name','label'],['Parameters','parameters'],['Mesh','mesh'],['Time step','timeStep'],['Solver status','status'],['Convergence','convergence']].map(a=>text(...a)).join('')+'<label>Output<select id="run-output">'+recordOptions(state.data.files,'original_name')+'</select></label></div><button type="button" class="tiny-btn" data-detail="run">Log run</button></details>':'')+
    '<h3>Ask the research agent</h3>'+['Propose subtasks','Summarize discussion','Draft a literature review paragraph','Detect conflicting findings'].map(a=>'<button type="button" class="tiny-btn" data-task-ai="'+esc(a)+'">'+esc(a)+'</button>').join(' ')+'</section>';
}
async function batch(items,history='normal'){
  if(busyMutation||!items.length)return;
  busyMutation=true;
  const inverse=[], keys={dueDate:'due_date',startDate:'start_date',assigneeId:'assignee_id'};
  try {
    for(const i of items){
      const t=taskById(i.id);
      if(!t||t.revision!==i.revision)throw Error('Task changed. Review its current version.');
      const before={};
      for(const [field,value] of Object.entries(i.changes)){
        const key=keys[field]||field;
        before[field]=t[key]??null;t[key]=value;
      }
      inverse.push({id:t.id,changes:before});
    }
    render();
    const saved=await api('/board/batch',{method:'POST',body:{items}});
    inverse.forEach((i,n)=>i.revision=saved[n].revision);
    // Rebase the next local history entry only after a successful revision check.
    const pending=history==='undo'?undoStack.slice(0,-1):history==='redo'?redoStack.slice(0,-1):[];
    for(const row of saved){
      const next=pending.flat().findLast(entry=>entry.id===row.id);
      if(next)next.revision=row.revision;
    }
    if(history==='undo'){undoStack.pop();redoStack.push(inverse);}
    else {if(history==='redo')redoStack.pop();else redoStack=[];undoStack.push(inverse);}
    toast(history==='undo'?'Change undone':'Changes saved');
  }catch(e){
    for(const i of inverse)for(const [k,v] of Object.entries(i.changes))taskById(i.id)[keys[k]||k]=v;
    toast(e.message,true);
  }finally{render();await reload({quiet:true});busyMutation=false;}
}
const changeItem=(t,changes)=>({id:t.id,revision:t.revision,changes});
document.addEventListener('dragstart',e=>{const card=e.target.closest('[data-drag]');if(card)e.dataTransfer.setData('text/task',card.dataset.drag);});
document.addEventListener('dragover',e=>{if(e.target.closest('[data-lane]'))e.preventDefault();});
document.addEventListener('drop',e=>{
  const lane=e.target.closest('[data-lane]');if(!lane)return;
  e.preventDefault();const t=taskById(e.dataTransfer.getData('text/task'));
  if(t&&t.status!==lane.dataset.lane)batch([changeItem(t,{status:lane.dataset.lane})]);
});
document.addEventListener('pointerdown',e=>{
  const bar=e.target.closest('[data-bar]');if(!bar)return;
  const x=e.clientX,track=bar.parentElement,edge=e.target.dataset.edge,t=taskById(bar.dataset.bar);
  bar.setPointerCapture(e.pointerId);
  bar.onpointermove=ev=>{bar.style.transform='translateX('+(ev.clientX-x)+'px)';};
  bar.onpointercancel=()=>{bar.style.transform='';bar.onpointermove=null;};
  bar.onpointerup=ev=>{
    bar.onpointermove=null;bar.style.transform='';
    const days=Math.round((ev.clientX-x)/track.clientWidth*Number(track.dataset.days));
    if(!days)return;
    const start=t.start_date||t.due_date,end=t.due_date||start;
    batch([changeItem(t,{startDate:shiftDate(start,edge==='end'?0:days),dueDate:shiftDate(end,edge==='start'?0:days)})]);
  };
});
function downloadText(filename,body,type){
  const url=URL.createObjectURL(new Blob([body],{type}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportReport(format){
  const rows=state.page==='tasks'?filteredTasks().filter(t=>!selectedTasks.size||selectedTasks.has(t.id)):state.data.tasks;
  if(format==='PDF'){window.print();return;}
  if(format==='BibTeX'){downloadText('references.bib',state.data.files.map(buildBibtexFallback).join('\n\n'),'text/plain');return;}
  if(format==='Markdown'){downloadText('research-report.md','# '+state.workspace.name+'\n\n'+rows.map(t=>'- ['+(t.status==='Done'?'x':' ')+'] '+t.title+' — '+t.phase+' · '+t.status+' · '+(t.due_date||'Unscheduled')).join('\n'),'text/markdown');return;}
  const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  downloadText('research-tasks.csv',[['Title','Phase','Status','Assignee','Due'],...rows.map(t=>[t.title,t.phase,t.status,t.assignee_name,t.due_date])].map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv');
}
function overviewAnalytics(){
  const rows=state.data.tasks;
  const bar=(label,list,attr)=>'<button class="rf-metric" '+attr+'><b>'+esc(label)+'</b><span class="rf-stack">'+statuses.map((s,i)=>'<i class="lane-'+i+'" style="width:'+(100*list.filter(t=>t.status===s).length/list.length)+'%"></i>').join('')+'</span><span>'+list.filter(t=>t.status==='Done').length+'/'+list.length+' done</span></button>';
  return '<section class="card panel section-spacer"><h2>Research progress</h2>'+phases.filter(p=>rows.some(t=>t.phase===p)).map(p=>bar(p,rows.filter(t=>t.phase===p),'data-phase-drill="'+esc(p)+'"')).join('')+'<h3>Team workload</h3>'+state.data.members.map(m=>'<button class="tiny-btn" data-workload="'+m.id+'">'+esc(m.name)+' · '+rows.filter(t=>t.assignee_id===m.id&&t.status!=='Done').length+' open</button>').join(' ')+'<details><summary>Relationship graph</summary>'+graphView()+'</details><div class="rf-tools">'+['Markdown','CSV','PDF','BibTeX'].map(f=>'<button class="tiny-btn" data-export="'+f+'">'+f+'</button>').join('')+'</div></section>';
}
function graphView(){
  const {tasks,files,notes,runs=[],dependencies=[]}=state.data;
  const groups=[tasks.map(t=>['task',t.id,t.title]),files.map(f=>['file',f.id,f.original_name]),notes.map(n=>['note',n.id,n.body]),runs.map(r=>['run',r.id,r.label,r.task_id])];
  const points=new Map(),edges=[];
  groups.forEach((nodes,i)=>nodes.forEach(([kind,id],j)=>points.set(kind+id,[95+i*190,30+j*56])));
  function edge(a,b){const from=points.get(a),to=points.get(b);if(from&&to)edges.push('<path d="M'+from.join(' ')+' Q'+(from[0]+50)+' '+((from[1]+to[1])/2)+' '+to.join(' ')+'"/>');}
  tasks.forEach(t=>t.source_ids?.forEach(id=>edge('task'+t.id,'file'+id)));
  notes.forEach(n=>{edge('note'+n.id,'task'+n.task_id);edge('note'+n.id,'file'+n.source_id);});
  runs.forEach(r=>{edge('run'+r.id,'task'+r.task_id);edge('run'+r.id,'file'+r.output_id);});
  dependencies.forEach(d=>edge('task'+d.predecessor,'task'+d.successor));
  const h=Math.max(1,...groups.map(g=>g.length))*56+12;
  return '<div class="rf-graph"><div style="width:760px;height:'+h+'px"><svg aria-hidden="true" width="760" height="'+h+'">'+edges.join('')+'</svg>'+groups.flat().map(([kind,id,label,parent])=>{
    const [x,y]=points.get(kind+id);
    return '<button class="tiny-btn" data-record="'+(parent?'task':kind)+'" data-record-id="'+(parent||id)+'" title="'+esc(label)+'" style="left:'+(x-73)+'px;top:'+(y-15)+'px">'+kind+' · '+esc(label.slice(0,40))+'</button>';
  }).join('')+'</div></div>';
}
document.addEventListener('change',e=>{
  if(e.target.dataset.cardStatus){const t=taskById(e.target.dataset.cardStatus);if(t)batch([changeItem(t,{status:e.target.value})]);}
  if(e.target.dataset.pick){const id=Number(e.target.dataset.pick);if(e.target.checked)selectedTasks.add(id);else selectedTasks.delete(id);$('bulk-tools').innerHTML=bulkTools();}
  if(e.target.id==='batch-kind')$('batch-options').innerHTML=bulkOptions(e.target.value);
});
document.addEventListener('click',async e=>{
  const el=e.target.closest('button');if(!el)return;
  const d=el.dataset;
  try{
    if(d.board){boardView=d.board;render();}
    if(d.export)exportReport(d.export);
    if(d.clearPicks!==undefined){selectedTasks.clear();render();}
    if(d.limit){const input=prompt('Maximum tasks in '+d.limit+' (0 for unlimited)',state.data.limits.find(l=>l.status===d.limit)?.capacity||0);if(input!==null){await api('/board/limit',{method:'POST',body:{status:d.limit,capacity:Number(input)}});await reload();}}
    if(d.batch!==undefined){
      const kind=$('batch-kind').value,val=$('batch-value').value;
      const items=state.data.tasks.filter(t=>selectedTasks.has(t.id)).map(t=>{
        if(kind==='Shift dates'){
          if(!Number.isInteger(Number(val))||Math.abs(val)>3650)throw Error('Enter a whole number of days within 3650');
          if(!t.due_date)throw Error('Set a due date for '+t.title+' before shifting it');
          return changeItem(t,{dueDate:shiftDate(t.due_date,Number(val)),startDate:t.start_date?shiftDate(t.start_date,Number(val)):null});
        }
        return changeItem(t,kind==='Assign'?{assigneeId:Number(val)||null}:kind==='Research phase'?{phase:val}:{status:val});
      });await batch(items);
    }
    if(d.history){const items=(d.history==='undo'?undoStack:redoStack).at(-1);if(items)await batch(items,d.history);}
    if(d.dates){const t=taskById(d.dates),start=prompt('Start date (YYYY-MM-DD)',t.start_date||t.due_date||today());if(!start)return;const end=prompt('Due date (YYYY-MM-DD)',t.due_date||start);if(end)await batch([changeItem(t,{startDate:start,dueDate:end})]);}
    if(d.detail||d.unlink){
      const id=Number($('task-form').elements.id.value),kind=d.detail||'unlink',body={kind};
      if(kind==='dependency'||kind==='unlink')body.predecessor=Number(d.unlink||$('predecessor').value);
      if(kind==='comment')body.body=$('new-comment').value;
      if(kind==='run'){document.querySelectorAll('[data-run-field]').forEach(f=>body[f.dataset.runField]=f.value);body.outputId=Number($('run-output').value)||null;}
      await api('/tasks/'+id+'/detail',{method:'POST',body});await reload();
      document.querySelector('.rf-detail').outerHTML=detailPanel(taskById(id));toast('Saved');
    }
    if(d.taskAi){const t=taskById($('task-form').elements.id.value);$('task-dialog').close();goto('agent');await handleAgent(d.taskAi+' for task '+t.id+' “'+t.title+'” using its linked records.');}
    if(d.phaseDrill||d.workload){state.filter='All';state.phaseFilter=d.phaseDrill||'All';state.search=d.workload?state.data.members.find(m=>m.id===Number(d.workload)).name:'';goto('tasks');}
    if(d.command){$('find-records').close();if(d.command==='create')openTask();else goto(d.command);}
  }catch(error){toast(error.message,true);}
});
document.addEventListener('input',e=>{
  if(e.target.id!=='find-query')return;
  const term=e.target.value.toLowerCase();
  const commands={create:'Create a task',overview:'Overview',tasks:'Task board',files:'Research library',notes:'Research notebook',agent:'Ask the AI research agent',activity:'Activity timeline',team:'Team'};
  $('find-results').insertAdjacentHTML('afterbegin',Object.entries(commands).filter(([,v])=>v.toLowerCase().includes(term)).map(([k,v])=>'<button class="tiny-btn" data-command="'+k+'">'+v+'</button>').join(' '));
});
document.addEventListener('keydown',e=>{
  if(!state.user)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!$('task-dialog').open){e.preventDefault();$('open-finder').click();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!document.querySelector('dialog[open]')&&!e.target.closest('input,select,textarea,[contenteditable]')){
    const items=(e.shiftKey?redoStack:undoStack).at(-1);
    if(items){e.preventDefault();batch(items,e.shiftKey?'redo':'undo');}
  }
  if($('find-records').open&&['ArrowDown','ArrowUp','Enter'].includes(e.key)){
    const list=[...$('find-results').querySelectorAll('button')];if(!list.length)return;
    const idx=list.indexOf(document.activeElement);
    if(e.key==='Enter'&&idx===-1){e.preventDefault();list[0].click();}
    if(e.key!=='Enter'){e.preventDefault();list[(idx+(e.key==='ArrowDown'?1:-1)+list.length)%list.length].focus();}
  }
});
const boardStyles=document.createElement('style');
boardStyles.textContent=".rf-tools,.rf-lane header,.rf-schedule,.rf-metric{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}.rf-tools{margin:0 0 1rem}.rf-tools [aria-pressed=true]{background:#243c38;color:white}.rf-board{display:grid;grid-template-columns:repeat(4,minmax(165px,1fr));gap:12px;overflow:auto;padding-bottom:8px}.rf-lane{background:#f5f7f6;border-radius:10px;border-top:3px solid var(--lane);padding:10px;min-height:180px}.lane-0{--lane:#8793a5}.lane-1{--lane:#c88b3c}.lane-2{--lane:#c16a6a}.lane-3{--lane:#389480}.rf-lane header{justify-content:space-between;margin-bottom:12px}.rf-card{display:grid;gap:10px;background:white;border:1px solid #d8dfdb;border-radius:8px;padding:12px;margin:8px 0;cursor:grab}.rf-card button{text-align:left}.rf-card small,.rf-presence{color:#47665c}.rf-presence{max-width:23vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem}.rf-detail{display:grid;gap:8px}.rf-detail h3{margin:12px 0 0}.rf-diff{background:#fcf1cb}.rf-schedule{flex-wrap:nowrap;padding:8px;border-bottom:1px solid #ddd}.rf-schedule>.text-link{width:20%;text-align:left}.rf-track{position:relative;height:32px;flex:1;background:#edf2ef;border-radius:5px}.rf-bar{position:absolute;top:3px;height:26px;min-width:20px;border:0;border-radius:5px;background:#35776c;color:white;display:flex;justify-content:space-between;align-items:center;touch-action:none;cursor:grab}.rf-bar span{cursor:ew-resize}.rf-metric{width:100%;background:none;border:0;padding:8px;text-align:left}.rf-metric b{width:130px}.rf-stack{display:flex;flex:1;height:10px;overflow:hidden;border-radius:5px}.rf-stack i{background:var(--lane)}.rf-graph{overflow:auto;max-height:480px}.rf-graph>div{position:relative}.rf-graph svg{position:absolute;inset:0;stroke:#89a89c;fill:none}.rf-graph button{position:absolute;width:146px;height:30px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:white}.rf-detail table{font-size:.8rem}#task-dialog{max-height:94dvh;overflow:auto}button:focus-visible,input:focus-visible{outline:3px solid #24847a;outline-offset:2px}@media print{.sidebar,.topbar,.mobile-nav,.rf-tools,.agent-feature{display:none!important}.app-area{margin:0!important}}@media(max-width:700px){.rf-presence{max-width:22vw}.rf-board{grid-template-columns:repeat(4,75vw)}#task-dialog{width:100%;max-width:100%;margin:auto 0 0;max-height:95dvh}}\n";
document.head.append(boardStyles);
const presenceLabel=document.createElement('span');
presenceLabel.id='presence';presenceLabel.className='rf-presence';
$('sync-status').before(presenceLabel);
boot();
