# DUSPOR FLOW — MVP

Plataforma de rastreabilidade de pedidos para a Duspor (fabricação de portas industriais personalizadas). Este é o **recorte funcional** construído para o desafio — não o sistema completo descrito no prompt-master, que é escopo de meses de equipe. Ver seção **"O que foi deixado de fora e por quê"**.

## O problema que isto resolve

Hoje a informação de um pedido passa por várias planilhas até chegar no PCP, que a fragmenta entre setores (corte/dobra, solda, montagem...). Cada repasse é uma chance de erro — um "telefone sem fio". Alguns erros são reversíveis (modelo de motor), outros inviabilizam a peça inteira (material da lona). Nenhuma ferramenta usada antes (Kanban, Excel) resolveu porque o problema não é a ferramenta — é a ausência de uma fonte única de verdade, rastreável, que diferencie a gravidade dos erros.

## O que o MVP entrega (funcional, com banco de dados real)

1. **Cadastro + validação inteligente de pedido** — ao criar ou editar um pedido, um motor de regras confere o preenchimento e cruza largura do orçamento vs. desenho técnico (exatamente o exemplo do desafio: 3000mm vs 3200mm). Gera alertas em 3 níveis (informativo/atenção/crítico). Campos críticos (material, tipo de lona) bloqueiam a liberação do pedido até revisão humana — **a IA nunca aprova ou corrige sozinha.**
2. **Painel do PCP com handoff entre setores** — cada pedido passa por etapas sequenciais (Corte e Dobra → Solda → Montagem → Inspeção → Expedição). Um setor só pode "receber" uma etapa quando a anterior foi concluída, e só pode "concluir" depois de confirmar recebimento. Isso é imposto pelo backend, não é só visual.
3. **Passaporte digital + QR Code** — cada pedido tem um QR Code real (PNG gerado on-the-fly) que leva a uma página pública com specs, status e etapas — sem expor o ID interno do banco.
4. **Assistente de IA** — responde perguntas (pedidos atrasados, divergências abertas, pendências por setor, status de um pedido, erros mais frequentes) consultando o banco de dados real. Nunca inventa números; se não entende a pergunta, diz isso.
5. **Histórico/auditoria** — toda alteração de especificação, validação, handoff de setor e aprovação fica registrada com autor, data, valor antigo/novo e motivo. Nada é apagado silenciosamente.
6. **Dashboard** — totais, atrasados, pendências críticas e distribuição por setor, sempre vindos de queries reais no banco.

## Stack

- **Backend:** Node.js + Express (API REST)
- **Banco de dados:** SQLite via `better-sqlite3` — zero configuração, arquivo único em `server/db/duspor_flow.db`, schema relacional completo com chaves estrangeiras e histórico. Trocar por PostgreSQL depois é uma migração direta (mesmo modelo relacional).
- **Frontend:** HTML + JS puro servido pelo próprio Express — sem build step, para rodar com dois comandos.
- **QR Code:** lib `qrcode` (gera PNG de verdade).
- **IA:** motor de regras determinístico hoje (ver `server/services/validation.js` e `server/services/assistant.js`). Ponto de integração para um LLM real (ex: Claude) já isolado e sinalizado — ver `.env.example`.

## Como rodar localmente

```bash
npm install
npm run seed     # popula o banco com dados DEMONSTRATIVOS (claramente fictícios)
npm start         # sobe o servidor em http://localhost:3000
```

Abra `http://localhost:3000` no navegador.

## Como testar

- **Validação:** vá em Pedidos → abra o pedido "DF-2026-xxxx" do cliente João Pelegrini → veja o alerta crítico de divergência de largura (3000mm vs 3200mm) → tente aprovar (vai ser recusado) → edite a especificação para corrigir → aprove (agora funciona).
- **Handoff de setor:** no mesmo pedido, use os botões "Confirmar recebimento" / "Concluir" em cada etapa — tente pular uma etapa e veja o erro do backend.
- **QR Code:** aba "Passaporte / QR" → selecione um pedido → o QR Code é uma imagem real; abrir a URL por trás dele retorna o JSON público do passaporte.
- **Assistente:** aba "Assistente de IA" → use os atalhos ou pergunte "qual o andamento do pedido 1048" (troque pelo código real de um pedido seu).
- **Teste automatizado:** `npm test` roda um teste de ponta a ponta que recria o banco, cria um pedido com a divergência do exemplo do desafio, confirma que a aprovação é recusada, corrige e confirma que a aprovação passa a funcionar, e testa a dependência de handoff entre setores.

## Modelo de dados (resumo)

`customers`, `orders`, `order_specifications`, `sectors`, `order_stages` (etapas/handoff), `order_history` (auditoria), `ai_findings` (achados da validação), `employees`. Schema completo e comentado em `server/db/schema.sql`.

## Regras de negócio implementadas (não é só interface)

- Um pedido com pendência **crítica** aberta não pode ser aprovado (`POST /api/orders/:id/approve` retorna 409).
- Uma etapa de setor só pode ser concluída se estiver "em_execucao" (ou seja, se o setor confirmou recebimento antes).
- A próxima etapa só é liberada (`pronto_para_iniciar`) quando a etapa anterior é marcada como concluída.
- Toda edição de especificação, troca de status, handoff e aprovação gera uma linha em `order_history` — nunca é silenciosa.

## O que foi deixado de fora e por quê

O prompt-master original pede um sistema multi-tenant completo com autenticação/RBAC, OCR, LLM pago, portal do cliente, 20 páginas, notificações, calendário, relatórios etc. Isso é um produto de SaaS real, não um recorte de desafio. Este MVP focou no **núcleo do problema** (rastreabilidade + validação + handoff + consulta), que é o que precisa ser provado primeiro. Próximos passos naturais, em ordem de prioridade, se isto virar projeto real:

1. Autenticação e permissões por papel/setor (hoje o `actor` é só um campo de texto livre, sem login).
2. Migrar SQLite → PostgreSQL + multi-tenant.
3. Conectar um LLM de verdade no assistente e na validação (ponto de extensão já isolado).
4. Portal externo do cliente com link individual seguro.
5. Upload real de documentos/desenhos técnicos (hoje specs são só campos estruturados).

## Dados de demonstração

Os 4 pedidos criados pelo `npm run seed` são fictícios e existem só para mostrar o sistema funcionando, incluindo deliberadamente o cenário do próprio desafio (divergência de 200mm entre orçamento e desenho técnico).
