// Motor de validação inteligente (MÓDULO 3).
// Regra fundamental do desafio: a IA aponta, explica e sugere verificação.
// Ela NUNCA corrige valores sozinha e NUNCA aprova um pedido.
// Por isso este módulo só produz "findings" (achados) com nível de severidade;
// quem decide o que fazer com eles é sempre uma pessoa, na rota de aprovação.

const db = require('../db');

const LEVELS = { INFO: 'informativo', ATENCAO: 'atencao', CRITICO: 'critico' };

// Campos que, se errados, custam o projeto inteiro (irreversíveis depois de cortados/soldados).
const CRITICAL_FIELDS = new Set(['canvas_type', 'material']);

function runValidation(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const spec = db.prepare('SELECT * FROM order_specifications WHERE order_id = ?').get(orderId);

  const findings = [];

  if (!spec) {
    findings.push({
      level: LEVELS.CRITICO,
      message: 'Pedido não possui especificações técnicas cadastradas ainda.',
      field: null,
    });
  } else {
    // 1) Divergência entre largura comercial (orçamento) e largura técnica (desenho).
    if (spec.width_mm_commercial != null && spec.width_mm_technical != null) {
      const diff = Math.abs(spec.width_mm_commercial - spec.width_mm_technical);
      if (diff > 0) {
        findings.push({
          level: diff > 50 ? LEVELS.CRITICO : LEVELS.ATENCAO,
          message: `Divergência de largura: orçamento informa ${spec.width_mm_commercial}mm, desenho técnico informa ${spec.width_mm_technical}mm (diferença de ${diff}mm).`,
          field: 'width_mm',
        });
      }
    } else if (spec.width_mm_commercial == null || spec.width_mm_technical == null) {
      findings.push({
        level: LEVELS.ATENCAO,
        message: 'Largura não foi informada em um dos dois documentos (orçamento comercial ou desenho técnico).',
        field: 'width_mm',
      });
    }

    // 2) Campos obrigatórios ausentes, com severidade diferente por criticidade do campo.
    const requiredFields = [
      ['height_mm', 'Altura'],
      ['material', 'Material'],
      ['canvas_type', 'Tipo de lona'],
      ['motor_model', 'Modelo do motor'],
    ];
    for (const [field, label] of requiredFields) {
      if (spec[field] === null || spec[field] === undefined || spec[field] === '') {
        findings.push({
          level: CRITICAL_FIELDS.has(field) ? LEVELS.CRITICO : LEVELS.ATENCAO,
          message: `${label} não foi preenchido. ${CRITICAL_FIELDS.has(field) ? 'Este é um campo crítico: um erro aqui pode inviabilizar a peça depois de cortada/soldada.' : 'Pode ser complementado durante a produção, mas precisa ser preenchido antes da etapa que depende dele.'}`,
          field,
        });
      }
    }
  }

  // 3) Prazo: alerta informativo se faltar pouco tempo e o pedido ainda não foi aprovado.
  if (order && order.due_at) {
    const daysLeft = Math.ceil((new Date(order.due_at) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 10 && daysLeft >= 0 && order.status !== 'entregue') {
      findings.push({
        level: LEVELS.ATENCAO,
        message: `Faltam ${daysLeft} dia(s) para o prazo de entrega e o pedido ainda está em "${order.status}".`,
        field: 'due_at',
      });
    } else if (daysLeft < 0 && order.status !== 'entregue') {
      findings.push({
        level: LEVELS.CRITICO,
        message: `Prazo de entrega vencido há ${Math.abs(daysLeft)} dia(s). Pedido ainda em "${order.status}".`,
        field: 'due_at',
      });
    }
  }

  // Persiste os findings (substitui os anteriores não resolvidos deste pedido).
  const insert = db.prepare(
    `INSERT INTO ai_findings (order_id, level, message, field) VALUES (?, ?, ?, ?)`
  );
  const clearOld = db.prepare(`DELETE FROM ai_findings WHERE order_id = ? AND resolved = 0`);
  const tx = db.transaction(() => {
    clearOld.run(orderId);
    for (const f of findings) {
      insert.run(orderId, f.level, f.message, f.field);
    }
  });
  tx();

  const hasCritico = findings.some((f) => f.level === LEVELS.CRITICO);
  const newStatus = hasCritico ? 'bloqueado_divergencia' : order.status === 'bloqueado_divergencia' ? 'em_validacao' : order.status;

  if (newStatus !== order.status) {
    db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newStatus, orderId);
    db.prepare(
      `INSERT INTO order_history (order_id, actor, action, old_value, new_value, note) VALUES (?, 'Sistema (validação IA)', 'alerta_gerado', ?, ?, ?)`
    ).run(orderId, order.status, newStatus, hasCritico ? 'Pendência crítica identificada — liberação bloqueada até revisão humana.' : 'Divergências críticas resolvidas.');
  }

  return { findings, blocked: hasCritico };
}

module.exports = { runValidation, LEVELS, CRITICAL_FIELDS };
