const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { runValidation } = require('../services/validation');

const router = express.Router();

function logHistory(orderId, actor, action, field, oldValue, newValue, note) {
  db.prepare(
    `INSERT INTO order_history (order_id, actor, action, field, old_value, new_value, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(orderId, actor, action, field || null, oldValue ?? null, newValue ?? null, note || null);
}

// Lista pedidos (dashboard / lista de pedidos)
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.company AS customer_company,
              (SELECT COUNT(*) FROM ai_findings f WHERE f.order_id = o.id AND f.resolved = 0 AND f.level = 'critico') AS critical_findings
       FROM orders o JOIN customers c ON c.id = o.customer_id
       ORDER BY o.created_at DESC`
    )
    .all();
  res.json(rows);
});

// Detalhe completo de um pedido (specs, etapas, histórico, findings)
router.get('/:id', (req, res) => {
  const order = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.company AS customer_company, c.contact AS customer_contact
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`
    )
    .get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

  const spec = db.prepare('SELECT * FROM order_specifications WHERE order_id = ?').get(order.id);
  const stages = db
    .prepare(
      `SELECT os.*, s.name AS sector_name, s.slug AS sector_slug
       FROM order_stages os JOIN sectors s ON s.id = os.sector_id
       WHERE os.order_id = ? ORDER BY os.sort_order`
    )
    .all(order.id);
  const history = db
    .prepare('SELECT * FROM order_history WHERE order_id = ? ORDER BY created_at DESC')
    .all(order.id);
  const findings = db
    .prepare('SELECT * FROM ai_findings WHERE order_id = ? AND resolved = 0 ORDER BY level')
    .all(order.id);

  res.json({ order, spec, stages, history, findings });
});

// Cria pedido (cadastro + specs na mesma chamada, pode ser rascunho)
router.post('/', (req, res) => {
  const { customer, spec, due_at, notes, stages: stageSectorIds } = req.body;

  if (!customer || !customer.name || !due_at) {
    return res.status(400).json({ error: 'Cliente e prazo de entrega são obrigatórios.' });
  }

  const tx = db.transaction(() => {
    let customerRow = db.prepare('SELECT * FROM customers WHERE name = ? AND company IS ?').get(customer.name, customer.company || null);
    if (!customerRow) {
      const info = db
        .prepare('INSERT INTO customers (name, company, contact) VALUES (?, ?, ?)')
        .run(customer.name, customer.company || null, customer.contact || null);
      customerRow = { id: info.lastInsertRowid };
    }

    const code = 'DF-' + new Date().getFullYear() + '-' + String(Math.floor(1000 + Math.random() * 9000));
    const qrToken = crypto.randomBytes(16).toString('hex');
    const openedAt = new Date().toISOString().slice(0, 10);

    const orderInfo = db
      .prepare(
        `INSERT INTO orders (code, customer_id, opened_at, due_at, status, notes, qr_token)
         VALUES (?, ?, ?, ?, 'em_validacao', ?, ?)`
      )
      .run(code, customerRow.id, openedAt, due_at, notes || null, qrToken);
    const orderId = orderInfo.lastInsertRowid;

    db.prepare(
      `INSERT INTO order_specifications
       (order_id, width_mm_commercial, width_mm_technical, height_mm, material, canvas_type, motor_model, finish, components)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      spec?.width_mm_commercial ?? null,
      spec?.width_mm_technical ?? null,
      spec?.height_mm ?? null,
      spec?.material ?? null,
      spec?.canvas_type ?? null,
      spec?.motor_model ?? null,
      spec?.finish ?? null,
      spec?.components ?? null
    );

    // Define as etapas do pedido (sequência configurável; default = todos os setores em ordem)
    const sectors = stageSectorIds && stageSectorIds.length
      ? stageSectorIds.map((id) => db.prepare('SELECT * FROM sectors WHERE id = ?').get(id))
      : db.prepare('SELECT * FROM sectors ORDER BY sort_order').all();

    sectors.forEach((sector, idx) => {
      db.prepare(
        `INSERT INTO order_stages (order_id, sector_id, sort_order, status)
         VALUES (?, ?, ?, ?)`
      ).run(orderId, sector.id, idx, idx === 0 ? 'pronto_para_iniciar' : 'aguardando');
    });

    logHistory(orderId, 'Comercial', 'criado', null, null, null, `Pedido ${code} criado.`);

    return orderId;
  });

  const orderId = tx();
  const result = runValidation(orderId);
  res.status(201).json({ orderId, validation: result });
});

// Edita especificações — SEMPRE gera histórico e reroda a validação.
router.put('/:id/spec', (req, res) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

  const current = db.prepare('SELECT * FROM order_specifications WHERE order_id = ?').get(orderId);
  const updates = req.body;
  const actor = req.body.actor || 'Técnico';

  const fields = ['width_mm_commercial', 'width_mm_technical', 'height_mm', 'material', 'canvas_type', 'motor_model', 'finish', 'components'];
  const tx = db.transaction(() => {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] !== current[field]) {
        logHistory(orderId, actor, 'editado', field, current[field], updates[field], updates.reason || null);
        db.prepare(`UPDATE order_specifications SET ${field} = ? WHERE order_id = ?`).run(updates[field], orderId);
      }
    }
    db.prepare(`UPDATE orders SET updated_at = datetime('now') WHERE id = ?`).run(orderId);
  });
  tx();

  const result = runValidation(orderId);
  res.json({ validation: result });
});

