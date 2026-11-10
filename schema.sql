-- DUSPOR FLOW — schema do MVP
-- Escopo: cadastro+validação de pedido, passaporte digital/QR,
-- painel do PCP com handoff entre setores, assistente consultando dados reais.
-- Dados fictícios de demonstração são marcados explicitamente no seed (nunca aqui).

PRAGMA foreign_keys = ON;

-- Setores de produção. Ordem define a sequência padrão do fluxo (configurável por pedido).
CREATE TABLE IF NOT EXISTS sectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,              -- comercial, tecnico, pcp, setor, admin
  sector_id INTEGER REFERENCES sectors(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT,
  contact TEXT
);

-- Pedido = uma porta personalizada.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                 -- código único exibido ao cliente/setor
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  commercial_employee_id INTEGER REFERENCES employees(id),
  technical_employee_id INTEGER REFERENCES employees(id),
  opened_at TEXT NOT NULL,                   -- data de abertura (ISO)
  due_at TEXT NOT NULL,                      -- prazo de entrega (ISO) -> até 60 dias
  status TEXT NOT NULL DEFAULT 'rascunho',
    -- rascunho | em_validacao | bloqueado_divergencia | aprovado | em_producao | inspecao | expedido | entregue
  notes TEXT,
  qr_token TEXT UNIQUE,                      -- identificador opaco usado no QR (não expõe dados)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Especificações técnicas do pedido. Campos de criticidade diferente (regra do desafio:
-- nem todo erro é igual — motor é reversível, material da lona não é).
CREATE TABLE IF NOT EXISTS order_specifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  width_mm_commercial REAL,     -- largura informada na proposta/orçamento
  width_mm_technical REAL,      -- largura informada no desenho técnico
  height_mm REAL,
  material TEXT,
  canvas_type TEXT,             -- tipo de lona (CAMPO CRÍTICO: erro aqui inutiliza a peça)
  motor_model TEXT,             -- (CAMPO REVERSÍVEL: pode ser trocado depois)
  finish TEXT,
  components TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Etapas de produção configuráveis por pedido (sequência real do fluxo).
CREATE TABLE IF NOT EXISTS order_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sector_id INTEGER NOT NULL REFERENCES sectors(id),
  sort_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'aguardando',
    -- aguardando | pronto_para_iniciar | em_execucao | concluido | bloqueado
  received_at TEXT,       -- handoff: quando o setor confirmou recebimento
  received_by INTEGER REFERENCES employees(id),
  started_at TEXT,
  completed_at TEXT,
  completed_by INTEGER REFERENCES employees(id),
  blocked_reason TEXT
);

-- Histórico/auditoria: nenhuma alteração importante pode ser silenciosa.
CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,            -- quem fez (nome/role, simplificado pro MVP)
  field TEXT,                     -- campo alterado, se aplicável
  old_value TEXT,
  new_value TEXT,
  action TEXT NOT NULL,           -- criado | editado | validado | alerta_gerado | etapa_recebida | etapa_concluida | bloqueado | desbloqueado
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Resultado da validação inteligente (regras). Nunca decide sozinho: só aponta.
CREATE TABLE IF NOT EXISTS ai_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  level TEXT NOT NULL,            -- informativo | atencao | critico
  message TEXT NOT NULL,
  field TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
