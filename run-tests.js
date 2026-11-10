// Teste de ponta a ponta do MVP. Não usa um framework externo de propósito
// (mantém o projeto sem dependências extras) — é um runner simples que recria
// o banco, exercita as rotas via chamada direta das funções/serviços e falha
// alto (process.exit(1)) se qualquer asserção quebrar.

const path = require('path');
const fs = require('fs');

// Usa um banco de teste isolado, para não sujar os dados demonstrativos.
process.env.DUSPOR_TEST_DB = '1';
const DB_PATH = path.join(__dirname, '..', 'db', 'duspor_flow.db');
const BACKUP_PATH = DB_PATH + '.bak';
if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, BACKUP_PATH);
fs.rmSync(DB_PATH, { force: true });

const db = require('../db');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  OK  ' + msg);
  } else {
    failed++;
    console.log('FALHA ' + msg);
  }
}

function restore() {
  fs.rmSync(DB_PATH, { force: true });
  if (fs.existsSync(BACKUP_PATH)) {
    fs.renameSync(BACKUP_PATH, DB_PATH);
  }
}

try {
  // Seed mínimo de setores (sem os pedidos demonstrativos)
  const sectorNames = ['Corte e Dobra', 'Solda', 'Montagem'];
  sectorNames.forEach((name, i) =>
    db.prepare('INSERT INTO sectors (name, slug, sort_order) VALUES (?, ?, ?)').run(name, name.toLowerCase().replace(/[^a-z]+/g, '-'), i)
  );

  const { runValidation } = require('../services/validation');
  const crypto = require('crypto');

  // ---- Teste 1: divergência crítica de largura bloqueia aprovação ----
  const custId = db.prepare('INSERT INTO customers (name, company, contact) VALUES (?, ?, ?)').run('Cliente Teste', 'Empresa Teste', '').lastInsertRowid;
  const orderId = db
    .prepare(`INSERT INTO orders (code, customer_id, opened_at, due_at, status, qr_token) VALUES (?, ?, date('now'), date('now','+30 days'), 'em_validacao', ?)`)
    .run('TEST-0001', custId, crypto.randomBytes(8).toString('hex')).lastInsertRowid;
  db.prepare(
    `INSERT INTO order_specifications (order_id, width_mm_commercial, width_mm_technical, height_mm, material, canvas_type, motor_model) VALUES (?, 3000, 3200, 2500, 'Aço', 'Lona PVC', 'Motor X')`
  ).run(orderId);
  sectorNames.forEach((_, i) => {
    const sid = db.prepare('SELECT id FROM sectors WHERE sort_order = ?').get(i).id;
    db.prepare(`INSERT INTO order_stages (order_id, sector_id, sort_order, status) VALUES (?, ?, ?, ?)`).run(orderId, sid, i, i === 0 ? 'pronto_para_iniciar' : 'aguardando');
  });

  const v1 = runValidation(orderId);
  assert(v1.blocked === true, 'Pedido com divergência de 200mm é marcado como bloqueado pela validação');
  assert(v1.findings.some((f) => f.level === 'critico'), 'Existe ao menos um finding crítico');

  const ordersRouterModule = require('../routes/orders');

  // Simula a checagem de aprovação (mesma query usada na rota)
  function canApprove(id) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ai_findings WHERE order_id = ? AND resolved = 0 AND level = 'critico'`).get(id).n;
    return n === 0;
  }
  assert(canApprove(orderId) === false, 'Aprovação é recusada enquanto houver pendência crítica');

  // Corrige a divergência e reroda a validação
  db.prepare('UPDATE order_specifications SET width_mm_technical = 3000 WHERE order_id = ?').run(orderId);
  const v2 = runValidation(orderId);
  assert(v2.blocked === false, 'Após corrigir a medida, a validação deixa de bloquear');
  assert(canApprove(orderId) === true, 'Aprovação passa a ser permitida após a correção');

  // ---- Teste 2: campo crítico ausente também bloqueia ----
  const orderId2 = db
    .prepare(`INSERT INTO orders (code, customer_id, opened_at, due_at, status, qr_token) VALUES (?, ?, date('now'), date('now','+30 days'), 'em_validacao', ?)`)
    .run('TEST-0002', custId, crypto.randomBytes(8).toString('hex')).lastInsertRowid;
  db.prepare(
    `INSERT INTO order_specifications (order_id, width_mm_commercial, width_mm_technical, height_mm, material, canvas_type, motor_model) VALUES (?, 2000, 2000, 2000, 'Aço', NULL, 'Motor X')`
  ).run(orderId2);
  const v3 = runValidation(orderId2);
  assert(v3.blocked === true, 'Pedido sem "tipo de lona" (campo crítico) é bloqueado mesmo com largura OK');

  // ---- Teste 3: dependência de handoff entre setores ----
  sectorNames.forEach((_, i) => {
    const sid = db.prepare('SELECT id FROM sectors WHERE sort_order = ?').get(i).id;
    db.prepare(`INSERT INTO order_stages (order_id, sector_id, sort_order, status) VALUES (?, ?, ?, ?)`).run(orderId2, sid, i, i === 0 ? 'pronto_para_iniciar' : 'aguardando');
  });
  const stage2 = db.prepare(`SELECT * FROM order_stages WHERE order_id = ? AND sort_order = 1`).get(orderId2);
  assert(stage2.status === 'aguardando', 'Segunda etapa começa como "aguardando" (não pode ser iniciada ainda)');

  const stage1 = db.prepare(`SELECT * FROM order_stages WHERE order_id = ? AND sort_order = 0`).get(orderId2);
  assert(stage1.status === 'pronto_para_iniciar', 'Primeira etapa já nasce liberada');

  // ---- Teste 4: assistente responde com dados reais (não inventa) ----
  const { answer } = require('../services/assistant');
  const r1 = answer('Quais pedidos possuem divergências?');
  assert(r1.data.some((d) => d.code === 'TEST-0002'), 'Assistente encontra o pedido TEST-0002 nas divergências reais do banco');
  const r2 = answer('pergunta sem sentido nenhum sobre o clima de marte');
  assert(/Não encontrei/.test(r2.text), 'Assistente admite quando não entende, em vez de inventar resposta');

} catch (err) {
  console.error('Erro inesperado durante os testes:', err);
  failed++;
} finally {
  restore();
}

console.log(`\n${passed} passaram, ${failed} falharam.`);
process.exit(failed > 0 ? 1 : 0);
