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
    $('content').removeAttribute('aria-busy');
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
  const pill = document.querySelector('.workspace-pill,.workspace-switch');
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
  if(!state.data.tasks.length&&!state.data.files.length&&state.page==='overview')$('content').setAttribute('aria-busy','true');
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
    analysis: 'Data analysis',
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
      analysis: analysisPage,
      activity: activityPage,
      team: teamPage
    }[state.page] || overviewPage
  )();
  if(state.page==='analysis') drawAnalysis();
  if(state.workspace?.role==='viewer'){
    for(const el of $('content').querySelectorAll('[data-new-task],[data-delete-task],[data-delete-note],[data-delete-file],[data-complete],[data-member-role],[data-add-block],[data-card-status],[data-limit],[data-batch],#save-task,#confirm-actions,#browse-files,#import-reference,#note-form button[type=submit]'))el.disabled=true;
  }
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

let nextWorkScope = 'mine';

function nextWorkPanel() {
  const mine = nextWorkScope === 'mine';
  const tasks = state.data.tasks.filter(t => t.status !== 'Done' &&
    (!mine || String(t.assignee_id) === String(state.user.id)));
  tasks.sort((a,b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) ||
    (a.title || '').localeCompare(b.title || ''));
  const controls = '<div role="group" aria-label="Task scope">'+
    [['mine','My work'],['team','Team work']].map(([key,label]) =>
      '<button type="button" class="tiny-btn" data-next-work="'+key+'" aria-pressed="'+(key===nextWorkScope)+'">'+label+'</button>').join(' ')+'</div>';
  const rows = tasks.map(t => {
    const sources = (t.source_ids || []).map(id => recordLink('file',id)).filter(Boolean).join(' ');
    return '<tr><th scope="row"><button class="text-link" data-edit="'+Number(t.id)+'">'+esc(t.title)+'</button></th>'+
      '<td>'+esc(t.phase || '—')+'</td><td>'+esc(t.assignee_name || 'Unassigned')+'</td>'+
      '<td>'+esc(t.due_date ? shortDate(t.due_date+'T12:00:00') : 'No due date')+'</td>'+
      '<td>'+statusPill(t.status)+'</td><td>'+sources+relatedNotes('task_id',t.id)+'</td></tr>';
  });
  const body = rows.length ? '<div class="task-table-wrap"><table class="task-table"><thead><tr>'+
    ['Task','Phase','Owner','Due','Status','Linked research'].map(label => '<th scope="col">'+label+'</th>').join('')+
    '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>' :
    '<p>'+(mine?'You have no assigned open tasks. Choose Team work to see the workspace queue.':'The team has no open tasks.')+'</p>';
  return '<section class="card panel section-spacer"><div class="panel-heading"><h2>My next work</h2>'+controls+
    '</div>'+body+'<button class="text-link" data-go="tasks">Open task board ↗</button></section>';
}

document.addEventListener('click',event => {
  const control = event.target.closest('[data-next-work]');
  if (!control || state.page !== 'overview') return;
  nextWorkScope = control.dataset.nextWork === 'team' ? 'team' : 'mine';
  render();
  document.querySelector('[data-next-work="'+nextWorkScope+'"]')?.focus();
});

function overviewPage() {
  const tasks = state.data.tasks,
    done = tasks.filter(t => t.status === 'Done').length,
    active = tasks.filter(t => t.status === 'In progress').length,
    blocked = tasks.filter(t => t.status === 'Blocked').length,
    percent = tasks.length ? Math.round((100 * done) / tasks.length) : 0;
  const f = state.data.files;
  const wsName = state.workspace?.name || 'Shared research workspace';
  return `${pageHeading(esc(wsName.toUpperCase()) + ' · ' + new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase(), 'Good to see you, ' + state.user.name.split(' ')[0] + '.', 'Here is the current state of your shared research workspace.', `<button class="button secondary" data-go="team">↗ Invite / team</button>`)}
 <nav class="rf-tools" aria-label="Quick actions"><strong>Quick actions</strong><button class="tiny-btn" data-new-task>New task</button><button class="tiny-btn" data-overview-action="source">Add source</button><button class="tiny-btn" data-overview-action="note">New note</button><button class="tiny-btn" data-go="analysis">Start analysis</button></nav>${nextWorkPanel()}${continuePanel()}${upcomingPanel()}
 <section class="card panel section-spacer"><div class="panel-heading"><h2>Task completion</h2><button class="text-link" data-go="tasks">View task board</button></div><p><strong>${done} of ${tasks.length} tasks complete</strong> · ${percent}%</p><progress aria-label="Completed tasks" max="${tasks.length||1}" value="${done}"></progress></section><div class="section-spacer"> <section class="agent-feature"><div class="eyebrow">✧ RESEARCH COPILOT</div><h3>Update work in seconds.</h3><p>Tell the agent what you accomplished. Review its proposed updates and apply them with one click.</p><form id="quick-form" class="agent-inline"><input name="message" placeholder="e.g. Completed literature synthesis for Section 2" required /><button type="submit">Send ↗</button></form><div class="suggestions"><button data-overview-action="summary">Summarise recent changes</button><button data-overview-action="sources">Sources for my next task</button><button data-prompt="Add task: Compare two primary sources">＋ Add reading task</button></div></section></div>
 ${overviewAnalytics()}<div class="section-spacer"><section class="card panel"><div class="panel-heading">Latest activity <button class="text-link" data-go="activity">View timeline ↗</button></div>${handoverActivity()}</section></div>`;
}

function filteredTasks() {
  let arr = state.data.tasks;
  if(assigneeFilter!==null)arr=arr.filter(t=>(t.assignee_id||0)===assigneeFilter);
  if(dueFilter)arr=arr.filter(t=>t.status!=='Done'&&t.due_date&&t.due_date<today());
  if(openOnly)arr=arr.filter(t=>t.status!=='Done');
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
          ${dimensions().map(k=>'<th>'+esc(k)+'</th>').join('')}
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
              ${dimensions().map(k=>'<td><button class="text-link" data-dimension="'+f.id+'" data-key="'+esc(k)+'">'+esc(cit.dimensions?.[k]||'Add value')+'</button></td>').join('')}
              <td>
                <div class="inline-actions" style="flex-wrap:wrap">
                  <button class="tiny-btn" data-new-dimension="${f.id}">Add dimension</button>
                  <button class="tiny-btn" data-open-review="${f.id}">${rev ? '✧ Review' : '✧ Analyze'}</button>
                  <button class="tiny-btn" data-copy-bibtex="${f.id}" title="Copy BibTeX">📋 BibTeX</button>
                  ${labFileButton(f)} <button class="tiny-btn" data-download="${f.id}" title="Download">↓</button>
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
          ${labFileButton(f)} <button class="button secondary small" data-download="${f.id}">↓ Download</button>
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
    <button class="button secondary" data-preview="${f.id}">Open source preview</button>
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
  <div class="rf-tools"><label>DOI or arXiv ID <input class="field" id="source-identifier" placeholder="10.… or arXiv:…"></label><button class="button secondary" id="import-reference">Import reference</button></div>
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
  const rows = state.data.notes.filter(n => n[key] === id || n[key==='source_id'?'source_ids':'task_ids']?.includes(id));
  return rows.length ? `<p><strong>Notebook</strong> ${rows.map(n => recordLink('note',n.id)).join(' ')}</p>` : '';
}

function recordHistory(kind, id) {
  const rows = state.data.activities.filter(a => a.record_kind === kind && a.record_id === id);
  return rows.length ? `<details><summary>Recent activity (${rows.length})</summary>${rows.map(a => `<p>${timeDate(a.created_at)} · ${esc(a.actor_name)} · ${esc(a.description)}</p>`).join('')}</details>` : '';
}

function recordOptions(rows, field) {
  return '<option value="">None</option>' + rows.map(r => `<option value="${r.id}">${esc(r[field])}</option>`).join('');
}

