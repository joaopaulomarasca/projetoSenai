const STATUS_LABEL = {
  rascunho: 'Rascunho',
  em_validacao: 'Em validação',
  bloqueado_divergencia: 'Bloqueado (divergência)',
  aprovado: 'Aprovado',
  em_producao: 'Em produção',
  inspecao: 'Inspeção',
  expedido: 'Expedido',
  entregue: 'Entregue',
};

function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast active ' + type;
  setTimeout(() => el.classList.remove('active'), 4000);
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição.');
  return data;
}

// ---------- Navegação por abas ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + btn.dataset.view).classList.add('active');
  loadView(btn.dataset.view);
});

function loadView(view) {
  if (view === 'dashboard') loadDashboard();
  if (view === 'orders') loadOrders();
  if (view === 'pcp') loadPCP();
  if (view === 'passport') loadPassportSelect();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const d = await api('/pcp/dashboard');
  const cards = [
    ['Total de pedidos', d.totals, ''],
    ['Atrasados', d.late, d.late > 0 ? 'crit' : 'ok'],
    ['Próximos do prazo (10d)', d.dueSoon, d.dueSoon > 0 ? 'warn' : 'ok'],
    ['Pendências críticas abertas', d.criticalFindings, d.criticalFindings > 0 ? 'crit' : 'ok'],
  ];
  document.getElementById('dashCards').innerHTML = cards
    .map(([label, val, cls]) => `<div class="card"><h3>${label}</h3><div class="big ${cls}">${val}</div></div>`)
    .join('');

  document.getElementById('dashStatusTable').innerHTML =
    '<thead><tr><th>Status</th><th>Quantidade</th></tr></thead><tbody>' +
    d.byStatus.map((s) => `<tr><td><span class="badge ${s.status}">${STATUS_LABEL[s.status] || s.status}</span></td><td>${s.n}</td></tr>`).join('') +
    '</tbody>';

  document.getElementById('dashSectorTable').innerHTML =
    '<thead><tr><th>Setor</th><th>Pedidos em fila/execução</th></tr></thead><tbody>' +
    (d.bySector.length
      ? d.bySector.map((s) => `<tr><td>${s.name}</td><td>${s.n}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">Nenhuma atividade no momento.</td></tr>') +
    '</tbody>';
}

// ---------- Pedidos ----------
let ordersCache = [];

async function loadOrders() {
  ordersCache = await api('/orders');
  const tbody = document.getElementById('ordersTableBody');
  if (!ordersCache.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum pedido cadastrado ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = ordersCache
    .map(
      (o) => `
    <tr>
      <td><strong>${o.code}</strong></td>
      <td>${o.customer_name}${o.customer_company ? ' — ' + o.customer_company : ''}</td>
      <td>${o.due_at}</td>
      <td><span class="badge ${o.status}">${STATUS_LABEL[o.status] || o.status}</span></td>
      <td>${o.critical_findings > 0 ? `<span class="badge critico">${o.critical_findings} crítica(s)</span>` : '<span class="muted">—</span>'}</td>
      <td><a class="link" data-id="${o.id}">Ver detalhes</a></td>
    </tr>`
    )
    .join('');
  tbody.querySelectorAll('a.link').forEach((a) =>
    a.addEventListener('click', () => openOrderDetail(a.dataset.id))
  );
}

document.getElementById('btnNewOrder').addEventListener('click', () => {
  document.getElementById('modalNewOrder').classList.add('active');
});
document.getElementById('btnCancelOrder').addEventListener('click', () => {
  document.getElementById('modalNewOrder').classList.remove('active');
});

document.getElementById('btnSaveOrder').addEventListener('click', async () => {
  const body = {
    customer: {
      name: val('f_customer_name'),
      company: val('f_customer_company'),
      contact: val('f_customer_contact'),
    },
    due_at: val('f_due_at'),
    notes: val('f_notes'),
    spec: {
      width_mm_commercial: numOrNull('f_width_c'),
      width_mm_technical: numOrNull('f_width_t'),
      height_mm: numOrNull('f_height'),
      material: val('f_material'),
      canvas_type: val('f_canvas'),
      motor_model: val('f_motor'),
    },
  };
  if (!body.customer.name || !body.due_at) {
    toast('Preencha ao menos o nome do cliente e o prazo de entrega.', 'error');
    return;
  }
  try {
    const result = await api('/orders', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('modalNewOrder').classList.remove('active');
    toast(
      result.validation.blocked
        ? 'Pedido criado, mas BLOQUEADO por pendência crítica identificada pela validação.'
        : 'Pedido criado e validado.',
      result.validation.blocked ? 'error' : 'success'
    );
    loadOrders();
    openOrderDetail(result.orderId);
  } catch (e) {
    toast(e.message, 'error');
  }
});

function val(id) { return document.getElementById(id).value || null; }
function numOrNull(id) { const v = document.getElementById(id).value; return v === '' ? null : Number(v); }

async function openOrderDetail(id) {
  const data = await api('/orders/' + id);
  const { order, spec, stages, history, findings } = data;

  const findingsHtml = findings.length
    ? findings.map((f) => `<div class="finding ${f.level}"><span class="badge ${f.level}">${f.level}</span> ${f.message}</div>`).join('')
    : '<p class="muted">Nenhuma pendência em aberto.</p>';

  const stagesHtml = stages
    .map((s) => `<div class="stage-chip ${s.status}"><div class="name">${s.sector_name}</div><div class="status">${s.status.replace(/_/g, ' ')}</div></div>`)
    .join('');

  const stageActions = stages
    .filter((s) => s.status === 'pronto_para_iniciar' || s.status === 'em_execucao')
    .map(
      (s) => `<button class="btn secondary" data-stage="${s.id}" data-action="${s.status === 'pronto_para_iniciar' ? 'receive' : 'complete'}">
        ${s.status === 'pronto_para_iniciar' ? 'Confirmar recebimento' : 'Concluir'} — ${s.sector_name}
      </button>`
    )
    .join(' ');

  const historyHtml = history
    .slice(0, 12)
    .map(
      (h) => `<div class="history-item"><div>${h.action.replace(/_/g, ' ')}${h.field ? ' — ' + h.field : ''}${h.old_value || h.new_value ? `: "${h.old_value ?? ''}" → "${h.new_value ?? ''}"` : ''}</div><div class="meta">${h.actor} · ${h.created_at}${h.note ? ' · ' + h.note : ''}</div></div>`
    )
    .join('');

  const hasCritical = findings.some((f) => f.level === 'critico');

  document.getElementById('orderDetailContent').innerHTML = `
    <h2>${order.code} <span class="badge ${order.status}">${STATUS_LABEL[order.status] || order.status}</span></h2>
    <p class="muted">${order.customer_name}${order.customer_company ? ' — ' + order.customer_company : ''} · Prazo: ${order.due_at}</p>

    <h3 style="margin-top:20px;">Especificações</h3>
    <table>
      <tr><td class="muted">Largura (orçamento / técnico)</td><td>${spec?.width_mm_commercial ?? '—'} mm / ${spec?.width_mm_technical ?? '—'} mm</td></tr>
      <tr><td class="muted">Altura</td><td>${spec?.height_mm ?? '—'} mm</td></tr>
      <tr><td class="muted">Material</td><td>${spec?.material ?? '—'}</td></tr>
      <tr><td class="muted">Tipo de lona</td><td>${spec?.canvas_type ?? '—'}</td></tr>
      <tr><td class="muted">Motor</td><td>${spec?.motor_model ?? '—'}</td></tr>
    </table>

    <h3 style="margin-top:20px;">Validação inteligente</h3>
    ${findingsHtml}
    ${hasCritical
      ? '<p class="muted">Liberação bloqueada até que um responsável revise as pendências críticas acima.</p>'
      : order.status !== 'aprovado' && order.status !== 'entregue'
        ? '<button class="btn" id="btnApprove">Aprovar pedido (revisão humana)</button>'
        : ''}

    <h3 style="margin-top:20px;">Etapas de produção</h3>
    <div class="stage-track">${stagesHtml}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">${stageActions || '<span class="muted">Nenhuma ação de setor disponível agora.</span>'}</div>

    <h3 style="margin-top:20px;">Histórico / rastreabilidade</h3>
    <div>${historyHtml || '<p class="muted">Sem registros.</p>'}</div>
  `;

  document.getElementById('modalOrderDetail').classList.add('active');

  const approveBtn = document.getElementById('btnApprove');
  if (approveBtn) {
    approveBtn.addEventListener('click', async () => {
      try {
        await api(`/orders/${id}/approve`, { method: 'POST', body: JSON.stringify({ actor: 'Responsável técnico' }) });
        toast('Pedido aprovado.', 'success');
        openOrderDetail(id);
        loadOrders();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  document.querySelectorAll('[data-stage]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/orders/${id}/stages/${btn.dataset.stage}/${btn.dataset.action}`, {
          method: 'POST',
          body: JSON.stringify({ actor: 'Setor (demo)' }),
        });
        toast('Atualizado.', 'success');
        openOrderDetail(id);
        loadOrders();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  });
}

