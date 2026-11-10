const path = require('path');
const express = require('express');

const ordersRouter = require('./routes/orders');
const pcpRouter = require('./routes/pcp');
const assistantRouter = require('./routes/assistant');
const { LLM_CONFIGURED } = require('./services/assistant');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, llmConfigured: LLM_CONFIGURED });
});

app.use('/api/orders', ordersRouter);
app.use('/api/pcp', pcpRouter);
app.use('/api/assistant', assistantRouter);

// Qualquer outra rota (incluindo /passaporte/:token, lido pelo frontend via JS)
// cai no mesmo HTML — SPA simples sem build step.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DUSPOR FLOW rodando em http://localhost:${PORT}`);
  if (!LLM_CONFIGURED) {
    console.log('Aviso: ANTHROPIC_API_KEY não configurada — assistente de IA rodando em modo de regras (sem LLM externo). Ver .env.example.');
  }
});