let draftPage=null, notebookWorkspace=null, citationStyle='APA', rendererPromise;
function newDraft(){return {id:0,revision:0,taskId:'',sourceId:'',blocks:[{type:'Text',value:''}]};}
function parseBlocks(body){
  if(!body)return [{type:'Text',value:''}];
  return body.split(/(\x60{3}[^\n]*\n[\s\S]*?\n\x60{3}|\$\$[\s\S]*?\$\$)/g).filter(Boolean).flatMap(part=>{
    if(part.startsWith('\x60\x60\x60'))return [{type:'Code',value:part.slice(part.indexOf('\n')+1,-4)}];
    if(part.startsWith('$$'))return [{type:'Equation',value:part.slice(2,-2).trim()}];
    return part.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean).map(x=>({type:x.split('\n').every(l=>l.startsWith('|'))?'Table':'Text',value:x}));
  });
}
function serializeBlocks(blocks){
  return blocks.map(({type,value})=>type==='Equation'?'$$\n'+value+'\n$$':type==='Code'?'\x60\x60\x60\n'+value+'\n\x60\x60\x60':value).join('\n\n').trim();
}
function ensureRenderers(){
  if(rendererPromise)return rendererPromise;
  const style=url=>{const el=document.createElement('link');el.rel='stylesheet';el.href=url;document.head.append(el);};
  const script=url=>new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=url;el.onload=resolve;el.onerror=reject;document.head.append(el);});
  style('/vendor/katex/katex.min.css');style('/vendor/highlight.css');
  rendererPromise=Promise.all([script('/vendor/katex/katex.min.js'),script('/vendor/highlight.min.js')]).catch(()=>{});
  return rendererPromise;
}
function decorateNotes(){
  ensureRenderers().then(()=>{
    document.querySelectorAll('[data-equation]').forEach(el=>{
      if(window.katex)window.katex.render(el.dataset.equation,el,{displayMode:true,throwOnError:false,trust:false});
    });
    if(window.hljs)document.querySelectorAll('.rf-note-code:not([data-highlighted])').forEach(el=>window.hljs.highlightElement(el));
  });
}
function inlineWidgets(value){
  return String(value).split(/(\[\[(?:cite|file|task|user):\d+\]\])/g).map(part=>{
    const m=part.match(/^\[\[(cite|file|task|user):(\d+)\]\]$/);if(!m)return esc(part);
    const id=Number(m[2]);
    if(m[1]==='task'){const t=taskById(id);return t?recordLink('task',id)+' '+statusPill(t.status):'Archived task';}
    if(m[1]==='user')return '<strong>@'+esc(state.data.members.find(u=>u.id===id)?.name||'Former teammate')+'</strong>';
    const f=state.data.files.find(f=>f.id===id);
    if(f && m[1]==='file' && labSaved(f))return labFileButton(f);
    if(f && m[1]==='file' && / figure [0-9]+\.png$/i.test(f.original_name))return '<img loading="lazy" class="lab-note-figure" alt="'+esc(f.original_name)+'" src="/api/files/'+id+'/preview">';
    return !f?'Unavailable source':m[1]==='file'?'<button class="tiny-btn" data-preview="'+id+'">'+esc(f.original_name)+'</button>':recordLink('file',id);
  }).join('');
}
function tableRows(text){return text.split('\n').filter(Boolean).map(l=>l.replace(/^\||\|$/g,'').split('|').map(c=>c.trim()));}
function citationEntry(file){
  if(citationStyle==='BibTeX')return '<pre>'+esc(buildBibtexFallback(file))+'</pre>';
  const c=file.citation_meta||{},title=c.title||file.original_name,authors=c.authors||'',year=c.year||'n.d.',journal=c.journal||'',doi=c.doi?' https://doi.org/'+c.doi:'';
  if(citationStyle==='MLA')return esc([authors, '“'+title+'.”',journal, c.year].filter(Boolean).join(' ')+doi);
  return esc([authors, '('+year+').',title+'.',journal].filter(Boolean).join(' ')+doi);
}
function displayNote(n){
  const blocks=parseBlocks(n.body);
  const content=blocks.map(b=>{
    if(b.type==='Code')return '<pre><code class="rf-note-code">'+esc(b.value)+'</code></pre>';
    if(b.type==='Equation')return '<div data-equation="'+esc(b.value)+'">'+esc(b.value)+'</div>';
    if(b.type==='Table')return '<div class="task-table-wrap"><table class="task-table">'+tableRows(b.value).map((row,i)=>'<tr>'+row.map(c=>i?'<td>'+inlineWidgets(c)+'</td>':'<th>'+inlineWidgets(c)+'</th>').join('')+'</tr>').join('')+'</table></div>';
    return '<p style="white-space:pre-wrap">'+inlineWidgets(b.value)+'</p>';
  }).join('');
  const ids=new Set([...(n.source_ids||[]),n.source_id].filter(Boolean)),sources=state.data.files.filter(f=>ids.has(f.id));
  return content+(sources.length?'<h4>References · '+citationStyle+'</h4>'+sources.map(f=>'<div>'+citationEntry(f)+'</div>').join(''):'');
}
function blockEditor(b,i){
  let input='<textarea class="field" rows="'+(b.type==='Text'?3:4)+'" data-block="'+i+'" aria-label="'+b.type+' block">'+esc(b.value)+'</textarea>';
  if(b.type==='Table'){
    const rows=tableRows(b.value);
    input='<div class="task-table-wrap"><table>'+rows.map((r,ri)=>'<tr>'+r.map((c,ci)=>'<td><input class="field" aria-label="Row '+(ri+1)+' column '+(ci+1)+'" data-grid="'+[i,ri,ci].join(',')+'" value="'+esc(c)+'"></td>').join('')+'</tr>').join('')+'</table></div><button type="button" data-grid-row="'+i+'">Add row</button> <button type="button" data-grid-col="'+i+'">Add column</button>';
  }
  return '<section class="mini-tip" data-block-wrap="'+i+'"><div class="panel-heading">'+b.type+'<button type="button" class="text-link" data-remove-block="'+i+'">Remove</button></div>'+input+'</section>';
}
function notesPage(){
  if(notebookWorkspace!==state.workspace.id){draftPage=newDraft();notebookWorkspace=state.workspace.id;}
  const d=draftPage;
  queueMicrotask(decorateNotes);
  return pageHeading('RESEARCH JOURNAL','Research notebook','Link evidence, equations, observations and decisions in shared pages.')+
    '<section class="card panel"><div class="panel-heading">'+(d.id?'Edit notebook page':'New notebook page')+'</div><form id="note-form"><div class="form-grid"><label>Related task<select class="field" name="taskId">'+recordOptions(state.data.tasks,'title').replace('value="'+d.taskId+'"','selected value="'+d.taskId+'"')+'</select></label><label>Primary source<select class="field" name="sourceId">'+recordOptions(state.data.files,'original_name').replace('value="'+d.sourceId+'"','selected value="'+d.sourceId+'"')+'</select></label></div>'+
    '<div data-peer-view="'+esc(d.id?'Editing notebook page '+d.id:'Research notebook')+'">'+participantBadges(nearby.filter(p=>p.view===(d.id?'Editing notebook page '+d.id:'Research notebook')))+'</div>'+d.blocks.map(blockEditor).join('')+'<div class="rf-tools">'+['Text','Equation','Code','Table'].map(k=>'<button type="button" class="tiny-btn" data-add-block="'+k+'">＋ '+k+'</button>').join('')+
    '<label>Insert <select id="inline-record" class="field"><option value="">Mention, task or citation…</option>'+[['user',state.data.members,'name'],['task',state.data.tasks,'title'],['cite',state.data.files,'original_name']].map(([k,rows,field])=>'<optgroup label="'+k+'">'+rows.map(r=>'<option value="'+k+':'+r.id+'">'+esc(r[field])+'</option>').join('')+'</optgroup>').join('')+'</select></label></div>'+
    '<p class="small-text muted">Type /code, /math or /table at the start of a text block. Use @, #link or [[cite]] to choose a workspace record.</p><div class="file-drop" id="note-drop"><label>Attach a plot or dataset <input type="file" multiple id="note-attachment"></label></div><div aria-live="polite" id="note-upload-status"></div><button type="submit" class="button solid">Save notebook page</button> <button type="button" class="tiny-btn" id="reset-draft">New draft</button></form></section>'+
    '<div class="panel-heading section-spacer">Notebook pages <label>References <select id="citation-style">'+['APA','MLA','BibTeX'].map(k=>'<option '+(k===citationStyle?'selected':'')+'>'+k+'</option>').join('')+'</select></label></div>'+
    state.data.notes.map(n=>'<article tabindex="-1" id="note-'+n.id+'" class="card panel section-spacer"><div class="panel-heading">'+esc(n.author_name)+' · '+timeDate(n.created_at)+'<span><button class="tiny-btn" data-edit-note="'+n.id+'">Edit</button> <button class="tiny-btn" data-note-ai="'+n.id+'">Ask agent</button> <button class="text-link" data-delete-note="'+n.id+'">Delete</button></span></div>'+displayNote(n)+recordLink('task',n.task_id)+recordHistory('note',n.id)+'</article>').join('');
}
let focusedBlock=0;
document.addEventListener('focusin',e=>{if(e.target.dataset.block!==undefined)focusedBlock=Number(e.target.dataset.block);});
function addBlock(type){
  const block={type,value:type==='Table'?'| Dimension | Observation |\n|  |  |':''};
  draftPage.blocks.push(block);focusedBlock=draftPage.blocks.length-1;render();document.querySelector('[data-block="'+focusedBlock+'"]')?.focus();
}
function insertWidget(token){
  let b=draftPage.blocks[focusedBlock];if(!b||b.type!=='Text'){draftPage.blocks.push({type:'Text',value:''});focusedBlock=draftPage.blocks.length-1;b=draftPage.blocks[focusedBlock];}
  b.value=b.value.replace(/(?:@|#link|\[\[cite\]\])$/,'')+' [['+token+']] ';render();document.querySelector('[data-block="'+focusedBlock+'"]')?.focus();
}
document.addEventListener('input',e=>{
  const el=e.target;if(!el.closest('#note-form'))return;
  if(el.name==='taskId'||el.name==='sourceId'){draftPage[el.name]=el.value;return;}
  if(el.dataset.grid){
    const [i,r,c]=el.dataset.grid.split(',').map(Number),rows=tableRows(draftPage.blocks[i].value);
    rows[r][c]=el.value.replaceAll('|','¦');draftPage.blocks[i].value=rows.map(row=>'|'+row.join('|')+'|').join('\n');
  }
  if(el.dataset.block===undefined)return;
  const b=draftPage.blocks[Number(el.dataset.block)];b.value=el.value;
  if(b.type!=='Text')return;
  const type={'/math':'Equation','/code':'Code','/table':'Table'}[el.value.trim()];
  if(type){b.type=type;b.value=type==='Table'?'| Field | Value |\n|  |  |':'';render();document.querySelector('[data-block="'+focusedBlock+'"]')?.focus();}
  else if(/(?:@|#link|\[\[cite\]\])$/.test(b.value))$('inline-record').focus();
});
document.addEventListener('click',e=>{
  const el=e.target.closest('button');if(!el)return;
  if(el.dataset.addBlock)addBlock(el.dataset.addBlock);
  if(el.dataset.removeBlock!==undefined){draftPage.blocks.splice(Number(el.dataset.removeBlock),1);if(!draftPage.blocks.length)draftPage.blocks=newDraft().blocks;render();}
  if(el.dataset.gridRow!==undefined||el.dataset.gridCol!==undefined){
    const isRow=el.dataset.gridRow!==undefined,b=draftPage.blocks[Number(isRow?el.dataset.gridRow:el.dataset.gridCol)],rows=tableRows(b.value);
    if(isRow)rows.push(Array(rows[0].length).fill(''));else rows.forEach(row=>row.push(''));
    b.value=rows.map(row=>'|'+row.join('|')+'|').join('\n');render();
  }
  if(el.id==='reset-draft'){draftPage=newDraft();render();connectLive();}
  if(el.dataset.editNote){const n=state.data.notes.find(n=>n.id===Number(el.dataset.editNote));draftPage={id:n.id,revision:n.revision,sourceId:n.source_id||'',taskId:n.task_id||'',blocks:parseBlocks(n.body)};render();$('note-form').scrollIntoView();connectLive();}
  if(el.dataset.noteAi){const n=state.data.notes.find(n=>n.id===Number(el.dataset.noteAi));handleAgent('Propose validation or follow-up tasks from notebook page '+n.id+': '+n.body.slice(0,2200));}
});
async function attachToNote(files){
  const draft=draftPage,workspace=state.workspace.id,failures=[];
  for(const f of Array.from(files)){
    if(draft!==draftPage||workspace!==state.workspace.id)break;
    try{
      if(f.size>15*1024*1024)throw Error('exceeds 15 MiB');
      const form=new FormData();form.append('file',f);
      const r=await api('/files',{method:'POST',body:form,form:true});
      draft.blocks.push({type:'Text',value:'[[file:'+r.id+']]'});
    }catch(e){failures.push(f.name+' — '+e.message);}
  }
  await reload();if($('note-upload-status'))$('note-upload-status').textContent=failures.join(' · ')||'Attachments added to this draft.';
}
document.addEventListener('change',e=>{
  if(e.target.id==='citation-style'){citationStyle=e.target.value;render();}
  if(e.target.id==='inline-record'&&e.target.value)insertWidget(e.target.value);
  if(e.target.id==='note-attachment')attachToNote(e.target.files);
});
document.addEventListener('dragover',e=>{if(e.target.closest('#note-drop'))e.preventDefault();});
document.addEventListener('drop',e=>{if(e.target.closest('#note-drop')){e.preventDefault();attachToNote(e.dataTransfer.files);}});

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
           `<div class="member-row"><div class="avatar">${esc(initials(u.name))}</div><div class="member-info"><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></div><div class="member-role">${isOwner&&u.role!=='owner'?`<select aria-label="Role for ${esc(u.name)}" data-member-role="${u.id}"><option value="editor" ${u.role!=='viewer'?'selected':''}>Editor</option><option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option></select>`:esc(u.role)}</div></div>`
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
    state.pendingActions = result.actions || [];state.proposalId=result.proposalId||null;
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
  const fields={title:cit.title||f.original_name,author:cit.authors,year:cit.year,journal:cit.journal,doi:cit.doi,abstract:cit.abstract,annote:f.user_notes};
  const entries=Object.entries(fields).filter(([,v])=>v).map(([k,v])=>'  '+k+' = {'+String(v).replace(/[{}]/g,'').trim()+'}');
  return '@'+(cit.journal?'article':'misc')+'{researchflow'+f.id+',\n'+entries.join(',\n')+'\n}';
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
    $('content').innerHTML='<section class="card panel" role="status" aria-label="Loading workspace"><h2>Loading workspace…</h2><div class="rf-skeleton"></div><div class="rf-skeleton"></div><div class="rf-skeleton"></div></section>';
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
      const body=serializeBlocks(draftPage.blocks);
      const id=draftPage.id;
      await api(id?'/notes/'+id:'/notes',{method:id?'PATCH':'POST',body:{body,revision:draftPage.revision,sourceId:Number(form.elements.sourceId.value)||null,taskId:Number(form.elements.taskId.value)||null}});
      draftPage=newDraft();
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
      await api('/agent/apply', { method: 'POST', body: { actions: state.pendingActions, proposalId:state.proposalId } });
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
function closeLive(){live?.close();nearby=[];document.querySelectorAll('.rf-cursor').forEach(el=>el.remove());live=null;liveKey='';clearTimeout(liveTimer);$('presence')?.replaceChildren();}
function connectLive(){
  if(!state.user||!state.workspace) return;
  const w=state.workspace.id;
  if(activeWorkspace!==w){
    activeWorkspace=w; resetBoardFilters();dependencyStart=null;selectedTasks.clear(); undoStack=[];redoStack=[];state.messages=[];state.pendingActions=[];
  }
  const task=$('task-dialog').open && taskById($('task-form').elements.id.value);
  const view=task?'Editing '+task.title:state.page==='notes'&&draftPage?.id?'Editing notebook page '+draftPage.id:({tasks:'Task board',notes:'Research notebook',files:'Research library',analysis:'Data analysis',activity:'Activity timeline',agent:'AI agent',overview:'Overview',team:'Team'}[state.page]);
  const key=w+'|'+view;
  if(key===liveKey){showPresence(nearby);return;}
  closeLive();liveKey=key;
  live=new EventSource('/api/live?'+new URLSearchParams({workspace:w,view,tab:tabIdentity}));
  live.addEventListener('presence',e=>{
    const peers=JSON.parse(e.data);
    showPresence(peers);
  });
  live.addEventListener('cursor',e=>showCursor(JSON.parse(e.data)));
  live.onerror=()=>{$('presence').textContent='Reconnecting…';};
  live.addEventListener('change',()=>{
    clearTimeout(liveTimer);
    liveTimer=setTimeout(()=>{
      if(!busyMutation&&!state.busy&&!$('task-dialog').open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&['tasks','overview','activity','team','notes','files'].includes(state.page)&&!document.querySelector('dialog[open]')&&!state.activeReviewFileId&&!uploading)reload({quiet:true});
    },250);
  });
}
$('task-dialog').addEventListener('close',connectLive);
function pick(t){return '<input type="checkbox" aria-label="Select '+esc(t.title)+'" data-pick="'+t.id+'" '+(selectedTasks.has(t.id)?'checked':'')+'>';}
function boardTools(){
  return '<div class="rf-tools">'+(dueFilter||assigneeFilter!==null||openOnly?'<button class="tiny-btn" data-reset-board>Clear drill-down filter</button>':'')+['Board','Table','Schedule'].map(v=>'<button class="button secondary" aria-pressed="'+(boardView===v)+'" data-board="'+v+'">'+v+'</button>').join('')+
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
  queueMicrotask(dependencyLines);
  return '<p>'+first+' — '+shiftDate(first,days-1)+'</p><div id="schedule-grid" style="position:relative">'+rows.map(t=>{
    const start=t.start_date||t.due_date,end=t.due_date||start;
    const left=start?100*(Date.parse(start)-Date.parse(first))/dayMs/days:0;
    const width=start?100*((Date.parse(end)-Date.parse(start))/dayMs+1)/days:0;
    return '<div class="rf-schedule" data-schedule-task="'+t.id+'">'+pick(t)+'<button class="text-link" data-edit="'+t.id+'">'+esc(t.title)+'</button><div class="rf-track" data-days="'+days+'">'+(start?'<button class="rf-bar" data-bar="'+t.id+'" title="'+start+' to '+end+'" style="left:'+left+'%;width:'+width+'%"><span data-edge="start">‹</span><span data-edge="end">›</span></button>':'Unscheduled')+'</div><button class="tiny-btn" data-dates="'+t.id+'">Dates</button><button class="tiny-btn" draggable="true" data-wire="'+t.id+'" title="Connect to a successor task">Link</button></div>';
  }).join('')+'</div>';
}
function detailPanel(t){
  const deps=state.data.dependencies||[], comments=(state.data.comments||[]).filter(c=>c.task_id===t.id), runs=(state.data.runs||[]).filter(r=>r.task_id===t.id);
  const text=(label,key)=>'<label>'+label+'<input class="field" data-run-field="'+key+'"></label>';
  return '<section class="rf-detail"><div data-peer-view="'+esc('Editing '+t.title)+'"></div><h3>Dependencies</h3>'+deps.filter(d=>d.successor===t.id).map(d=>'Blocked by '+recordLink('task',d.predecessor)+' <button type="button" data-unlink="'+d.predecessor+'">Remove</button>').join(' ')+deps.filter(d=>d.predecessor===t.id).map(d=>' Blocks '+recordLink('task',d.successor)).join(' ')+
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
    const restore=document.createElement('button');restore.className='tiny-btn';restore.dataset.history=history==='undo'?'redo':'undo';restore.textContent=history==='undo'?'Redo':'Undo';$('toast').append(' ',restore);
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
  return '<section class="card panel section-spacer"><h2>Progress by phase</h2>'+phases.filter(p=>rows.some(t=>t.phase===p)).map(p=>bar(p,rows.filter(t=>t.phase===p),'data-phase-drill="'+esc(p)+'"')).join('')+'<h3>Team workload</h3>'+state.data.members.map(m=>'<button class="tiny-btn" data-workload="'+m.id+'">'+esc(m.name)+' · '+rows.filter(t=>t.assignee_id===m.id&&t.status!=='Done').length+' open</button>').join(' ')+boardInsights()+focusedGraph()+'<div class="rf-tools">'+['Markdown','CSV','PDF','BibTeX'].map(f=>'<button class="tiny-btn" data-export="'+f+'">'+f+'</button>').join('')+'</div></section>';
}
function graphView(){
  const {tasks,files,notes,runs=[],dependencies=[]}=state.data;
  const groups=[tasks.map(t=>['task',t.id,t.title]),files.map(f=>['file',f.id,f.original_name]),notes.map(n=>['note',n.id,n.body]),runs.map(r=>['run',r.id,r.label,r.task_id])];
  const points=new Map(),edges=[];
  groups.forEach((nodes,i)=>nodes.forEach(([kind,id],j)=>points.set(kind+id,[95+i*190,30+j*56])));
  function edge(a,b){const from=points.get(a),to=points.get(b);if(from&&to)edges.push('<path d="M'+from.join(' ')+' Q'+(from[0]+50)+' '+((from[1]+to[1])/2)+' '+to.join(' ')+'"/>');}
  tasks.forEach(t=>t.source_ids?.forEach(id=>edge('task'+t.id,'file'+id)));
  notes.forEach(n=>{for(const id of n.task_ids||[n.task_id])edge('note'+n.id,'task'+id);for(const id of n.source_ids||[n.source_id])edge('note'+n.id,'file'+id);});
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
    if(d.phaseDrill||d.workload){resetBoardFilters();state.phaseFilter=d.phaseDrill||'All';if(d.workload){assigneeFilter=Number(d.workload);openOnly=true;}goto('tasks');}
    if(d.command){$('find-records').close();if(d.command==='create')openTask();else goto(d.command);}
  }catch(error){toast(error.message,true);}
});
document.addEventListener('input',e=>{
  if(e.target.id!=='find-query')return;
  const term=e.target.value.toLowerCase();
  const commands={create:'Create a task',overview:'Overview',tasks:'Task board',files:'Research library',notes:'Research notebook',agent:'Ask the AI research agent',analysis:'Data analysis',activity:'Activity timeline',team:'Team'};
  $('find-results').insertAdjacentHTML('afterbegin',Object.entries(commands).filter(([,v])=>v.toLowerCase().includes(term)).map(([k,v])=>'<button class="tiny-btn" data-command="'+k+'">'+v+'</button>').join(' '));
});
document.addEventListener('input',e=>{
  if(e.target.id!=='find-query')return;
  const term=e.target.value.trim().toLowerCase();
  const workspaceButtons=state.workspaces.filter(w=>w.id!==state.workspace.id&&('switch '+w.name).toLowerCase().includes(term)).map(w=>'<button class="tiny-btn" data-switch-workspace="'+w.id+'">Switch to '+esc(w.name)+'</button>');
  const assignments=term.startsWith('assign')?state.data.tasks.filter(t=>t.title.toLowerCase().includes(term.slice(6).trim())).slice(0,10).map(t=>'<button class="tiny-btn" data-assign-task="'+t.id+'">Assign '+esc(t.title)+'</button>'):[];
  $('find-results').insertAdjacentHTML('beforeend',workspaceButtons.concat(assignments,term?['<button class="tiny-btn" data-agent-query>Ask research agent</button>']:[]).join(' '));
});
document.addEventListener('keydown',e=>{
  if(!state.user)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if($('find-records').open)$('find-records').close();else $('open-finder').click();}
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
const matrixFields=['Methodology','Governing equations','Boundary conditions','Key findings','Limitations'];
function dimensions(){return [...new Set([...matrixFields,...state.data.files.flatMap(f=>Object.keys(f.citation_meta?.dimensions||{}))])];}
function previewDialog(){
  let dlg=$('source-reader');
  if(dlg)return dlg;
  dlg=document.createElement('dialog');dlg.id='source-reader';dlg.className='dialog';dlg.setAttribute('aria-label','Source reader');
  dlg.style.cssText='width:min(960px,96vw);max-width:96vw;max-height:92dvh;overflow:auto';document.body.append(dlg);return dlg;
}
function imageSource(file){return /\.(png|jpe?g)$/i.test(file.original_name);}
async function readSource(id){
  const file=state.data.files.find(f=>f.id===id);if(!file)return;
  const dlg=previewDialog();dlg.dataset.id=id;dlg.innerHTML='<div class="dialog-inner"><div class="dialog-top"><h2>'+esc(file.original_name)+'</h2><form method="dialog"><button class="tiny-btn">Close</button></form></div><section id="reader-body" aria-live="polite">Opening source…</section></div>';
  dlg.showModal();const body=$('reader-body');
  if(imageSource(file)){
    const other=state.data.files.filter(f=>f.id!==id&&imageSource(f));
    body.innerHTML='<label>Compare with <select id="compare-image">'+recordOptions(other,'original_name')+'</select></label><div style="display:flex;overflow:auto;gap:10px"><img data-lightbox src="/api/files/'+id+'/preview" alt="'+esc(file.original_name)+'" style="max-width:100%;min-width:0;object-fit:contain"><img id="second-image" hidden alt="Comparison image" style="max-width:50%;min-width:0;object-fit:contain"></div><button class="tiny-btn" id="zoom-plot">Zoom image</button>';
    return;
  }
  try {
    const result=await api('/files/'+id+'/preview');
    body.innerHTML='<p>Select a passage, then save it with its source.</p><div class="inline-actions"><button data-quote="task">Create follow-up task</button><button data-quote="note">Save notebook quote</button></div><pre id="source-text" tabindex="0" style="white-space:pre-wrap;line-height:1.6;user-select:text"></pre>';
    body.querySelector('pre').textContent=result.text||'No selectable text was extracted.';
  }catch(e){body.textContent=e.message;}
}
document.addEventListener('selectionchange',()=>{
  const box=$('source-text'),sel=window.getSelection();
  if(box&&sel&&!sel.isCollapsed&&box.contains(sel.anchorNode)&&box.contains(sel.focusNode))box.dataset.quote=sel.toString().slice(0,4500);
});
document.addEventListener('change',e=>{
  if(e.target.id==='compare-image'){
    const img=$('second-image');img.hidden=!e.target.value;if(!img.hidden)img.src='/api/files/'+Number(e.target.value)+'/preview';
    document.querySelector('[data-lightbox]').style.maxWidth=img.hidden?'100%':'50%';
  }
});
document.addEventListener('click',async e=>{
  const btn=e.target.closest('button');if(!btn)return;
  try{
    if(btn.id==='import-reference'){
      const identifier=$('source-identifier').value.trim();if(!identifier)return;
      btn.disabled=true;
      try{const r=await api('/files/import',{method:'POST',body:{identifier}});state.activeReviewFileId=r.id;await reload();toast('Reference imported');}finally{btn.disabled=false;}
    }
    if(btn.dataset.preview)await readSource(Number(btn.dataset.preview));
    if(btn.id==='zoom-plot'){
      const img=document.querySelector('[data-lightbox]');img.style.maxWidth=img.style.maxWidth==='none'?'100%':'none';
    }
    if(btn.dataset.quote){
      const quote=$('source-text')?.dataset.quote;
      if(!quote)throw Error('Select a passage in the source first.');
      const dialog=previewDialog(),id=Number(dialog.dataset.id),f=state.data.files.find(row=>row.id===id);
      if(btn.dataset.quote==='task'){dialog.close();openTask({title:'Follow up on '+f.original_name.slice(0,150),description:quote,source_ids:[id]});}
      else{await api('/notes',{method:'POST',body:{sourceId:id,body:quote}});dialog.close();await reload();toast('Quote saved with its source');}
    }
    if(btn.dataset.dimension||btn.dataset.newDimension){
      const f=state.data.files.find(row=>row.id===Number(btn.dataset.dimension||btn.dataset.newDimension));
      const key=(btn.dataset.key||prompt('Research dimension, e.g. Archive or Boundary conditions')||'').trim().slice(0,72);
      if(!key||['__proto__','prototype','constructor'].includes(key))return;
      const current=f.citation_meta||{},value=prompt(key,current.dimensions?.[key]||'');if(value===null)return;
      await api('/files/'+f.id+'/metadata',{method:'PATCH',body:{citation_meta:{...current,dimensions:{...current.dimensions,[key]:value.slice(0,4000)}}}});
      await reload();
    }
  }catch(error){toast(error.message,true);}
});

const tabIdentity=window.crypto.randomUUID();
let nearby=[],lastPointer=0,pointerInFlight=false,assigneeFilter=null,dueFilter=false,openOnly=false;
function participantBadges(peers){
  const unique=[...new Map(peers.map(p=>[p.user+'|'+p.view,p])).values()];
  return unique.map(p=>'<span style="display:inline-flex;align-items:center;gap:4px;margin-inline-end:7px" title="'+esc(p.name+' · '+p.view)+'"><b class="avatar small" aria-hidden="true">'+esc(initials(p.name))+'</b><span>'+esc(p.name)+' · '+esc(p.view)+'</span></span>').join('');
}
function showPresence(peers){
  nearby=peers;
  $('presence').innerHTML=participantBadges(peers);
  const scopes=document.querySelectorAll('[data-peer-view]');
  scopes.forEach(el=>{el.innerHTML=participantBadges(peers.filter(p=>p.view===el.dataset.peerView));});
}
function cursorSurface(){return $('task-dialog').open?$('task-dialog'):$('content');}
document.addEventListener('pointermove',async e=>{
  if(!live||nearby.length<2||performance.now()-lastPointer<300||pointerInFlight)return;
  const surface=cursorSurface();
  if(!surface.contains(e.target))return;
  const b=surface.getBoundingClientRect();if(!b.width||!b.height)return;
  lastPointer=performance.now();pointerInFlight=true;
  try{await api('/live/cursor',{method:'POST',body:{tab:tabIdentity,x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height}});}
  catch{}finally{pointerInFlight=false;}
});
function showCursor(p){
  if(!p.tab||p.tab===tabIdentity)return;
  let marker=[...document.querySelectorAll('.rf-cursor')].find(el=>el.dataset.peer===p.tab);
  if(!marker){marker=document.createElement('span');marker.className='rf-cursor';marker.dataset.peer=p.tab;cursorSurface().append(marker);}
  const b=cursorSurface().getBoundingClientRect();
  marker.textContent='↖ '+p.name;marker.style.cssText='pointer-events:none;position:fixed;z-index:40;color:white;background:#286d65;border-radius:6px;padding:2px 5px;font-size:11px;left:'+(b.left+p.x*b.width)+'px;top:'+(b.top+p.y*b.height)+'px';
  clearTimeout(marker.expiry);marker.expiry=setTimeout(()=>marker.remove(),1800);
}
function boardInsights(){
  const rows=state.data.tasks,deps=state.data.dependencies||[],workers=[...state.data.members,{id:0,name:'Unassigned'}];
  const overdue=rows.filter(t=>t.status!=='Done'&&t.due_date&&t.due_date<today());
  const grid=workers.map(m=>{
    const assigned=rows.filter(t=>(t.assignee_id||0)===m.id);
    return '<tr><th>'+esc(m.name)+'</th>'+statuses.map(s=>{
      const count=assigned.filter(t=>t.status===s).length;
      return '<td><button class="tiny-btn" style="background:rgba(50,145,120,'+Math.min(.5,.04+count*.07)+')" data-heat-user="'+m.id+'" data-heat-status="'+s+'" aria-label="'+esc(m.name+', '+s+', '+count+' tasks')+'">'+count+'</button></td>';
    }).join('')+'</tr>';
  }).join('');
  const blocked=rows.filter(t=>t.status==='Blocked'||deps.some(d=>d.successor===t.id&&taskById(d.predecessor)?.status!=='Done'));
  function chain(id,path=[],depth=0){
    if(depth>10||path.includes(id))return '';
    const parents=deps.filter(d=>d.successor===id&&taskById(d.predecessor)?.status!=='Done').slice(0,6);
    return parents.map(d=>chain(d.predecessor,[...path,id],depth+1)).filter(Boolean).join(' / ')+(parents.length?' → ':'')+recordLink('task',id);
  }
  return '<div class="two-col section-spacer"><section><h3>Workload by status</h3><div class="task-table-wrap"><table class="task-table"><tr><th>Teammate</th>'+statuses.map(s=>'<th>'+s+'</th>').join('')+'</tr>'+grid+'</table></div></section><section><h3>Last 7 days</h3>'+((state.data.velocity||[]).map(v=>'<p>'+esc(v.phase)+' · '+v.completed+' completed</p>').join('')||'<p>No recorded completions in this period.</p>')+'<button class="tiny-btn" data-overdue>Overdue · '+overdue.length+'</button><h3>Blocked work</h3>'+ (blocked.map(t=>'<p>'+chain(t.id)+'</p>').join('')||'<p>No blocked tasks.</p>')+'</section></div>';
}
let dependencyStart=null;
function dependencyLines(){
  const root=$('schedule-grid');if(!root)return;
  root.querySelector('.rf-arrows')?.remove();
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','rf-arrows');svg.setAttribute('aria-hidden','true');
  svg.style.cssText='position:absolute;inset:0;height:100%;width:100%;pointer-events:none;overflow:visible';
  const rect=root.getBoundingClientRect();
  svg.innerHTML='<defs><marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8" fill="#557f7a"/></marker></defs>';
  for(const d of state.data.dependencies||[]){
    const a=root.querySelector('[data-bar="'+d.predecessor+'"]'),b=root.querySelector('[data-bar="'+d.successor+'"]');if(!a||!b)continue;
    const from=a.getBoundingClientRect(),to=b.getBoundingClientRect();
    const x=from.right-rect.left,y=from.top+from.height/2-rect.top,ex=to.left-rect.left,ey=to.top+to.height/2-rect.top;
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M'+x+' '+y+' C'+(x+20)+' '+y+' '+(ex-20)+' '+ey+' '+ex+' '+ey);
    path.setAttribute('fill','none');path.setAttribute('stroke','#557f7a');path.setAttribute('marker-end','url(#dep-arrow)');svg.append(path);
  }
  root.append(svg);
}
window.addEventListener('resize',dependencyLines);
async function connectDependency(from,to){
  if(!from||!to||from===to)return;
  try{await api('/tasks/'+to+'/detail',{method:'POST',body:{kind:'dependency',predecessor:from}});await reload();toast('Dependency saved');}catch(e){toast(e.message,true);}
}
document.addEventListener('dragstart',e=>{
  const el=e.target.closest('[data-wire]');if(el)e.dataTransfer.setData('application/x-task-dependency',el.dataset.wire);
});
document.addEventListener('dragover',e=>{if(e.target.closest('[data-schedule-task]')&&e.dataTransfer.types.includes('application/x-task-dependency'))e.preventDefault();});
document.addEventListener('drop',e=>{const row=e.target.closest('[data-schedule-task]');if(!row)return;const source=Number(e.dataTransfer.getData('application/x-task-dependency'));if(source){e.preventDefault();connectDependency(source,Number(row.dataset.scheduleTask));}});
document.addEventListener('click',async e=>{
  const el=e.target.closest('button');if(!el)return;
  if(el.dataset.wire){const id=Number(el.dataset.wire);if(dependencyStart){const from=dependencyStart;dependencyStart=null;await connectDependency(from,id);}else{dependencyStart=id;toast('Choose the successor task’s Link button');}}
  if(el.hasAttribute('data-overdue')||el.hasAttribute('data-heat-user')){
    resetBoardFilters();dueFilter=el.hasAttribute('data-overdue');
    if(!dueFilter){assigneeFilter=Number(el.dataset.heatUser);state.filter=el.dataset.heatStatus;}goto('tasks');
  }
  if(el.hasAttribute('data-reset-board')){resetBoardFilters();render();}
  if(el.dataset.switchWorkspace){$('find-records').close();const sw=$('workspace-switcher');sw.value=el.dataset.switchWorkspace;sw.dispatchEvent(new Event('change',{bubbles:true}));}
  if(el.dataset.assignTask){$('find-records').close();if($('task-dialog').open)$('task-dialog').close();openTask(taskById(el.dataset.assignTask));$('task-assign').focus();}
  if(el.hasAttribute('data-agent-query')){const msg=$('find-query').value.trim();$('find-records').close();await handleAgent(msg);}
});
function resetBoardFilters(){state.search='';state.phaseFilter='All';state.filter='All';dueFilter=false;assigneeFilter=null;openOnly=false;}
document.addEventListener('change',async e=>{
  if(!e.target.dataset.memberRole)return;
  try{await api('/members/'+e.target.dataset.memberRole,{method:'PATCH',body:{role:e.target.value}});toast('Workspace role updated');}catch(err){toast(err.message,true);}await reload();
});

const boardStyles=document.createElement('style');
boardStyles.textContent=".rf-tools,.rf-lane header,.rf-schedule,.rf-metric{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}.rf-tools{margin:0 0 1rem}.rf-tools [aria-pressed=true]{background:#243c38;color:white}.rf-board{display:grid;grid-template-columns:repeat(4,minmax(165px,1fr));gap:12px;overflow:auto;padding-bottom:8px}.rf-lane{background:#f5f7f6;border-radius:10px;border-top:3px solid var(--lane);padding:10px;min-height:180px}.lane-0{--lane:#8793a5}.lane-1{--lane:#c88b3c}.lane-2{--lane:#c16a6a}.lane-3{--lane:#389480}.rf-lane header{justify-content:space-between;margin-bottom:12px}.rf-card{display:grid;gap:10px;background:white;border:1px solid #d8dfdb;border-radius:8px;padding:12px;margin:8px 0;cursor:grab}.rf-card button{text-align:left}.rf-card small,.rf-presence{color:#47665c}.rf-presence{max-width:23vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.75rem}.rf-detail{display:grid;gap:8px}.rf-detail h3{margin:12px 0 0}.rf-diff{background:#fcf1cb}.rf-schedule{flex-wrap:nowrap;padding:8px;border-bottom:1px solid #ddd}.rf-schedule>.text-link{width:20%;text-align:left}.rf-track{position:relative;height:32px;flex:1;background:#edf2ef;border-radius:5px}.rf-bar{position:absolute;top:3px;height:26px;min-width:20px;border:0;border-radius:5px;background:#35776c;color:white;display:flex;justify-content:space-between;align-items:center;touch-action:none;cursor:grab}.rf-bar span{cursor:ew-resize}.rf-metric{width:100%;background:none;border:0;padding:8px;text-align:left}.rf-metric b{width:130px}.rf-stack{display:flex;flex:1;height:10px;overflow:hidden;border-radius:5px}.rf-stack i{background:var(--lane)}.rf-graph{overflow:auto;max-height:480px}.rf-graph>div{position:relative}.rf-graph svg{position:absolute;inset:0;stroke:#89a89c;fill:none}.rf-graph button{position:absolute;width:146px;height:30px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:white}.rf-detail table{font-size:.8rem}#task-dialog{max-height:94dvh;overflow:auto}button:focus-visible,input:focus-visible{outline:3px solid #24847a;outline-offset:2px}@media print{.sidebar,.topbar,.mobile-nav,.rf-tools,.agent-feature{display:none!important}.app-area{margin:0!important}}@media(max-width:700px){.rf-presence{max-width:22vw}.rf-board{grid-template-columns:repeat(4,75vw)}#task-dialog{width:100%;max-width:100%;margin:auto 0 0;max-height:95dvh}}\n";
boardStyles.textContent+=' .rf-skeleton{height:1rem;background:#e2ebe7;margin:.8rem 0;border-radius:.3rem;width:90%}.rf-skeleton:nth-child(3){width:60%}.rf-presence{display:flex;align-items:center}.rf-detail button{min-height:28px}';
document.head.append(boardStyles);
const presenceLabel=document.createElement('span');
presenceLabel.id='presence';presenceLabel.className='rf-presence';
$('sync-status').before(presenceLabel);
function analysisRows(text) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n');
  const delim = clean.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = [];
  let row=[], field='', quoted=false;
  for (let i=0; i<clean.length; i++) {
    const c=clean[i];
    if (c==='"') {
      if (quoted && clean[i+1]==='"') { field+='"'; i++; }
      else quoted=!quoted;
    } else if (!quoted && c===delim) { row.push(field.trim()); field=''; }
    else if (!quoted && c==='\n') { row.push(field.trim()); if(row.some(Boolean)) rows.push(row); row=[]; field=''; }
    else field+=c;
  }
  if(quoted) throw Error('Close the quoted field before applying the data.');
  row.push(field.trim()); if(row.some(Boolean)) rows.push(row);
  const headers=rows.shift();
  if(!headers?.length || !rows.length) throw Error('Include column headings and at least one data row.');
  if(rows.some(r=>r.length!==headers.length)) throw Error('Check the number of fields in each row. Quote values containing commas.');
  if(rows.length>25000) throw Error('Use up to 25,000 rows per figure.');
  return {headers,rows};
}
const labDrafts = new Map();
const labPalette = ['#167478','#bb5934','#4f64a1','#8a577e','#688040','#93692d'];
const labModes = ['Fit a trend','Compare measured and predicted','Compare groups','Test an association','Describe a distribution','Explore coded texts'];
const labMethods = ['Linear','Quadratic','Cubic','Logarithmic','Exponential','Power'];
const labNum = s => String(s??'').trim()!=='' && Number.isFinite(Number(s)) ? Number(s) : NaN;
const labFmt = n => Number.isFinite(n)?String(+n.toPrecision(5)):'—';
const labMean = a => a.reduce((s,x)=>s+x,0)/a.length;
const labSum = a => a.reduce((s,x)=>s+x,0);
const labCsv = rows => rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n');
function labDefault(){
  return {csv:'Load (kN),Measured (mm),Predicted (mm)\n10,0.72,0.68\n20,1.46,1.38\n30,2.04,2.12\n40,2.93,2.81\n50,3.35,3.51\n60,4.28,4.21',name:'Load–displacement study',source:'Example dataset',sourceId:0,
    mode:labModes[0],method:'Linear',type:'Scatter',x:0,y:1,more:[],group:-1,word:-1,category:0,frequency:'Counts',title:'Load–displacement response',xlabel:'',ylabel:'',font:'Arial',size:11,width:170,height:105,xmin:'',xmax:'',ymin:'',ymax:'',xtick:'',ytick:'',logx:false,logy:false,grid:true,gray:false,fit:true,error:'95% CI',styles:{},types:{},units:{},caption:'',versionNote:'',groupA:'',groupB:''};
}
function analysisDraft(){
  const key=JSON.stringify([state.user.id,state.workspace?.id]);
  if(!labDrafts.has(key)){
    const a=labDefault();labDrafts.set(key,a);
    try{const raw=localStorage.getItem('rf.analysis.draft.'+key);if(raw){const item=JSON.parse(raw);analysisRows(item.settings.csv);Object.assign(a,item.settings);labStatus.set(a,item.status);labHasLocal.add(a);}}catch{}
  }
  return labDrafts.get(key);
}
function labSummary(values){
  const a=values.slice().sort((x,y)=>x-y),mean=labMean(a);
  const q=p=>{const t=(a.length-1)*p,i=Math.floor(t);return a[i]+(t-i)*((a[i+1]??a[i])-a[i]);};
  const variance=a.length>1?labSum(a.map(v=>(v-mean)**2))/(a.length-1):NaN;
  return {n:a.length,mean,sd:Math.sqrt(variance),se:Math.sqrt(variance/a.length),median:q(.5),q1:q(.25),q3:q(.75),min:a[0],max:a.at(-1)};
}
// Student t probabilities via the regularized incomplete beta continued fraction.
function labLogGamma(z){
  const p=[676.5203681218851,-1259.1392167224028,771.3234287776531,-176.61502916214059,12.507343278686905,-.13857109526572012,9.984369578019572e-6,1.5056327351493116e-7];
  if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-labLogGamma(1-z);
  z--;let x=.9999999999998099;p.forEach((v,i)=>x+=v/(z+i+1));const t=z+7.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);
}
function labBeta(a,b,x){
  if(x<=0)return 0;if(x>=1)return 1;
  if(x>(a+1)/(a+b+2))return 1-labBeta(b,a,1-x);
  const safe=x=>Math.abs(x)<1e-30?1e-30:x;
  let c=1,d=1/safe(1-(a+b)*x/(a+1)),h=d;
  for(let m=1;m<=150;m++){
    let k=m*(b-m)*x/((a+2*m-1)*(a+2*m));d=1/safe(1+k*d);c=safe(1+k/c);h*=c*d;
    k=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));d=1/safe(1+k*d);c=safe(1+k/c);const delta=c*d;h*=delta;if(Math.abs(delta-1)<1e-13)break;
  }
  return Math.exp(labLogGamma(a+b)-labLogGamma(a)-labLogGamma(b)+a*Math.log(x)+b*Math.log1p(-x))*h/a;
}
function labTCrit(df){
  if(!(df>0))return NaN;
  let lo=0,hi=16;for(let i=0;i<40;i++){const t=(lo+hi)/2;if(labBeta(df/2,.5,df/(df+t*t))>.05)lo=t;else hi=t;}return (lo+hi)/2;
}
function labRank(a){
  const s=a.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=[];
  for(let i=0;i<s.length;){let j=i+1;while(j<s.length&&s[j].v===s[i].v)j++;for(let k=i;k<j;k++)out[s[k].i]=(i+j+1)/2;i=j;}return out;
}
function labCorrelation(x,y){
  const mx=labMean(x),my=labMean(y),dx=x.map(v=>v-mx),dy=y.map(v=>v-my);
  const r=labSum(dx.map((v,i)=>v*dy[i]))/Math.sqrt(labSum(dx.map(v=>v*v))*labSum(dy.map(v=>v*v)));
  return Math.max(-1,Math.min(1,r));
}
function labRegression(points,method){
  const logX=['Logarithmic','Power'].includes(method), logY=['Exponential','Power'].includes(method);
  const p=points.filter(([x,y])=>(!logX||x>0)&&(!logY||y>0));
  const degree=method==='Cubic'?3:method==='Quadratic'?2:1, k=degree+1;
  if(p.length<k)throw Error(method+' requires at least '+k+' eligible pairs.');
  const x=p.map(v=>logX?Math.log(v[0]):v[0]),y=p.map(v=>logY?Math.log(v[1]):v[1]);
  const center=labMean(x),scale=Math.max(...x.map(v=>Math.abs(v-center)));
  if(!scale)throw Error('X must vary to estimate a trend.');
  const u=x.map(v=>(v-center)/scale), q=[],r=Array.from({length:k},()=>Array(k).fill(0));
  for(let j=0;j<k;j++){
    let col=u.map(v=>v**j);
    for(let i=0;i<j;i++){r[i][j]=labSum(col.map((v,n)=>v*q[i][n]));col=col.map((v,n)=>v-r[i][j]*q[i][n]);}
    r[j][j]=Math.sqrt(labSum(col.map(v=>v*v)));
    if(r[j][j]<1e-10*Math.sqrt(p.length))throw Error('Too few distinct X values for this model.');
    q[j]=col.map(v=>v/r[j][j]);
  }
  const back=b=>{const v=b.slice();for(let i=k-1;i>=0;i--){for(let j=i+1;j<k;j++)v[i]-=r[i][j]*v[j];v[i]/=r[i][i];}return v;};
  const c=back(q.map(col=>labSum(col.map((v,i)=>v*y[i]))));
  const linear=u=>c.reduceRight((s,v)=>s*u+v,0);
  const predict=x=>{const z=linear(((logX?Math.log(x):x)-center)/scale);return logY?Math.exp(z):z;};
  const residual=p.map(([x,y])=>[x,y-predict(x)]),sse=labSum(residual.map(t=>t[1]**2)),avg=labMean(p.map(v=>v[1])),sst=labSum(p.map(v=>(v[1]-avg)**2));
  const df=p.length-k,noise=labSum(y.map((v,i)=>(v-linear(u[i]))**2))/df,t=labTCrit(df);
  const inv=Array.from({length:k},(_,j)=>back(Array.from({length:k},(_,i)=>+(i===j))));
  const stats=[['Model',method],['Eligible pairs',p.length],['Domain exclusions',points.length-p.length],['R² (original Y)',labFmt(sst?1-sse/sst:NaN)],['RMSE',labFmt(Math.sqrt(sse/p.length))],['MAE',labFmt(labMean(residual.map(t=>Math.abs(t[1]))))]];
  // Convert coefficients and covariance from the centred basis to powers of x or ln(x).
  const choose=[[1],[1,1],[1,2,1],[1,3,3,1]];
  for(let i=0;i<k;i++){
    const weights=c.map((_,j)=>j<i?0:choose[j][i]*(-center)**(j-i)/scale**j);
    const estimate=labSum(c.map((v,j)=>v*weights[j]));
    const se=Math.sqrt(noise*labSum(inv.map(col=>labSum(col.map((v,j)=>v*weights[j]))**2)));
    const ci=Number.isFinite(t*se)?' ['+labFmt(estimate-t*se)+', '+labFmt(estimate+t*se)+']':'';
    stats.push([['Intercept','Slope','Quadratic coefficient','Cubic coefficient'][i],labFmt(estimate)+ci]);
  }
  const coefficients=c.map((_,i)=>labSum(c.map((v,j)=>j<i?0:v*choose[j][i]*(-center)**(j-i)/scale**j)));
  const predictor=logX?'ln(X)':'X';
  const equation=(logY?'ln(Y)':'Y')+' = '+labFmt(coefficients[0])+coefficients.slice(1).map((v,i)=>(v<0?' − ':' + ')+labFmt(Math.abs(v))+'·'+predictor+(['','²','³'][i]||'')).join('');
  return {p,predict,residual,stats,equation};
}
function labCompute(a,d){
  const info={highlights:[],used:new Set(),series:[],results:[],issues:[],message:'',categorical:false,labels:[],xname:d.headers[a.x],yname:d.headers[a.y]};
  const numeric=(row,c)=>{if(a.types[c]==='Text')return NaN;const s=String(row[c]??'').trim();return labNum(a.types[c]==='Number (grouped)'&&/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)?s.replaceAll(',',''):s);};
  const add=(key,rows)=>info.results.push(...rows.map(([metric,value])=>[key,metric,value]));
  const issue=(i,s)=>info.issues.push([i+2,s]);
  if(a.mode===labModes[5]){
    info.categorical=true;info.xname=d.headers[a.category];info.yname=a.frequency;
    const counts=new Map(),totals=new Map(),denoms=new Map(),invalid=new Set(),cats=new Set();
    d.rows.forEach((r,i)=>{
      const g=+a.group>=0?r[a.group]:'Corpus',c=r[a.category];
      if(!c||!g){issue(i,'Missing category or group');return;}
      if(!counts.has(g))counts.set(g,new Map());
      cats.add(c);const m=counts.get(g);m.set(c,(m.get(c)||0)+1);totals.set(g,(totals.get(g)||0)+1);
      if(a.frequency==='Per 10,000 words'){const w=numeric(r,a.word);if(!(w>0)||denoms.has(g)&&denoms.get(g)!==w){invalid.add(g);issue(i,'Invalid or inconsistent word total for this group');}denoms.set(g,w);}
    });
    d.rows.forEach((r,i)=>{const g=+a.group>=0?r[a.group]:'Corpus';if(!g||!r[a.category])return;
      if(invalid.has(g))issue(i,'Word rate unavailable for this text: check its repeated word total');else info.used.add(i);
    });
    info.labels=[...cats];for(const [g,m] of counts){
      const den=a.frequency==='Per 10,000 words'?denoms.get(g):totals.get(g);
      const points=[];
      info.labels.forEach((c,i)=>{const n=m.get(c)||0;const v=a.frequency==='Counts'?n:a.frequency==='Within-group %'?100*n/den:invalid.has(g)?NaN:10000*n/den;
        if(n&&Number.isFinite(v))info.highlights.push(c+' in '+g+' occurs '+n+' '+(n===1?'time':'times')+(a.frequency==='Per 10,000 words'?' in '+den.toLocaleString()+' words, or '+labFmt(v)+' per 10,000 words.':a.frequency==='Within-group %'?' among '+den+' coded occurrences ('+labFmt(v)+'%).':' among '+den+' coded occurrences.'));
        add(g,[[c,labFmt(v)+' · count '+n+' / '+den+(a.frequency==='Per 10,000 words'?' words':' coded rows')]]);if(Number.isFinite(v))points.push([i,v]);});
      info.series.push({key:g,points,kind:'bar'});
    }
    info.message='One row represents one coded occurrence. Percentages use all included codes within each group. For word rates, repeat the same full text word count on every row of that group.';
    return info;
  }
  const groups=new Map(),measurements=[...new Set([+a.y,...(a.mode===labModes[0]?a.more.map(Number):[])])];
  d.rows.forEach((r,i)=>{
    const x=numeric(r,a.x),g=+a.group>=0?r[a.group]:'';
    if(+a.group>=0&&!g){issue(i,'Missing group');return;}
    for(const j of measurements){
      const y=numeric(r,j),needsX=![labModes[2],labModes[4]].includes(a.mode);
      if(!Number.isFinite(y)||needsX&&!Number.isFinite(x)){issue(i,'Missing or nonnumeric '+(!Number.isFinite(y)?d.headers[j]:d.headers[a.x]));continue;}
      const key=g?(measurements.length>1?g+' · '+d.headers[j]:g):d.headers[j];
      if(a.mode!==labModes[0])info.used.add(i);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push([x,y,i]);
    }
  });
  const summaries=new Map();
  if(a.mode===labModes[4]){
    const all=[...groups.values()].flat().map(p=>p[1]);if(!all.length)return info;
    const min=Math.min(...all),max=Math.max(...all),bins=Math.min(40,Math.ceil(Math.sqrt(all.length))),step=(max-min||1)/bins;
    info.xname=d.headers[a.y];info.yname='Frequency';info.categorical=true;
    info.labels=Array.from({length:bins},(_,i)=>labFmt(min+i*step)+'–'+labFmt(min+(i+1)*step));
    for(const [key,p] of groups){const v=p.map(r=>r[1]),s=labSummary(v),counts=Array(bins).fill(0);v.forEach(z=>counts[Math.min(bins-1,Math.floor((z-min)/step))]++);
      info.highlights.push(key+' · median = '+labFmt(s.median)+' · interquartile range '+labFmt(s.q1)+' to '+labFmt(s.q3)+' · n = '+s.n);info.series.push({key,kind:'bar',points:counts.map((n,i)=>[i,n])});add(key,[['N',s.n],['Mean',s.mean],['Sample SD',s.sd],['Median',s.median],['Q1',s.q1],['Q3',s.q3],['Minimum',s.min],['Maximum',s.max]].map(([k,v])=>[k,labFmt(v)]));}
    return info;
  }
  for(const [key,p] of groups){
    if(a.mode===labModes[2]){
      const s=labSummary(p.map(t=>t[1])),err=a.error==='SD'?s.sd:a.error==='SE'?s.se:labTCrit(s.n-1)*s.se;
      info.highlights.push(key+' · mean = '+labFmt(s.mean)+' across '+s.n+' observations.');summaries.set(key,s);info.categorical=true;info.xname=+a.group>=0?d.headers[a.group]:'Group';
      info.series.push({key,kind:'mean',points:[[info.labels.length,s.mean]],error:err});info.labels.push(key);
      add(key,[['N',s.n],['Mean',labFmt(s.mean)],[a.error,labFmt(err)]]);continue;
    }
    if(a.mode===labModes[1]){
      const delta=p.map(([measured,pred])=>pred-measured);
      info.highlights.push(key+' · '+p.length+' matched observations · RMSE = '+labFmt(Math.sqrt(labMean(delta.map(v=>v*v))))+' · MAE = '+labFmt(labMean(delta.map(Math.abs))));
      add(key,[['Matched rows',p.length],['RMSE',labFmt(Math.sqrt(labMean(delta.map(v=>v*v))))],['MAE',labFmt(labMean(delta.map(Math.abs)))],['Mean bias (prediction − measurement)',labFmt(labMean(delta))]]);
      info.series.push({key,points:p,kind:'Scatter',identity:true});info.message='Each row must contain a matched measurement (X) and prediction (Y). The dashed diagonal marks exact agreement.';continue;
    }
    if(a.mode===labModes[3]){
      const x=p.map(t=>t[0]),y=p.map(t=>t[1]),r=labCorrelation(x,y),z=Math.atanh(r),delta=1.96/Math.sqrt(p.length-3);
      info.highlights.push(key+' · Pearson r = '+labFmt(r)+' across '+p.length+' complete pairs.');
      add(key,[['Complete pairs',p.length],['Pearson r',labFmt(r)],['Pearson 95% CI (Fisher z)',p.length>3?labFmt(Math.tanh(z-delta))+' to '+labFmt(Math.tanh(z+delta)):'—'],['Spearman ρ (average ranks)',labFmt(labCorrelation(labRank(x),labRank(y)))]]);
      info.series.push({key,points:p,kind:'Scatter'});info.message='Pearson measures linear association. Spearman measures monotonic association. The Pearson interval assumes independent pairs and approximate bivariate normality.';continue;
    }
    const series={key,points:p,kind:a.type};info.series.push(series);
    try{
      const model=labRegression(p,a.method);add(key,model.stats);const report=Object.fromEntries(model.stats);info.highlights.push(key+' · '+model.equation+' · n = '+model.p.length+' · R² = '+report['R² (original Y)']+' · RMSE = '+report.RMSE);
      model.p.forEach(t=>info.used.add(t[2]));const eligible=new Set(model.p);p.forEach(t=>{if(!eligible.has(t))issue(t[2],'Outside '+a.method+' model domain');});
      if(a.type==='Residuals'){series.points=model.residual;info.yname='Residual (observed − fitted)';}
      else if(a.fit){const xs=model.p.map(t=>t[0]),lo=Math.min(...xs),hi=Math.max(...xs);series.curve=Array.from({length:101},(_,i)=>{const x=lo+(hi-lo)*i/100;return [x,model.predict(x)];});}
    }catch(e){p.forEach(t=>issue(t[2],key+': '+e.message));add(key,[['Model unavailable',e.message]]);if(a.type==='Residuals')series.points=[];}
    info.message='Coefficients include pointwise 95% t intervals when residual degrees of freedom permit. Inference assumes independent errors with constant variance and approximate normality on the fitted scale. '+({Exponential:'Model: ln(Y) = b₀ + b₁X; Y must be positive.',Power:'Model: ln(Y) = b₀ + b₁ln(X); both variables must be positive.',Logarithmic:'Model: Y = b₀ + b₁ln(X); X must be positive.'}[a.method]||'Polynomial terms use the original X units.');
  }
  if(a.mode===labModes[2]){
    const keys=[...summaries.keys()],g1=keys.includes(a.groupA)?a.groupA:keys[0],g2=keys.includes(a.groupB)?a.groupB:keys[1],s=summaries.get(g1),t=summaries.get(g2);
    info.groupKeys=keys;info.message='Error bars show '+a.error+'. Welch’s comparison assumes independent observations in two groups. The difference is first group minus second group.';
    if(s&&t&&g1!==g2&&s.n>1&&t.n>1){const v=s.se**2,w=t.se**2,df=(v+w)**2/(v*v/(s.n-1)+w*w/(t.n-1)),se=Math.sqrt(v+w),diff=s.mean-t.mean,T=diff/se,margin=labTCrit(df)*se;
      add(g1+' − '+g2,[['Mean difference',labFmt(diff)],['95% Welch CI',labFmt(diff-margin)+' to '+labFmt(diff+margin)],['Welch t',labFmt(T)],['Degrees of freedom',labFmt(df)],['Two-sided p',labFmt(labBeta(df/2,.5,df/(df+T*T)))]]);}
  }
  return info;
}
function labStyle(a,key,i){
  const s=a.styles[key]||{};
  return {geometry:s.geometry||'Use chart setting',label:s.label||key,color:a.gray?['#202020','#656565','#444444','#888888'][i%4]:/^#[0-9a-f]{6}$/i.test(s.color)?s.color:labPalette[i%labPalette.length],dash:s.dash||['Solid','Dashed','Dotted'][i%3],marker:s.marker||['Circle','Square','Triangle','Diamond'][i%4],weight:Math.max(.4,Math.min(6,Number(s.weight)||1.6))};
}
function labFigure(a,m){
  const W=Math.round(a.width*96/25.4),H=Math.round(a.height*96/25.4),fs=+a.size*96/72;
  const cat=m.categorical, logX=!cat&&a.logx,logY=a.logy, ncat=Math.min(30,m.labels.length);
  const visible=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&(!logX||x>0)&&(!logY||y>0)&&(!cat||x<ncat);
  const all=m.series.flatMap(s=>[...s.points,...(s.curve||[]),...(Number.isFinite(s.error)?s.points.flatMap(([x,y])=>[[x,y-s.error],[x,y+s.error]]):[])]).filter(([x,y])=>visible(x,y));
  if(!all.length)throw Error('No plottable observations. Check the column choices and axis scales.');
  let xl=Infinity,xh=-Infinity,yl=Infinity,yh=-Infinity;
  for(const [x,y] of all){xl=Math.min(xl,x);xh=Math.max(xh,x);yl=Math.min(yl,y);yh=Math.max(yh,y);}
  if(cat){xl=-.5;xh=ncat-.5;if(!logY){yl=Math.min(yl,0);yh=Math.max(yh,0);}}
  const bounds=(lo,hi,vmin,vmax,log,categorical=false)=>{
    const tr=log?Math.log10:x=>x, un=log?x=>10**x:x=>x;
    let l=tr(lo),h=tr(hi),pad=(h-l)*.055||.5;
    if(!categorical){l-=pad;h+=pad;}
    if(vmin!=='')l=tr(+vmin);if(vmax!=='')h=tr(+vmax);
    if(!Number.isFinite(l+h)||h<=l)throw Error('Axis limits must increase. Logarithmic limits must be positive.');
    return [l,h,un,tr];
  };
  const [x0,x1,ux,tx]=bounds(xl,xh,cat?'':a.xmin,cat?'':a.xmax,logX,cat);
  const [y0,y1,uy,ty]=bounds(yl,yh,a.ymin,a.ymax,logY);
  const left=fs*5.1,right=W-fs*1.3,top=fs*3.7,bottom=H-fs*(cat?7.3:4.8)-Math.ceil(m.series.length/3)*fs*1.5;
  if(right-left<65||bottom-top<45)throw Error('Increase figure dimensions or reduce the font size for this legend.');
  const X=x=>left+(tx(x)-x0)/(x1-x0)*(right-left),Y=y=>bottom-(ty(y)-y0)/(y1-y0)*(bottom-top);
  const line=(x,y,x2,y2,attrs)=>'<line x1="'+x+'" y1="'+y+'" x2="'+x2+'" y2="'+y2+'" '+attrs+'/>';
  const txt=(x,y,s,attrs='')=>'<text x="'+x+'" y="'+y+'" '+attrs+'>'+esc(s)+'</text>';
  const mark=(x,y,style)=>{
    const r=fs*.25,c='fill="'+style.color+'"';
    if(style.marker==='None')return '';
    if(style.marker==='Square')return '<rect x="'+(x-r)+'" y="'+(y-r)+'" width="'+2*r+'" height="'+2*r+'" '+c+'/>';
    if(style.marker==='Circle')return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" '+c+'/>';
    const p=style.marker==='Triangle'?[[0,-r],[r,r],[-r,r]]:[[0,-r],[r,0],[0,r],[-r,0]];
    return '<polygon points="'+p.map(([u,v])=>[x+u,y+v].join(',')).join(' ')+'" '+c+'/>';
  };
  const ticks=(l,h,step,un)=>{
    if(step==='')return Array.from({length:6},(_,i)=>un(l+(h-l)*i/5));
    const s=+step,start=Math.ceil(l/s)*s;if(!(s>0)||((h-start)/s)>100)throw Error('Choose a positive tick interval producing at most 100 ticks.');
    return Array.from({length:Math.max(0,Math.floor((h-start)/s+1e-9)+1)},(_,i)=>un(start+i*s));
  };
  let content=txt(W/2,fs*1.85,a.title,'data-axis-edit="title" text-anchor="middle" font-weight="bold" font-size="'+fs*1.25+'"');
  for(const y of ticks(y0,y1,a.ytick,uy)){const py=Y(y);if(a.grid)content+=line(left,py,right,py,'stroke="#dce4e4"');content+=txt(left-6,py+fs*.32,labFmt(y),'text-anchor="end"');}
  for(const x of cat?Array.from({length:ncat},(_,i)=>i):ticks(x0,x1,a.xtick,ux)){
    const px=X(x),py=bottom+fs*1.2,label=cat?m.labels[x]:labFmt(x);
    content+=txt(px,py,cat&&label.length>14?label.slice(0,13)+'…':label,cat?'transform="rotate(-35 '+px+' '+py+')" text-anchor="end"':'text-anchor="middle"');
  }
  content+=line(left,bottom,right,bottom,'stroke="#485858"')+line(left,top,left,bottom,'stroke="#485858"');
  let ink='';const dash={Solid:'',Dashed:'7 4',Dotted:'2 3'};
  function path(points,stroke,pattern,w){let d='',start=true;for(const [x,y] of points){if(!visible(x,y)){start=true;continue;}d+=(start?'M':'L')+X(x).toFixed(2)+' '+Y(y).toFixed(2)+' ';start=false;}return '<path d="'+d+'" fill="none" stroke="'+stroke+'" stroke-width="'+w+'" stroke-dasharray="'+pattern+'"/>';}
  m.series.forEach((s,i)=>{
    const st=labStyle(a,s.key,i),pts=s.points.filter(([x,y])=>visible(x,y));
    if((['Line only','Line and markers'].includes(st.geometry)||(st.geometry==='Use chart setting'&&s.kind==='Line'))&&!cat)ink+=path(s.points,st.color,dash[st.dash],st.weight);
    if(s.identity)ink+=path([[ux(x0),ux(x0)],[ux(x1),ux(x1)]],'#777','5 4',1);
    if(s.curve)ink+=path(s.curve,st.color,dash[st.dash]||'7 4',st.weight);
    for(const [x,y] of pts){const px=X(x),py=Y(y);
      if(s.kind==='bar'){const width=(right-left)/ncat*.8/m.series.length,base=logY?bottom:Y(0);ink+='<rect x="'+(px-width*m.series.length/2+i*width)+'" y="'+Math.min(py,base)+'" width="'+width+'" height="'+Math.abs(base-py)+'" fill="'+st.color+'"/>';}
      else {if(st.geometry!=='Line only'||cat)ink+=mark(px,py,st);if(s.kind==='mean'&&Number.isFinite(s.error)&&(!logY||y-s.error>0)){const y1=Y(y-s.error),y2=Y(y+s.error),attr='stroke="'+st.color+'"';ink+=line(px,y1,px,y2,attr)+line(px-4,y1,px+4,y1,attr)+line(px-4,y2,px+4,y2,attr);}}
    }
    const lx=left+(i%3)*(right-left)/3,ly=H-fs*(.8+1.5*(Math.ceil(m.series.length/3)-1-Math.floor(i/3)));
    content+=line(lx,ly-3,lx+18,ly-3,'stroke="'+st.color+'" stroke-width="'+st.weight+'" stroke-dasharray="'+dash[st.dash]+'"')+mark(lx+9,ly-3,st)+txt(lx+22,ly,st.label,'data-legend-edit="'+esc(s.key)+'"');
  });
  const axis=(s,col)=>s+(a.units[col]?' ('+a.units[col]+')':'');
  content+=txt((left+right)/2,bottom+fs*(cat?5.9:3.2),a.xlabel||axis(m.xname||'',a.mode===labModes[4]?a.y:a.x),'data-axis-edit="xlabel" text-anchor="middle"')+
    txt(0,0,a.ylabel||(cat&&a.mode!==labModes[2]?m.yname:axis(m.yname||'',a.y)),'data-axis-edit="ylabel" transform="translate('+fs+' '+((top+bottom)/2)+') rotate(-90)" text-anchor="middle"');
  return '<svg id="analysis-svg" role="img" aria-label="'+esc(a.title)+'" xmlns="http://www.w3.org/2000/svg" width="'+a.width+'mm" height="'+a.height+'mm" viewBox="0 0 '+W+' '+H+'" font-family="'+esc(a.font)+'" font-size="'+fs+'" fill="#273738"><rect width="100%" height="100%" fill="white"/><defs><clipPath id="lab-clip"><rect x="'+left+'" y="'+top+'" width="'+(right-left)+'" height="'+(bottom-top)+'"/></clipPath></defs>'+content+'<g clip-path="url(#lab-clip)">'+ink+'</g></svg>';
}
function labOptions(items,current){
  return items.map(item=>{const [v,t]=Array.isArray(item)?item:[item,item];return '<option value="'+esc(v)+'" '+(String(current)===String(v)?'selected':'')+'>'+esc(t)+'</option>';}).join('');
}
function labTable(headers,rows){
  return '<div class="lab-scroll"><table class="task-table"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
const labSaved=f=>/\.analysis\.txt$/i.test(f.original_name);
const labSource=f=>/\.(csv|tsv|xlsx)$/i.test(f.original_name);
function labFileButton(f){return labSource(f)||labSaved(f)?'<button class="tiny-btn" data-lab-file="'+Number(f.id)+'">Open in Data analysis</button>':'';}
let labWorkbook=null;
const labStatus=new WeakMap(),labHasLocal=new WeakSet(),labTimers=new WeakMap();
const labLocalKey=()=> 'rf.analysis.draft.'+JSON.stringify([state.user.id,state.workspace?.id]);
function labShowStatus(a,status){
  labStatus.set(a,status);
  if(state.user&&analysisDraft()===a&&$('lab-save-status'))$('lab-save-status').textContent=status;
}
function labPersist(a,status='Draft saved on this device',key=labLocalKey()){
  clearTimeout(labTimers.get(a));
  try{localStorage.setItem(key,JSON.stringify({settings:a,status}));labHasLocal.add(a);labShowStatus(a,status);}
  catch{labShowStatus(a,status.startsWith('Version saved')?status:'Unsaved changes · device storage unavailable');}
}
function labDirty(a){
  const key=labLocalKey();labShowStatus(a,'Unsaved changes');clearTimeout(labTimers.get(a));
  labTimers.set(a,setTimeout(()=>labPersist(a,'Draft saved on this device',key),350));
}
function labVersionOptions(){
  const groups=new Map(),labels=new Map();
  for(const f of state.data.files.filter(labSaved).slice().sort((a,b)=>Number(a.id)-Number(b.id))){
    const stem=f.original_name.replace(/\.analysis\.txt$/i,''),match=stem.match(/^(.*?) (\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z(?: -- (.*))?$/);
    const title=match?match[1]:stem,n=(groups.get(title)||0)+1;groups.set(title,n);
    const time=match?new Date(match[2]+'T'+match[3]+':'+match[4]+':'+match[5]+'Z'):new Date(f.created_at);
    labels.set(f.id,title+' · Version '+n+(isNaN(time)?'':' · '+time.toLocaleString(undefined,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}))+(match?.[7]?' · '+match[7]:''));
  }
  return [...labels].reverse();
}
const labEntry = new WeakMap();
function labStart(a){
  const path=labEntry.get(a)||'home';
  const btn=(key,label)=>'<button class="button secondary" data-start="'+key+'">'+label+'</button>';
  const opts=(list,first)=>labOptions([['',first],...list.map(f=>[f.id,f.original_name])],'');
  let panel=labEntry.has(a)?btn('work','Return to current analysis'):'';
  if(path==='open')panel+='<section class="card panel"><h2>Open dataset</h2><div class="lab-fields"><label>From the research library<select class="field" id="lab-source">'+opts(state.data.files.filter(labSource),'Choose a dataset…')+'</select></label><label>Upload CSV, TSV or Excel<input type="file" id="lab-upload" accept=".csv,.tsv,.xlsx,.txt"></label></div><details><summary>Paste data</summary><textarea class="field" id="lab-csv" rows="6" aria-label="Delimited dataset">'+esc(a.pending||'')+'</textarea><button class="button solid" data-lab-action="apply">Use pasted data</button></details></section>';
  if(labHasLocal.has(a))panel+=btn('work','Continue device draft');
  if(path==='resume')panel+='<section class="card panel"><h2>Resume analysis</h2><label>Saved analyses<select class="field" id="lab-saved">'+labOptions([['','Choose a saved version…'],...labVersionOptions()],'')+'</select></label></section>';
  if(path==='examples')panel+='<section class="card panel"><h2>Choose an example</h2><div class="rf-tools">'+btn('numeric','Numerical research')+'<button class="button secondary" data-lab-action="human">Humanities research</button></div></section>';
  return pageHeading('RESEARCH METHODS','Data analysis','Choose a dataset or continue an existing analysis.')+'<div id="analysis-lab"><section class="card panel"><div class="rf-tools">'+btn('open','Open dataset')+btn('resume','Resume analysis')+btn('examples','Try an example')+'</div></section>'+panel+'</div>';
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-start]');if(!b)return;
  const a=analysisDraft(),choice=b.dataset.start;
  if(choice==='numeric'){Object.assign(a,labDefault());labDirty(a);delete a.pending;labWorkbook=null;}
  labEntry.set(a,choice==='numeric'?'work':choice);render();
});
function analysisPage(){
  if(labEntry.get(analysisDraft())!=='work')return labStart(analysisDraft());
  const a=analysisDraft(),d=analysisRows(a.csv),cols=d.headers.map((h,i)=>[i,h||'Column '+(i+1)]);
  const select=(key,label,items)=>'<label>'+label+'<select class="field" data-lab="'+key+'">'+labOptions(items,a[key])+'</select></label>';
  const input=(key,label,type='text',limits='')=>'<label>'+label+'<input class="field" data-lab="'+key+'" type="'+type+'" '+limits+' value="'+esc(a[key])+'"></label>';
  const check=(key,label)=>'<label><input type="checkbox" data-lab="'+key+'" '+(a[key]?'checked':'')+'> '+label+'</label>';
  const button=(key,label)=>'<button type="button" class="tiny-btn" data-lab-action="'+key+'">'+label+'</button>';
  const files=state.data.files, saved=files.filter(labSaved),source=files.filter(labSource),write=state.workspace?.role!=='viewer',human=a.mode===labModes[5],trend=a.mode===labModes[0];
  const questions=['Fit a curve','Compare measurements with a model','Compare groups','Test an association','Describe a distribution','Compare themes across texts'];
  const guidance=[
    'Choose a predictor and a response, then select the curve to fit.',
    'Match the measured and predicted values on each row. For example, at the same load, enter 2.4 mm measured and 2.6 mm predicted.',
    'Choose a measurement and the column identifying the independent groups.',
    'Choose two variables measured on the same observation.',
    'Choose the numeric values whose distribution you want to see.',
    'Use one row per coded occurrence. For word-normalised rates, repeat each text’s full word total on every row for that text.'
  ][labModes.indexOf(a.mode)];
  const uniqueGroups=+a.group>=0?[...new Set(d.rows.map(r=>r[a.group]).filter(Boolean))]:[];
  return pageHeading('RESEARCH METHODS','Data analysis','Prepare a dataset, compare evidence, and save reproducible figures.')+
    '<div id="analysis-lab" class="lab-editor" data-pane="'+(labPanes.get(a)||'Figure')+'"><nav aria-label="Analysis panels" class="lab-tabs">'+['Data','Figure','Results'].map(v=>'<button class="tiny-btn" data-pane-choice="'+v+'">'+v+'</button>').join('')+'</nav><section class="card panel lab-data"><div class="lab-head"><h2>Analysis workspace</h2><span>'+esc(a.source)+' · '+d.rows.length+' rows</span></div><div class="lab-fields">'+input('name','Analysis name')+'<span id="lab-save-status" role="status">'+esc(labStatus.get(a)||'Unsaved changes')+'</span>'+input('versionNote','Version note (optional)')+
    '</div><div class="rf-tools"><button class="tiny-btn" data-start="open">Change dataset</button><button class="tiny-btn" data-start="resume">Open saved version</button>'+(write?button('save','Save version'):'')+button('duplicate','Duplicate analysis')+
    (a.sourceId?'<button class="tiny-btn" data-preview="'+Number(a.sourceId)+'">View source record</button>':'')+'</div><details><summary>Paste or edit data</summary><textarea id="lab-csv" class="field" rows="6" aria-label="Delimited dataset">'+esc(a.pending??a.csv)+'</textarea>'+button('apply','Apply data')+'</details>'+
    (labWorkbook?.owner===a?'<div class="lab-fields"><label>Excel sheet<select id="lab-sheet" class="field">'+labOptions(labWorkbook.sheets.map((s,i)=>[i,s.name]),labWorkbook.index)+'</select></label><label>Header row<input class="field" id="lab-header" type="number" min="1" value="'+labWorkbook.header+'"></label>'+button('sheet','Use sheet and header')+'</div>':'')+
    '</section><details class="card panel lab-quality"><summary>Data preview and quality checks</summary><div id="lab-quality"></div></details>'+
    '<section class="card panel lab-question"><h2>Research question</h2><div class="lab-fields">'+select('mode','What do you want to find out?',labModes.map((v,i)=>[v,questions[i]]))+
    (trend?select('method','Regression model',labMethods)+select('type','Display',['Scatter','Line','Residuals']):'')+
    (human?select('category','Theme',cols)+select('frequency','Frequency measure',['Counts','Within-group %','Per 10,000 words'])+(a.frequency==='Per 10,000 words'?select('word','Total words in each text',[[-1,'Select word totals'],...cols]):''):
    (![labModes[2],labModes[4]].includes(a.mode)?select('x',a.mode===labModes[1]?'Measured value':trend?'Predictor (X)':'First variable',cols):'')+select('y',a.mode===labModes[1]?'Predicted value':trend?'Response (Y)':a.mode===labModes[3]?'Second variable':'Measurement',cols))+
    select('group',human?'Text':'Group series by',[[-1,'All rows'],...cols])+
    (a.mode===labModes[2]?select('error','Error bars',['95% CI','SD','SE'])+(uniqueGroups.length>1?select('groupA','First group',[['','First available'],...uniqueGroups])+select('groupB','Second group',[['','Second available'],...uniqueGroups]):''):'')+'</div>'+
    '<p class="small-text">'+esc(guidance)+'</p>'+(trend?'<details><summary>Additional Y series</summary>'+cols.filter(([i])=>i!==+a.y).map(([i,h])=>'<label class="lab-inline"><input type="checkbox" data-lab-more="'+i+'" '+(a.more.includes(i)?'checked':'')+'> '+esc(h)+'</label>').join('')+'</details>':'')+'</section>'+
    '<section class="card panel lab-chart"><h2>Figure</h2><div id="lab-plot"></div><div id="lab-coverage" class="small-text"></div><div class="rf-tools"><details class="lab-export"><summary class="tiny-btn">Export figure</summary><p id="lab-export-spec"></p><div class="rf-tools">'+button('svg','Editable SVG')+button('png300','PNG · 300 DPI')+button('png600','PNG · 600 DPI')+button('pdf','Print / PDF')+'</div></details>'+(write?'<button class="tiny-btn" data-note-preview>Add to notebook</button>':'')+'</div><p id="lab-method" class="small-text"></p></section>'+
    '<details class="card panel lab-settings"><summary>Publication settings and series styles</summary><div class="lab-fields">'+input('title','Figure title')+input('xlabel','X axis label')+input('ylabel','Y axis label')+select('font','Typeface',['Arial','Georgia','Verdana'])+input('size','Font (pt)','number','min="6" max="24"')+input('width','Width (mm)','number','min="60" max="400"')+input('height','Height (mm)','number','min="50" max="400"')+
    ['xmin','xmax','ymin','ymax','xtick','ytick'].map((k,i)=>input(k,['X minimum','X maximum','Y minimum','Y maximum','X tick interval','Y tick interval'][i],'number','step="any" placeholder="Automatic"')).join('')+check('logx','Log X')+check('logy','Log Y')+check('gray','Grayscale')+check('grid','Gridlines')+(trend?check('fit','Show fitted curves'):'')+'</div><p class="small-text">Log tick intervals are in powers of ten. Category axes use the dataset order.</p><div id="lab-styles"></div></details>'+
    '<section class="card panel lab-output"><div class="lab-head"><h2>Results</h2>'+button('results','Download results CSV')+'</div><div id="lab-headline" aria-live="polite"></div><details><summary>Detailed results and coefficients</summary><div id="lab-results"></div></details></section>'+
    '<dialog class="dialog" id="lab-note-preview" aria-labelledby="lab-preview-heading"><div class="dialog-inner"><h2 id="lab-preview-heading">Preview notebook entry</h2><div id="lab-preview-figure"></div>'+input('caption','Figure caption')+'<h3>Results</h3><div id="lab-preview-results"></div><div class="rf-tools"><button class="tiny-btn" data-preview-close>Cancel</button>'+button('notebook','Save to notebook')+'</div></div></dialog></div>';
}
function labQuality(a,d,m){
  const found=new Set();let dup=0;for(const r of d.rows){const k=JSON.stringify(r);if(found.has(k))dup++;found.add(k);}
  const types=['Auto','Numeric','Number (grouped)','Text'];
  return '<p>'+dup+' repeated rows (retained)'+(a.mode===labModes[5]?' · Identical text–theme entries may represent separate coded occurrences.':'')+' · '+new Set(m.issues.map(i=>i[0])).size+' rows flagged for the selected analysis.</p><div class="lab-scroll"><table class="task-table"><tr><th>Column</th><th>Detected</th><th>Blank</th><th>Interpret as</th><th>Unit</th></tr>'+d.headers.map((h,i)=>{
    const filled=d.rows.map(r=>r[i]).filter(Boolean),n=filled.filter(s=>Number.isFinite(labNum(s))).length;
    return '<tr><td>'+esc(h)+'</td><td>'+(n===0?'Text':n===filled.length?'Numeric':'Mixed')+'</td><td>'+(d.rows.length-filled.length)+'</td><td><select data-lab-type="'+i+'" aria-label="Type for '+esc(h)+'">'+labOptions(types,a.types[i]||'Auto')+'</select></td><td><input data-lab-unit="'+i+'" aria-label="Units for '+esc(h)+'" value="'+esc(a.units[i]||'')+'"></td></tr>';}).join('')+'</table></div><h3>First '+Math.min(20,d.rows.length)+' rows</h3>'+labTable(d.headers,d.rows.slice(0,20))+(m.issues.length?'<h3 tabindex="-1" id="lab-flagged">Flagged rows</h3>'+labTable(['Spreadsheet row','Reason',...d.headers],m.issues.slice(0,100).map(([n,why])=>[n,why,...d.rows[n-2]]))+(m.issues.length>100?'<button class="tiny-btn" data-lab-action="issues">Download all flagged rows</button>':''):'');
}
function drawAnalysis(){
  if(!$('lab-plot'))return;
  const a=analysisDraft(),d=analysisRows(a.csv),m=labCompute(a,d);
  try{$('lab-plot').innerHTML=labFigure(a,m);}catch(e){$('lab-plot').textContent=e.message;}
  labChoosePane(labPanes.get(a)||'Figure');
  $('lab-plot').querySelectorAll('[data-axis-edit],[data-legend-edit]').forEach(t=>{t.setAttribute('tabindex','0');t.setAttribute('role','button');t.setAttribute('aria-label','Edit '+(t.dataset.axisEdit||'legend')+' · '+t.textContent);});
  $('lab-export-spec').textContent=a.width+' × '+a.height+' mm · '+a.font+' '+a.size+' pt · 300 DPI: '+Math.round(a.width*300/25.4)+' × '+Math.round(a.height*300/25.4)+' pixels · 600 DPI: '+Math.round(a.width*600/25.4)+' × '+Math.round(a.height*600/25.4)+' pixels';
  $('lab-method').textContent=m.message+(m.labels.length>30?' Figure displays the first 30 categories. All categories are in the results export.':'')+(a.logx||a.logy?' Log axes display positive values only.':'');
  $('lab-headline').innerHTML=m.highlights.length?'<p><strong>'+esc(m.highlights[0])+'</strong></p>'+(m.highlights.length>1?'<details><summary>More results</summary>'+m.highlights.slice(1,30).map(v=>'<p>'+esc(v)+'</p>').join('')+'</details>':''):'<p>See the detailed results and row checks for this selection.</p>';
  $('lab-results').innerHTML=labTable(['Series / group','Measure','Result'],m.results.slice(0,250))+(m.results.length>250?'<p>First 250 entries shown. Download the full table above.</p>':'');
  const excluded=d.rows.length-m.used.size;
  const warnings=new Set(m.issues.map(r=>r[0]));
  $('lab-coverage').innerHTML=m.used.size+' of '+d.rows.length+' rows used in '+(a.mode===labModes[0]?'fitted models':'the analysis')+' · '+excluded+' fully excluded'+(warnings.size?' · <button class="text-link" data-review-rows>Review '+warnings.size+' flagged '+(warnings.size===1?'row':'rows')+'</button>':'');
  $('lab-quality').innerHTML=labQuality(a,d,m);
  $('lab-styles').innerHTML=m.series.slice(0,60).map((s,i)=>{const st=labStyle(a,s.key,i),attr=' data-series="'+esc(s.key)+'" ';return '<fieldset><legend>'+esc(s.key)+'</legend><div class="lab-fields"><label>Legend label<input class="field"'+attr+'data-style="label" value="'+esc(st.label)+'"></label><label>Colour<input type="color"'+attr+'data-style="color" value="'+st.color+'"></label><label>Series display<select'+attr+'data-style="geometry">'+labOptions(['Use chart setting','Markers only','Line only','Line and markers'],st.geometry)+'</select></label><label>Stroke<select'+attr+'data-style="dash">'+labOptions(['Solid','Dashed','Dotted'],st.dash)+'</select></label><label>Marker<select'+attr+'data-style="marker">'+labOptions(['Circle','Square','Triangle','Diamond','None'],st.marker)+'</select></label><label>Line width<input type="number" min=".4" max="6" step=".2"'+attr+'data-style="weight" value="'+st.weight+'"></label></div></fieldset>';}).join('');
}
async function labReadExcel(file){
  const buf=await file.arrayBuffer(),v=new DataView(buf),bytes=new Uint8Array(buf),decode=new TextDecoder();
  let end=buf.byteLength-22;while(end>=Math.max(0,buf.byteLength-65557)&&v.getUint32(end,true)!==0x06054b50)end--;
  if(end<0||v.getUint32(end,true)!==0x06054b50)throw Error('Choose a valid .xlsx workbook.');
  let ptr=v.getUint32(end+16,true);const entries=new Map();
  for(let i=0;i<v.getUint16(end+10,true);i++){
    if(v.getUint32(ptr,true)!==0x02014b50)throw Error('Invalid workbook directory.');
    const n=v.getUint16(ptr+28,true),name=decode.decode(bytes.subarray(ptr+46,ptr+46+n));
    entries.set(name,[v.getUint32(ptr+42,true),v.getUint32(ptr+20,true),v.getUint32(ptr+24,true),v.getUint16(ptr+10,true)]);
    ptr+=46+n+v.getUint16(ptr+30,true)+v.getUint16(ptr+32,true);
  }
  async function xml(name){
    const e=entries.get(name);if(!e)throw Error('Workbook entry unavailable: '+name);
    const [offset,len,size,method]=e;if(size>16e6||![0,8].includes(method))throw Error('Workbook sheet is too large or uses unsupported compression.');
    const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);
    let stream=new Blob([bytes.subarray(start,start+len)]).stream();if(method===8)stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader=stream.getReader(),parts=[];let count=0;
    for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>16e6){await reader.cancel();throw Error('Workbook XML exceeds 16 MB.');}parts.push(value);}
    const doc=new DOMParser().parseFromString(await new Blob(parts).text(),'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid workbook XML.');return doc;
  }
  const tags=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
  const workbook=await xml('xl/workbook.xml'),rels=tags(await xml('xl/_rels/workbook.xml.rels'),'Relationship');
  const sheets=tags(workbook,'sheet').map(s=>{const id=s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),r=rels.find(r=>r.getAttribute('Id')===id),target=r?.getAttribute('Target')||'';
    return {name:s.getAttribute('name'),path:target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'')};}).filter(s=>entries.has(s.path));
  if(!sheets.length)throw Error('No worksheets found.');
  const strings=entries.has('xl/sharedStrings.xml')?tags(await xml('xl/sharedStrings.xml'),'si').map(si=>tags(si,'t').map(n=>n.textContent).join('')):[];
  return {sheets,async read(i,header){
    const rows=tags(await xml(sheets[i].path),'row'),data=[];let columns=0;
    if(!Number.isInteger(header)||header<1||!rows.some(r=>Number(r.getAttribute('r'))===header))throw Error('Select a populated header row.');
    for(const row of rows){if(+row.getAttribute('r')<header)continue;const arr=[];
      for(const c of tags(row,'c')){const letters=(c.getAttribute('r')||'').match(/^[A-Z]+/)?.[0]||'A';let index=0;for(const l of letters)index=index*26+l.charCodeAt(0)-64;
        if(index>512)throw Error('Select a sheet with at most 512 columns.');
        const type=c.getAttribute('t'),raw=tags(c,'v')[0]?.textContent??'';arr[index-1]=type==='s'?strings[+raw]??'':type==='inlineStr'?tags(c,'t').map(n=>n.textContent).join(''):raw;
      }if(arr.some(v=>String(v).trim())){columns=Math.max(columns,arr.length);data.push(arr);}
    }
    if(data.length*columns>1e6)throw Error('Choose a smaller worksheet.');
    return labCsv(data.map(r=>Array.from({length:columns},(_,i)=>r[i]??'')));
  }};
}
function labLoadData(text,name,sourceId=0){
  if(text.length>8e6)throw Error('Select a dataset under 8 MB.');
  const d=analysisRows(text),a=analysisDraft();Object.assign(a,labDefault(),{csv:text,name,source:name,sourceId,title:name,y:Math.min(1,d.headers.length-1)});
  delete a.pending;labDirty(a);labEntry.set(a,'work');render();
}
function labRestore(obj){
  if(obj?.format!=='ResearchFlow analysis v2'||typeof obj.settings?.csv!=='string')throw Error('Unrecognised analysis snapshot.');
  const s=obj.settings,d=analysisRows(s.csv),a=labDefault();
  for(const key of Object.keys(a)){
    if(typeof a[key]==='string'&&typeof s[key]==='string')a[key]=key==='csv'?s[key]:s[key].slice(0,2000);
    if(typeof a[key]==='boolean'&&typeof s[key]==='boolean')a[key]=s[key];
  }
  const idx=(v,def)=>Number.isInteger(+v)&&+v>=0&&+v<d.headers.length?+v:def;
  for(const k of ['x','y','category','group','word'])a[k]=idx(s[k],['group','word'].includes(k)?-1:0);
  a.more=Array.isArray(s.more)?s.more.map(x=>idx(x,-1)).filter(x=>x>=0):[];
  for(const [k,lo,hi] of [['width',60,400],['height',50,400],['size',6,24]])a[k]=Math.max(lo,Math.min(hi,labNum(s[k])||a[k]));
  a.sourceId=Number(s.sourceId)||0;
  for(const k of ['styles','units','types']){a[k]=Object.create(null);for(const [name,v] of Object.entries(s[k]||{})){if(['__proto__','constructor','prototype'].includes(name))continue;
      if(k==='styles'){if(v&&typeof v==='object')a[k][name]=Object.fromEntries(Object.entries(v).filter(([key,val])=>['label','dash','marker','weight','color','geometry'].includes(key)&&['string','number'].includes(typeof val)));}
      else if(typeof v==='string')a[k][name]=v.slice(0,200);}}
  if(!labModes.includes(a.mode)||!labMethods.includes(a.method))throw Error('Unknown analysis method.');
  Object.assign(analysisDraft(),a);delete analysisDraft().pending;
}
async function labOpen(file,id=0){
  const a=analysisDraft();if(file.size>12e6)throw Error('Select a file under 12 MB.');
  if(/\.xlsx$/i.test(file.name)){const w=await labReadExcel(file);if(analysisDraft()!==a)return;
    labEntry.set(a,'work');labWorkbook={...w,owner:a,index:0,header:1,name:file.name,id};goto('analysis');toast('Choose the worksheet and header row, then use the sheet.');return;}
  const text=await file.text();if(analysisDraft()!==a)return;
  if(/\.analysis\.txt$/i.test(file.name)){labRestore(JSON.parse(text));labPersist(a,'Version saved to workspace');labEntry.set(a,'work');labWorkbook=null;goto('analysis');}
  else{labWorkbook=null;goto('analysis');labLoadData(text,file.name,id);}
}
async function labOpenId(id){
  const a=analysisDraft(),f=state.data.files.find(f=>f.id===Number(id));if(!f)throw Error('File unavailable in this workspace.');
  const response=await fetch('/api/files/'+f.id+'/download');if(!response.ok)throw Error('Could not open the workspace file.');
  const blob=await response.blob();if(analysisDraft()===a)await labOpen(new File([blob],f.original_name),f.id);
}
const labStem=name=>String(name).replace(/[^\p{L}\p{N} ._-]/gu,'').trim().slice(0,65)||'Analysis';
async function labUpload(blob,name){
  const form=new FormData();form.append('file',new File([blob],name,{type:blob.type}));const r=await api('/files',{method:'POST',body:form,form:true});return r.id;
}
async function labSave(a){
  if(a.pending!==undefined&&a.pending!==a.csv)throw Error('Apply your edited data before saving a version.');
  const settings={...a};delete settings.pending;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  return labUpload(new Blob([JSON.stringify({format:'ResearchFlow analysis v2',savedAt:stamp,settings})],{type:'text/plain'}),labStem(a.name)+' '+stamp+(a.versionNote?' -- '+labStem(a.versionNote).slice(0,45):'')+'.analysis.txt');
}
function labDownload(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function labSvgBlob(){const svg=$('analysis-svg');if(!svg)throw Error('Create a valid figure first.');return new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'});}
async function labPng(a,dpi){
  const svg=$('analysis-svg');if(!svg)throw Error('Create a valid figure first.');
  const canvas=document.createElement('canvas');canvas.width=Math.round(+a.width*dpi/25.4);canvas.height=Math.round(+a.height*dpi/25.4);
  if(canvas.width*canvas.height>4e7)throw Error('Reduce the dimensions for this resolution.');
  const ctx=canvas.getContext('2d'),vb=svg.viewBox.baseVal;ctx.scale(canvas.width/vb.width,canvas.height/vb.height);
  ctx.fillStyle='white';ctx.fillRect(0,0,vb.width,vb.height);
  function paint(el){
    const tag=el.localName;if(tag==='defs')return;
    const attr=k=>el.getAttribute(k),n=k=>Number(attr(k))||0;
    ctx.save();
    if(attr('clip-path')){const c=svg.querySelector('clipPath rect');ctx.beginPath();ctx.rect(+c.getAttribute('x'),+c.getAttribute('y'),+c.getAttribute('width'),+c.getAttribute('height'));ctx.clip();}
    if(el.transform?.baseVal.numberOfItems){for(const t of Array.from(el.transform.baseVal)){const m=t.matrix;ctx.transform(m.a,m.b,m.c,m.d,m.e,m.f);}}
    ctx.fillStyle=attr('fill')||svg.getAttribute('fill');ctx.strokeStyle=attr('stroke')||'#273738';ctx.lineWidth=n('stroke-width')||1;
    if(attr('stroke-dasharray'))ctx.setLineDash(attr('stroke-dasharray').split(/ +/).map(Number));
    if(tag==='g'){for(const child of el.children)paint(child);}
    else if(tag==='text'){ctx.font=(attr('font-weight')||'normal')+' '+(n('font-size')||+svg.getAttribute('font-size'))+'px '+svg.getAttribute('font-family');ctx.textAlign=({'end':'right','middle':'center'})[attr('text-anchor')]||'left';ctx.fillText(el.textContent,n('x'),n('y'));}
    else if(tag==='path')ctx.stroke(new Path2D(attr('d')));
    else if(tag==='line'){ctx.beginPath();ctx.moveTo(n('x1'),n('y1'));ctx.lineTo(n('x2'),n('y2'));ctx.stroke();}
    else if(tag==='rect'&&attr('width')!=='100%')ctx.fillRect(n('x'),n('y'),n('width'),n('height'));
    else if(tag==='circle'){ctx.beginPath();ctx.arc(n('cx'),n('cy'),n('r'),0,Math.PI*2);ctx.fill();}
    else if(tag==='polygon'){ctx.beginPath();for(let i=0;i<el.points.numberOfItems;i++){const p=el.points.getItem(i);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}ctx.closePath();ctx.fill();}
    ctx.restore();
  }
  for(const el of svg.children)paint(el);
    const blob=await new Promise((ok,fail)=>canvas.toBlob(b=>b?ok(b):fail(Error('PNG export failed.')),'image/png'));
    const bytes=new Uint8Array(await blob.arrayBuffer()),chunk=new Uint8Array(21),view=new DataView(chunk.buffer);view.setUint32(0,9);chunk.set([112,72,89,115],4);view.setUint32(8,Math.round(dpi/.0254));view.setUint32(12,Math.round(dpi/.0254));chunk[16]=1;
    let crc=0xffffffff;for(const byte of chunk.slice(4,17)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}view.setUint32(17,(crc^0xffffffff)>>>0);
    const parts=[bytes.slice(0,33),chunk],dv=new DataView(bytes.buffer);for(let i=33;i<bytes.length;){const n=dv.getUint32(i)+12;if(String.fromCharCode(...bytes.slice(i+4,i+8))!=='pHYs')parts.push(bytes.slice(i,i+n));i+=n;}return new Blob(parts,{type:'image/png'});
}
function labPrint(){
  const svg=$('analysis-svg');if(!svg)throw Error('Create a figure first.');
  const frame=document.createElement('iframe');frame.style.cssText='position:fixed;width:1px;height:1px;bottom:0;right:0;border:0';document.body.append(frame);
  const doc=frame.contentDocument,style=doc.createElement('style');const a=analysisDraft();style.textContent='@page{size:'+a.width+'mm '+a.height+'mm;margin:0}body{margin:0}svg{display:block}';doc.head.append(style);doc.body.append(doc.importNode(svg,true));frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow.print();
}
function labUpdate(key,value){
  const a=analysisDraft();a[key]=value;
  if(['x','y','word','group','category'].includes(key))a[key]=Number(value);
  if(['mode','group','y','frequency','method'].includes(key))render();else drawAnalysis();
}
document.addEventListener('input',e=>{
  const el=e.target;
  if(!el.closest('#analysis-lab'))return;
  const a=analysisDraft();
  if(el.id==='lab-csv')a.pending=el.value;
  if(el.type==='text'&&el.dataset.lab)a[el.dataset.lab]=el.value;
  if(el.dataset.labUnit!==undefined)a.units[el.dataset.labUnit]=el.value;
  if(el.dataset.style==='label'){
    a.styles=Object.assign(Object.create(null),a.styles);
    a.styles[el.dataset.series]={...Object.getOwnPropertyDescriptor(a.styles,el.dataset.series)?.value,label:el.value};
  }
});
document.addEventListener('change',async e=>{
  const el=e.target;if(!el.closest('#analysis-lab'))return;
  try{
    const a=analysisDraft(),d=el.dataset;
    if(d.lab){if(el.type==='number'&&!el.checkValidity())return el.reportValidity();labUpdate(d.lab,el.type==='checkbox'?el.checked:el.value);}
    else if(d.labMore!==undefined){a.more=a.more.filter(i=>i!==+d.labMore);if(el.checked)a.more.push(+d.labMore);drawAnalysis();}
    else if(d.series!==undefined){a.styles=Object.assign(Object.create(null),a.styles);a.styles[d.series]={...Object.getOwnPropertyDescriptor(a.styles,d.series)?.value,[d.style]:el.value};drawAnalysis();}
    else if(d.labType!==undefined){a.types[d.labType]=el.value;drawAnalysis();}
    else if(d.labUnit!==undefined){a.units[d.labUnit]=el.value;drawAnalysis();}
    else if(el.id==='lab-upload'&&el.files[0])await labOpen(el.files[0]);
    else if(['lab-saved','lab-source'].includes(el.id)&&el.value)await labOpenId(el.value);
  }catch(err){toast(err.message,true);}
});
document.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-lab-action],[data-lab-file]');if(!btn)return;btn.disabled=true;
  try{
    if(btn.dataset.labFile){await labOpenId(btn.dataset.labFile);return;}
    const a=analysisDraft(),act=btn.dataset.labAction,stem=labStem(a.name);
    if(act==='apply'){labLoadData($('lab-csv').value,'Edited dataset',a.sourceId);return;}
    if(act==='sheet'){const w=labWorkbook,index=+$('lab-sheet').value,header=+$('lab-header').value;
      const text=await w.read(index,header);if(analysisDraft()!==a)return;w.index=index;w.header=header;labLoadData(text,w.name+' · '+w.sheets[index].name+' · row '+header,w.id);return;}
    if(act==='human'){labLoadData('Text,Theme,Words\nText A,Education,2000\nText A,Education,2000\nText A,Labour,2000\nText B,Education,4000\nText B,Labour,4000\nText B,Labour,4000','Example · coded passages');Object.assign(a,{mode:labModes[5],category:1,group:0,word:2,title:'Themes across two texts'});render();return;}
    if(act==='duplicate'){a.name+=' (copy)';labDirty(a);render();toast('Copy ready. Save version to keep it.');return;}
    if(act==='save'){const key=labLocalKey(),before=JSON.stringify(a);await labSave(a);if(before===JSON.stringify(a))labPersist(a,'Version saved to workspace',key);await reload();toast('Analysis version saved in the workspace.');return;}
    const model=labCompute(a,analysisRows(a.csv));
    if(act==='results'||act==='issues'){labDownload(new Blob([labCsv(act==='results'?[['Series','Measure','Result'],...model.results]:[['Row','Reason'],...model.issues])],{type:'text/csv'}),stem+'-'+act+'.csv');return;}
    if(act==='svg'){labDownload(labSvgBlob(),stem+'.svg');return;}
    if(act.startsWith('png')){labDownload(await labPng(a,Number(act.slice(3))),stem+'-'+act.slice(3)+'dpi.png');return;}
    if(act==='pdf'){labPrint();return;}
    if(act==='notebook'){
      const cap=$('lab-note-preview')?.querySelector('[data-lab="caption"]')?.value||a.caption||a.title,stamp=Date.now(),png=await labPng(a,300);if(analysisDraft()!==a)return;
      const snapshot=await labSave(a);if(analysisDraft()!==a)return;
      const figure=await labUpload(png,stem+' figure '+stamp+'.png');if(analysisDraft()!==a)return;
      const full=labCsv([['Series','Measure','Result'],...model.results]),tableText=model.results.slice(0,30).map(row=>'|'+row.map(x=>String(x).slice(0,60).replaceAll('|','¦')).join('|')+'|').join('\n');
      const result=await labUpload(new Blob([full],{type:'text/csv'}),stem+' results '+stamp+'.csv');if(analysisDraft()!==a)return;
      const blocks=[{type:'Text',value:cap+'\n[[file:'+figure+']]\nAnalysis version [[file:'+snapshot+']] · Full results [[file:'+result+']]'+(a.sourceId?' · Source [[cite:'+a.sourceId+']]':'')},{type:'Table',value:'|Series|Measure|Result|\n'+tableText}];
      await api('/notes',{method:'POST',body:{body:serializeBlocks(blocks),sourceId:snapshot}});await reload();toast('Figure, caption and results saved to the notebook.');}
  }catch(err){toast(err.message,true);}finally{btn.disabled=false;}
});
const analysisStyle=document.createElement('style');
analysisStyle.textContent='#analysis-lab{display:grid;gap:16px}#analysis-lab h2{font-size:18px;margin:0 0 14px}#analysis-lab .lab-head{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}#analysis-lab .lab-head span{color:#526862;font-size:13px}.lab-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;align-items:end;margin:12px 0}#analysis-lab .field{display:block;width:100%;margin-top:4px}#analysis-lab label,#analysis-lab legend{font-size:13px}#analysis-lab summary{cursor:pointer;font-weight:600}#analysis-lab fieldset{border:1px solid #d8e1dd;margin:12px 0;padding:8px 12px;border-radius:8px}.lab-scroll{max-height:360px;overflow:auto}.lab-inline{display:inline-block;padding:.4rem}#lab-plot{overflow:auto;text-align:center}#analysis-svg{width:auto;height:auto;max-width:100%}#analysis-lab .rf-tools{margin-top:14px}#analysis-lab textarea{font-family:monospace}.lab-note-figure{display:block;width:min(100%,700px);height:auto}';
document.head.append(analysisStyle);
for(const sibling of document.querySelectorAll('button[data-page="activity"]')){
 const tab=sibling.cloneNode(false);tab.dataset.page='analysis';tab.innerHTML='<span aria-hidden="true">∿</span> Data analysis';sibling.before(tab);
}