document.getElementById('btnCloseDetail').addEventListener('click', () => {
  document.getElementById('modalOrderDetail').classList.remove('active');
});

// ---------- PCP ----------
async function loadPCP() {
  const board = await api('/pcp/board');
  document.getElementById('pcpBoard').innerHTML = board
    .map(
      ({ sector, stages }) => `
    <div class="card">
      <h3>${sector.name}</h3>
      ${
        stages.length
          ? stages
              .map(
                (s) => `<div style="padding:8px 0; border-bottom:1px solid var(--border);">
            <a class="link" data-id="${s.order_id}"><strong>${s.code}</strong></a>
            <div class="muted">${s.customer_name} · prazo ${s.due_at}</div>
            <span class="badge ${s.status === 'bloqueado' ? 'bloqueado_divergencia' : s.status === 'em_execucao' ? 'em_producao' : 'em_validacao'}">${s.status.replace(/_/g, ' ')}</span>
          </div>`
              )
              .join('')
          : '<p class="muted">Fila vazia.</p>'
      }
    </div>`
    )
    .join('');

  document.getElementById('pcpBoard').querySelectorAll('a.link').forEach((a) =>
    a.addEventListener('click', () => openOrderDetail(a.dataset.id))
  );
}

// ---------- Passaporte / QR ----------
async function loadPassportSelect() {
  if (!ordersCache.length) ordersCache = await api('/orders');
  const select = document.getElementById('passportOrderSelect');
  select.innerHTML = ordersCache.map((o) => `<option value="${o.id}">${o.code} — ${o.customer_name}</option>`).join('');
  if (ordersCache.length) renderPassport(ordersCache[0].id);
  select.onchange = () => renderPassport(select.value);
}