// Aprovação humana de um pedido com divergências não-críticas (regra: IA nunca aprova sozinha)
router.post('/:id/approve', (req, res) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

  const criticalOpen = db
    .prepare(`SELECT COUNT(*) AS n FROM ai_findings WHERE order_id = ? AND resolved = 0 AND level = 'critico'`)
    .get(orderId);
  if (criticalOpen.n > 0) {
    return res.status(409).json({ error: 'Pedido possui pendências críticas não resolvidas. Não é possível liberar para produção.' });
  }

  db.prepare(`UPDATE orders SET status = 'aprovado', updated_at = datetime('now') WHERE id = ?`).run(orderId);
  logHistory(orderId, req.body.actor || 'Responsável técnico', 'validado', null, order.status, 'aprovado', 'Pedido aprovado por responsável humano após revisão dos alertas.');
  res.json({ ok: true });
});

// Handoff de setor: recebido
router.post('/:id/stages/:stageId/receive', (req, res) => {
  const { id: orderId, stageId } = req.params;
  const stage = db.prepare('SELECT * FROM order_stages WHERE id = ? AND order_id = ?').get(stageId, orderId);
  if (!stage) return res.status(404).json({ error: 'Etapa não encontrada.' });
  if (stage.status !== 'pronto_para_iniciar') {
    return res.status(409).json({ error: `Etapa não está liberada para recebimento (status atual: ${stage.status}).` });
  }
  db.prepare(
    `UPDATE order_stages SET status = 'em_execucao', received_at = datetime('now') WHERE id = ?`
  ).run(stageId);
  logHistory(orderId, req.body.actor || 'Setor', 'etapa_recebida', null, 'pronto_para_iniciar', 'em_execucao', `Setor confirmou recebimento da etapa.`);
  res.json({ ok: true });
});

// Handoff de setor: concluído -> libera a próxima etapa automaticamente
router.post('/:id/stages/:stageId/complete', (req, res) => {
  const { id: orderId, stageId } = req.params;
  const stage = db.prepare('SELECT * FROM order_stages WHERE id = ? AND order_id = ?').get(stageId, orderId);
  if (!stage) return res.status(404).json({ error: 'Etapa não encontrada.' });
  if (stage.status !== 'em_execucao') {
    return res.status(409).json({ error: `Etapa precisa estar em execução para ser concluída (status atual: ${stage.status}).` });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE order_stages SET status = 'concluido', completed_at = datetime('now') WHERE id = ?`
    ).run(stageId);
    logHistory(orderId, req.body.actor || 'Setor', 'etapa_concluida', null, 'em_execucao', 'concluido', null);

    // Libera a próxima etapa só se esta (sua dependência) foi concluída — regra do PCP.
    const next = db
      .prepare('SELECT * FROM order_stages WHERE order_id = ? AND sort_order = ?')
      .get(orderId, stage.sort_order + 1);
    if (next) {
      db.prepare(`UPDATE order_stages SET status = 'pronto_para_iniciar' WHERE id = ?`).run(next.id);
    } else {
      // Última etapa concluída -> pedido finalizado
      db.prepare(`UPDATE orders SET status = 'entregue', updated_at = datetime('now') WHERE id = ?`).run(orderId);
      logHistory(orderId, 'Sistema', 'etapa_concluida', null, null, null, 'Última etapa concluída — pedido marcado como entregue.');
    }
  });
  tx();
  res.json({ ok: true });
});

// QR Code do passaporte digital (gera PNG real on-the-fly)
router.get('/:id/qrcode.png', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).end();
  const url = `${req.protocol}://${req.get('host')}/passaporte/${order.qr_token}`;
  res.type('png');
  QRCode.toFileStream(res, url, { width: 300, margin: 1 });
});

function getPassportByToken(token) {
  const order = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, c.company AS customer_company
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.qr_token = ?`
    )
    .get(token);
  if (!order) return null;

  const spec = db.prepare('SELECT * FROM order_specifications WHERE order_id = ?').get(order.id);
  const stages = db
    .prepare(
      `SELECT os.*, s.name AS sector_name FROM order_stages os
       JOIN sectors s ON s.id = os.sector_id WHERE os.order_id = ? ORDER BY os.sort_order`
    )
    .all(order.id);
  const findings = db.prepare('SELECT * FROM ai_findings WHERE order_id = ? AND resolved = 0').all(order.id);
  const history = db.prepare('SELECT * FROM order_history WHERE order_id = ? ORDER BY created_at DESC LIMIT 20').all(order.id);

  return { order, spec, stages, findings, history };
}

// Passaporte digital público (por token do QR — não expõe ID sequencial do banco)
router.get('/passaporte/:token', (req, res) => {
  const result = getPassportByToken(req.params.token);
  if (!result) return res.status(404).json({ error: 'Passaporte não encontrado.' });
  res.json(result);
});

module.exports = router;
module.exports.getPassportByToken = getPassportByToken;
