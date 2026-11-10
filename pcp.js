const express = require('express');
const db = require('../db');

const router = express.Router();

// Visão geral do PCP: todos os setores com suas filas (MÓDULO 6)
router.get('/board', (req, res) => {
  const sectors = db.prepare('SELECT * FROM sectors ORDER BY sort_order').all();
  const board = sectors.map((sector) => {
    const stages = db
      .prepare(
        `SELECT os.*, o.code, o.due_at, o.status AS order_status, c.name AS customer_name
         FROM order_stages os
         JOIN orders o ON o.id = os.order_id
         JOIN customers c ON c.id = o.customer_id
         WHERE os.sector_id = ? AND os.status != 'concluido'
         ORDER BY o.due_at ASC`
      )
      .all(sector.id);
    return { sector, stages };
  });
  res.json(board);
});

// Dashboard (MÓDULO 1) — números reais vindos do banco
router.get('/dashboard', (req, res) => {
  const totals = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const byStatus = db
    .prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status')
    .all();
  const late = db
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE date(due_at) < date('now') AND status != 'entregue'`)
    .get().n;
  const dueSoon = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders WHERE date(due_at) BETWEEN date('now') AND date('now', '+10 days') AND status != 'entregue'`
    )
    .get().n;
  const criticalFindings = db
    .prepare(`SELECT COUNT(*) AS n FROM ai_findings WHERE resolved = 0 AND level = 'critico'`)
    .get().n;
  const bySector = db
    .prepare(
      `SELECT s.name, COUNT(*) AS n FROM order_stages os
       JOIN sectors s ON s.id = os.sector_id
       WHERE os.status IN ('em_execucao','pronto_para_iniciar')
       GROUP BY s.name ORDER BY s.sort_order`
    )
    .all();

  res.json({ totals, byStatus, late, dueSoon, criticalFindings, bySector });
});

router.get('/sectors', (req, res) => {
  res.json(db.prepare('SELECT * FROM sectors ORDER BY sort_order').all());
});

module.exports = router;
