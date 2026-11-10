// Dados demonstrativos — EXPLICITAMENTE FICTÍCIOS, só para visualizar o sistema funcionando.
// Reflete os cenários descritos no desafio: divergência de medida, campo crítico (lona)
// ausente, e um fluxo normal passando pelos setores.

const db = require('./db');
const { runValidation } = require('./services/validation');

function reset() {
  db.exec(`
    DELETE FROM ai_findings;
    DELETE FROM order_history;
    DELETE FROM order_stages;
    DELETE FROM order_specifications;
    DELETE FROM orders;
    DELETE FROM customers;
    DELETE FROM employees;
    DELETE FROM sectors;
  `);
}

function seed() {
  reset();

  const sectorNames = ['Corte e Dobra', 'Solda', 'Montagem', 'Inspeção', 'Expedição'];
  const sectorIds = sectorNames.map((name, i) =>
    db
      .prepare('INSERT INTO sectors (name, slug, sort_order) VALUES (?, ?, ?)')
      .run(name, name.toLowerCase().replace(/[^a-z]+/g, '-'), i).lastInsertRowid
  );

  db.prepare('INSERT INTO employees (name, role, sector_id) VALUES (?, ?, ?)').run('Marcos (Comercial)', 'comercial', null);
  db.prepare('INSERT INTO employees (name, role, sector_id) VALUES (?, ?, ?)').run('Fernanda (Técnica)', 'tecnico', null);
  db.prepare('INSERT INTO employees (name, role, sector_id) VALUES (?, ?, ?)').run('Bia (PCP)', 'pcp', null);

  const crypto = require('crypto');

  function createOrder({ customer, due_at, spec, advanceStages = 0 }) {
    const custId = db
      .prepare('INSERT INTO customers (name, company, contact) VALUES (?, ?, ?)')
      .run(customer.name, customer.company, customer.contact).lastInsertRowid;

    const code = 'DF-2026-' + String(1000 + Math.floor(Math.random() * 9000));
    const qrToken = crypto.randomBytes(16).toString('hex');
    const openedAt = new Date().toISOString().slice(0, 10);

    const orderId = db
      .prepare(
        `INSERT INTO orders (code, customer_id, opened_at, due_at, status, qr_token)
         VALUES (?, ?, ?, ?, 'em_validacao', ?)`
      )
      .run(code, custId, openedAt, due_at, qrToken).lastInsertRowid;

    db.prepare(
      `INSERT INTO order_specifications
       (order_id, width_mm_commercial, width_mm_technical, height_mm, material, canvas_type, motor_model, finish, components)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      spec.width_mm_commercial ?? null,
      spec.width_mm_technical ?? null,
      spec.height_mm ?? null,
      spec.material ?? null,
      spec.canvas_type ?? null,
      spec.motor_model ?? null,
      spec.finish ?? null,
      spec.components ?? null
    );

    sectorIds.forEach((sid, idx) => {
      let status = 'aguardando';
      if (idx < advanceStages) status = 'concluido';
      else if (idx === advanceStages) status = 'pronto_para_iniciar';
      db.prepare(
        `INSERT INTO order_stages (order_id, sector_id, sort_order, status, received_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        orderId,
        sid,
        idx,
        status,
        idx < advanceStages ? new Date().toISOString() : null,
        idx < advanceStages ? new Date().toISOString() : null
      );
    });

    db.prepare(
      `INSERT INTO order_history (order_id, actor, action, note) VALUES (?, 'Comercial', 'criado', ?)`
    ).run(orderId, `Pedido ${code} criado (dado demonstrativo).`);

    runValidation(orderId);
    return { orderId, code };
  }

  // Caso 1: exatamente o exemplo do briefing — divergência crítica de largura.
  createOrder({
    customer: { name: 'João Pelegrini', company: 'Metalúrgica Pelegrini', contact: '(49) 99900-1111' },
    due_at: new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10),
    spec: {
      width_mm_commercial: 3000,
      width_mm_technical: 3200,
      height_mm: 2500,
      material: 'Aço galvanizado',
      canvas_type: 'Lona PVC reforçada',
      motor_model: 'Motor tubular 220V',
    },
    advanceStages: 0,
  });

  // Caso 2: campo crítico (lona) ausente — projeto não pode seguir sem isso.
  createOrder({
    customer: { name: 'Carla Zanella', company: 'Frigorífico Zanella', contact: 'carla@zanella.com' },
    due_at: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10),
    spec: {
      width_mm_commercial: 4000,
      width_mm_technical: 4000,
      height_mm: 3000,
      material: 'Alumínio',
      canvas_type: null, // CRÍTICO: ausente
      motor_model: null, // reversível, mas também ausente
    },
    advanceStages: 0,
  });

  // Caso 3: pedido limpo, já avançando pelos setores (corte/dobra concluído, na solda).
  createOrder({
    customer: { name: 'Ricardo Boff', company: 'Indústria Boff Embalagens', contact: 'ricardo@boff.com.br' },
    due_at: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
    spec: {
      width_mm_commercial: 2800,
      width_mm_technical: 2800,
      height_mm: 2200,
      material: 'Aço inox',
      canvas_type: 'Lona termoacústica',
      motor_model: 'Motor tubular 127V',
      finish: 'Pintura eletrostática branca',
    },
    advanceStages: 1,
  });

  // Caso 4: pedido atrasado, para aparecer no assistente e no dashboard.
  const late = createOrder({
    customer: { name: 'Empresa Souza Logística', company: 'Souza Log', contact: 'compras@souzalog.com' },
    due_at: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    spec: {
      width_mm_commercial: 3500,
      width_mm_technical: 3500,
      height_mm: 2700,
      material: 'Aço galvanizado',
      canvas_type: 'Lona PVC reforçada',
      motor_model: 'Motor tubular 220V',
      finish: 'Pintura padrão',
    },
    advanceStages: 2,
  });

  console.log('Seed concluído. Pedidos criados:');
  console.log('- Caso 1 (divergência crítica de largura, igual ao exemplo do briefing)');
  console.log('- Caso 2 (campo crítico "tipo de lona" ausente)');
  console.log('- Caso 3 (pedido limpo, em andamento normal)');
  console.log(`- Caso 4 (pedido atrasado: ${late.code})`);
}

seed();