const labPanes=new WeakMap();
function labChoosePane(pane){
  const root=$('analysis-lab');if(!root)return;
  labPanes.set(analysisDraft(),pane);root.dataset.pane=pane;
  root.querySelectorAll('[data-pane-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.paneChoice===pane)));
}
function labEditLabel(el){
  const root=$('analysis-lab'),panel=root.querySelector('.lab-settings');labChoosePane('Figure');panel.open=true;
  const field=el.hasAttribute('data-axis-edit')?panel.querySelector('[data-lab="'+el.dataset.axisEdit+'"]'):[...panel.querySelectorAll('[data-style="label"]')].find(f=>f.dataset.series===el.dataset.legendEdit);
  if(field){field.focus();field.select();field.scrollIntoView({block:'nearest'});}
}
document.addEventListener('click',e=>{
  if(e.target.closest('[data-review-rows]')){labChoosePane('Data');document.querySelector('.lab-quality').open=true;$('lab-flagged')?.focus();}
  const tab=e.target.closest('[data-pane-choice]');if(tab)labChoosePane(tab.dataset.paneChoice);
  const text=e.target.closest('#lab-plot [data-axis-edit],#lab-plot [data-legend-edit]');if(text)labEditLabel(text);
});
document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('#lab-plot [data-axis-edit],#lab-plot [data-legend-edit]')){e.preventDefault();labEditLabel(e.target);}});
analysisStyle.textContent+=`
#analysis-lab.lab-editor{grid-template-columns:minmax(195px,0.8fr) minmax(0,2fr);align-items:start;grid-template-areas:"data data" "quality quality" "question chart" "settings output" "note note"}
.lab-data{grid-area:data}.lab-quality{grid-area:quality}.lab-question{grid-area:question}.lab-chart{grid-area:chart}.lab-settings{grid-area:settings}.lab-output{grid-area:output}.lab-notebook{grid-area:note}.lab-tabs{display:none}
#lab-plot [data-axis-edit],#lab-plot [data-legend-edit]{cursor:text}#lab-plot text:focus{outline:2px solid #167478}
@media(max-width:850px){#analysis-lab.lab-editor{display:flex;flex-direction:column;align-items:stretch}.lab-editor .lab-tabs{display:flex;gap:6px;position:sticky;top:0;background:white;padding:8px;z-index:2}.lab-tabs [aria-pressed=true]{background:#244d47;color:white}.lab-editor[data-pane]>.card{display:none}.lab-editor[data-pane=Data]>.lab-data,.lab-editor[data-pane=Data]>.lab-quality,.lab-editor[data-pane=Figure]>.lab-question,.lab-editor[data-pane=Figure]>.lab-chart,.lab-editor[data-pane=Figure]>.lab-settings,.lab-editor[data-pane=Results]>.lab-output,.lab-editor[data-pane=Results]>.lab-notebook{display:block}}`;
for(const kind of ['input','change'])document.addEventListener(kind,e=>{
  if(e.target.matches('#lab-csv,[data-lab],[data-style],[data-lab-more],[data-lab-unit],[data-lab-type]'))labDirty(analysisDraft());
});
window.addEventListener('pagehide',()=>{if(!state.user)return;const a=analysisDraft();if(labStatus.get(a)==='Unsaved changes')labPersist(a);});
document.addEventListener('click',e=>{
  if(e.target.closest('[data-preview-close]')){$('lab-note-preview')?.close();return;}
  if(!e.target.closest('[data-note-preview]'))return;
  const svg=$('analysis-svg');if(!svg){toast('Create a figure before adding it to the notebook.',true);return;}
  const a=analysisDraft(),model=labCompute(a,analysisRows(a.csv)),copy=svg.cloneNode(true);
  copy.removeAttribute('id');copy.querySelectorAll('[tabindex]').forEach(el=>{el.removeAttribute('tabindex');el.removeAttribute('role');el.removeAttribute('data-axis-edit');el.removeAttribute('data-legend-edit');});
  const clip=copy.querySelector('clipPath');if(clip)clip.id='lab-preview-clip';copy.querySelectorAll('[clip-path]').forEach(el=>el.setAttribute('clip-path','url(#lab-preview-clip)'));
  $('lab-preview-figure').replaceChildren(copy);const dialog=$('lab-note-preview');
  const caption=dialog.querySelector('[data-lab="caption"]');caption.value=a.caption||a.title;
  $('lab-preview-results').innerHTML=labTable(['Series / group','Measure','Result'],model.results.slice(0,30))+'<p>The entry includes a fixed figure and analysis version. All '+model.results.length+' result rows are attached as CSV.</p>';
  dialog.showModal();
});
analysisStyle.textContent+=`.lab-export summary{display:list-item;cursor:pointer}.lab-export[open]{flex:1 1 100%}#lab-note-preview{width:min(760px,96vw);max-height:92dvh;overflow:auto}#lab-preview-figure svg{display:block;max-width:100%;height:auto;margin:auto}#lab-preview-results .lab-scroll{max-height:210px}`;
function personalKey(part){return 'rf.'+part+'.'+JSON.stringify([state.user.id,state.workspace?.id]);}
function readPersonal(part,fallback){try{return JSON.parse(localStorage.getItem(personalKey(part)))??fallback;}catch{return fallback;}}
function writePersonal(part,value){try{localStorage.setItem(personalKey(part),JSON.stringify(value));}catch{}}
function rememberResearch(kind,id){
  if(!state.user||!state.workspace||!id)return;
  const recent=readPersonal('recent',[]).filter(r=>r.kind!==kind||r.id!==id);
  writePersonal('recent',[{kind,id},...recent].slice(0,10));
}
function continuePanel(){
  const a=analysisDraft(),items=[];
  if(labHasLocal.has(a))items.push('<button class="tiny-btn" data-resume-draft>Device draft · '+esc(a.name)+'</button>');
  readPersonal('recent',[]).forEach(({kind,id})=>{
    const f=kind==='file'&&state.data.files.find(x=>x.id===id);
    if(f&&labSaved(f))items.push('<button class="tiny-btn" data-lab-file="'+id+'">Workspace version · '+esc(f.original_name)+'</button>');
    else if(['task','note','file'].includes(kind)){const link=recordLink(kind,id);if(link)items.push(link);}
  });
  return '<section class="card panel section-spacer"><h2>Continue research</h2>'+(items.length?items.join(' '):'<p>Your recently opened tasks, sources and notebook entries will appear here.</p>')+'</section>';
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||!state.user)return;const d=b.dataset;
  if(b.hasAttribute('data-resume-draft')){labEntry.set(analysisDraft(),'work');goto('analysis');}
  if(d.record)rememberResearch(d.record,Number(d.recordId));
  else if(d.labFile||d.preview||d.reviewFile)rememberResearch('file',Number(d.labFile||d.preview||d.reviewFile));
  else if(d.editNote)rememberResearch('note',Number(d.editNote));
  else if(d.edit)rememberResearch('task',Number(d.edit));
},true);
document.addEventListener('change',e=>{if(['lab-saved','lab-source'].includes(e.target.id))rememberResearch('file',Number(e.target.value));});
function upcomingPanel(){
  const open=state.data.tasks.filter(t=>t.status!=='Done'),deps=state.data.dependencies||[];
  const dated=open.filter(t=>t.due_date).sort((a,b)=>a.due_date.localeCompare(b.due_date));
  const blocked=open.map(t=>[t,deps.filter(d=>d.successor===t.id).map(d=>open.find(x=>x.id===d.predecessor)).filter(Boolean)]).filter(([t,parents])=>parents.length||t.status==='Blocked');
  const review=open.filter(t=>/review|revision/i.test(t.phase+' '+t.title));
  const milestones=open.filter(t=>/milestone|deadline|submission|defen[cs]e/i.test(t.title));
  const links=arr=>arr.map(t=>'<li>'+recordLink('task',t.id)+' · '+esc(t.due_date||'Unscheduled')+' · '+esc(t.assignee_name||'Unassigned')+'</li>').join('');
  return '<section class="card panel section-spacer"><h2>Upcoming and decisions</h2>'+
    (dated.length?'<h3>Upcoming due dates</h3><ul>'+links(dated)+'</ul>':'<p>No scheduled open tasks.</p>')+
    (milestones.length?'<h3>Milestone tasks</h3><ul>'+links(milestones)+'</ul>':'')+
    (review.length?'<h3>Review work</h3><ul>'+links(review)+'</ul>':'')+
    (blocked.length?'<h3>Blockers</h3>'+blocked.map(([t,p])=>'<p>'+recordLink('task',t.id)+' · '+esc(t.assignee_name||'Unassigned')+' · '+(p.length?'Waiting on '+p.map(x=>recordLink('task',x.id)).join(' '):esc(t.description||'Open task to record the reason'))+'</p>').join(''):'<p>No open blockers.</p>')+'</section>';
}
let selectedConnection='';
function focusedGraph(){
  const {tasks,files,notes,runs=[],dependencies=[]}=state.data,nodes=new Map();
  function add(kind,id,label){nodes.set(kind+':'+id,{kind,id,label,links:new Set()});}
  function edge(a,b){if(nodes.has(a)&&nodes.has(b)){nodes.get(a).links.add(b);nodes.get(b).links.add(a);}}
  tasks.forEach(t=>add('task',t.id,t.title));files.forEach(f=>add('file',f.id,f.original_name));notes.forEach(n=>add('note',n.id,n.body));
  tasks.forEach(t=>(t.source_ids||[]).forEach(id=>edge('task:'+t.id,'file:'+id)));
  notes.forEach(n=>{[n.task_id,...(n.task_ids||[])].forEach(id=>edge('note:'+n.id,'task:'+id));[n.source_id,...(n.source_ids||[])].forEach(id=>edge('note:'+n.id,'file:'+id));});
  runs.forEach(r=>edge('task:'+r.task_id,'file:'+r.output_id));dependencies.forEach(d=>edge('task:'+d.successor,'task:'+d.predecessor));
  const cur=nodes.get(selectedConnection)||nodes.values().next().value;
  if(!cur)return '<h3>Connected research</h3><p>Add a research record to see connections.</p>';
  const short=n=>(n.label||'Untitled').split('\n')[0].slice(0,68);
  return '<section><h3>Connected research</h3><label>Focus record <select class="field" id="connection-focus">'+[...nodes].map(([k,n])=>'<option value="'+esc(k)+'" '+(n===cur?'selected':'')+'>'+esc(n.kind+' · '+short(n))+'</option>').join('')+'</select></label><p>'+esc((cur.label||'').slice(0,220))+'</p>'+recordLink(cur.kind,cur.id)+'<h4>Direct connections</h4>'+([...cur.links].map(k=>{const n=nodes.get(k);return recordLink(n.kind,n.id);}).join(' ')||'No linked records yet.')+'<details><summary>Explore full graph</summary>'+graphView()+'</details></section>';
}
document.addEventListener('change',e=>{if(e.target.id==='connection-focus'){selectedConnection=e.target.value;render();$('connection-focus').focus();}});
const visitCutoffs=new Map();let sinceVisit=false;
function handoverActivity(){
  const key=personalKey('visit');if(!visitCutoffs.has(key))visitCutoffs.set(key,readPersonal('visit',null));
  const now=new Date().toISOString();writePersonal('visit',now);
  const cutoff=visitCutoffs.get(key),groups=new Map();
  for(const row of state.data.activities){if(sinceVisit&&cutoff&&new Date(row.created_at)<=new Date(cutoff))continue;
    const k=[row.actor_name,row.record_kind,new Date(row.created_at).toLocaleDateString()].join('|');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
  return '<h3>Research handover</h3><label><input type="checkbox" id="since-visit" '+(sinceVisit?'checked':'')+'> Since my last visit</label>'+([...groups.values()].slice(0,8).map(g=>g.length===1?activityRows(g):'<details><summary>'+esc(g[0].actor_name||'Workspace')+' · '+g.length+' '+esc(g[0].record_kind||'workspace')+' updates · '+esc(new Date(g[0].created_at).toLocaleDateString())+'</summary>'+activityRows(g)+'</details>').join('')||'<p>No new activity.</p>');
}
document.addEventListener('change',e=>{if(e.target.id==='since-visit'){sinceVisit=e.target.checked;render();}});
document.addEventListener('click',e=>{
  const action=e.target.closest('[data-overview-action]')?.dataset.overviewAction;if(!action)return;
  if(action==='source'){goto('files');$('drop-zone')?.scrollIntoView();$('browse-files')?.focus();return;}
  if(action==='note'){goto('notes');$('reset-draft')?.click();$('note-form')?.querySelector('textarea')?.focus();return;}
  const t=state.data.tasks.filter(t=>t.status!=='Done'&&t.assignee_id===state.user.id).sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'))[0];
  const msg=action==='summary'?'Summarise workspace activity since '+(visitCutoffs.get(personalKey('visit'))||'the earliest recorded update'):t?'Show sources linked to task '+t.id+' '+t.title:'Show outstanding workspace tasks and their linked sources';
  goto('agent');handleAgent(msg);
});
boot();