async function renderPassport(orderId) {
  document.getElementById('qrContainer').innerHTML = `
    <img src="/api/orders/${orderId}/qrcode.png" alt="QR Code do pedido" style="background:#fff; padding:10px; border-radius:8px;" />
    <p class="muted" style="margin-top:8px;">Escaneie para abrir a página pública de consulta do pedido.</p>
  `;

  const order = ordersCache.find((o) => String(o.id) === String(orderId));
  const data = await api('/orders/' + orderId);
  const { spec, stages, findings } = data;

  document.getElementById('passportDetail').innerHTML = `
    <h3>${order.code}</h3>
    <p class="muted">${order.customer_name}${order.customer_company ? ' — ' + order.customer_company : ''}</p>
    <table>
      <tr><td class="muted">Status</td><td><span class="badge ${order.status}">${STATUS_LABEL[order.status] || order.status}</span></td></tr>
      <tr><td class="muted">Material</td><td>${spec?.material ?? '—'}</td></tr>
      <tr><td class="muted">Tipo de lona</td><td>${spec?.canvas_type ?? '—'}</td></tr>
      <tr><td class="muted">Motor</td><td>${spec?.motor_model ?? '—'}</td></tr>
    </table>
    <h3 style="margin-top:16px;">Etapas</h3>
    <div class="stage-track">${stages.map((s) => `<div class="stage-chip ${s.status}"><div class="name">${s.sector_name}</div><div class="status">${s.status.replace(/_/g, ' ')}</div></div>`).join('')}</div>
    ${findings.length ? `<h3 style="margin-top:16px;">Pendências</h3>` + findings.map((f) => `<div class="finding ${f.level}"><span class="badge ${f.level}">${f.level}</span> ${f.message}</div>`).join('') : ''}
  `;
}

// ---------- Assistente ----------
function addChatMsg(text, who) {
  const log = document.getElementById('chatLog');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + who;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function askAssistant(question) {
  addChatMsg(question, 'user');
  try {
    const res = await api('/assistant/ask', { method: 'POST', body: JSON.stringify({ question }) });
    addChatMsg(res.text, 'bot');
  } catch (e) {
    addChatMsg('Erro ao consultar: ' + e.message, 'bot');
  }
}

document.getElementById('chatSend').addEventListener('click', () => {
  const input = document.getElementById('chatInput');
  if (!input.value.trim()) return;
  askAssistant(input.value.trim());
  input.value = '';
});
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('chatSend').click();
});
document.querySelectorAll('.pill').forEach((p) => p.addEventListener('click', () => askAssistant(p.dataset.q)));

// ---------- Boot ----------
(async () => {
  try {
    const health = await api('/health');
    document.getElementById('llmStatus').textContent = health.llmConfigured
      ? 'IA externa conectada'
      : 'Assistente em modo de regras (sem IA externa conectada)';
  } catch {}
  loadDashboard();
})();
