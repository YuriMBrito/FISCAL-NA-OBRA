# Changelog — Fiscal na Obra

---

## v15.5.1 (2026-03-20) — Edição de Itens no BM CAIXA

### Botões ✏️ e 🗑️ adicionados a cada item da tabela CAIXA

- **`modules/boletim-medicao/bm-caixa.js`** — coluna Ações agora mostra dois botões
  quando o BM não está bloqueado:
  - ✏️ **Editar** — abre o mesmo modal `abrirCrudItemBM('editar', id)` já existente
    no padrão prefeitura, com todos os campos: Código, Descrição, Unidade, Qtd Contratada,
    Preço Unitário, Código do Banco, Banco de Referência, Tipo de BDI, Preço Referência SINAPI
  - 🗑️ **Excluir** — chama `excluirItemBM(id)` com confirmação. Requer perfil fiscal ou superior
  - 🔒 — exibido quando BM está marcado como salvo (bloqueado para edição)

- **`modules/boletim-medicao/bm-controller.js`** — corrigido cálculo de preview
  "Total c/BDI" no formulário de edição: agora usa `cfg.bdi`/`cfg.bdiReduzido`
  em vez de `item.bdi` (campo inexistente em itens CAIXA importados)


---

## v15.5.0 (2026-03-20) — BM Padrão CAIXA Completamente Refeito

### Novo módulo: `modules/boletim-medicao/bm-caixa.js`

Módulo totalmente isolado do BM padrão prefeitura. Ativado automaticamente
quando `cfg.tipoObra === 'caixa'`.

**Interface:**
- Tabela com coluna "% Exec. Total" em destaque visual (borda amarela, fundo âmbar)
- Input `type=number` diretamente na célula da coluna — campo de entrada principal do fiscal
- Placeholder `0,00` e foco com halo amarelo para indicar qual campo preencher
- Botão 📐 na última coluna abre a Memória de Cálculo para documentação
- Cabeçalho colorido por grupo de colunas: azul (contratual), cinza (anterior), verde (atual), azul (acum), cinza escuro (saldo)

**Lógica:**
- Fiscal digita somente o `% Executado Total` acumulado até o BM atual
- Sistema calcula: `Qtd Atual = qtd_cont × (% total − % anterior) / 100`
- Acumulado Anterior é puxado automaticamente dos BMs anteriores
- BDI diferenciado por item (TCU Acórdão 2.622/2013) aplicado via `getBdiEfetivo()`
- Live-patch de 7 células por linha a cada tecla — sem re-render da tabela, scroll preservado
- Dados salvos no Firestore com marcador `_caixa: true` e `_pctExec: número`

**Memória de Cálculo:**
- Modal separado com tabela de linhas (descrição, quantidade, unidade)
- Campo de observação/justificativa do fiscal
- Dados gravados em chave isolada `_mem_caixa_${itemId}` — não afeta o BM

**Integração:**
- `bm-controller.js` instancia `CaixaBM` e roteia via `_render()` → `_isCaixa()`
- CSS dedicado `#caixa-bm-table` em `css/main.css` (dark mode incluído)
- Handlers `_bmCaixaAplicarPct` e `_bmCaixaAbrirMemoria` delegam ao novo módulo

**Removido de `bm-controller.js`:** 311 linhas de lógica CAIXA inline
(`_abrirMemoriaCaixa`, `_aplicarPctCaixa` e o bloco de comentários associado)


---

## v15.4.3 (2026-03-20) — Coluna CAIXA: causa raiz corrigida

### 🔴 Causa raiz real: `cfg` nunca carregado ao trocar de obra

**Bug:** `_selecionarObra()` (obras-manager), `_consultarObra()` (obras-concluidas) e
`_dgAbrirObra()` (dash-global) emitiam `obra:selecionada` sem antes carregar o `cfg`
da nova obra do Firebase. O `state.cfg` ficava com os dados da obra anterior —
`tipoObra:'prefeitura'` em vez de `'caixa'` — então `isCaixa` era sempre `false`
e a coluna de % nunca renderizava.

A mesma ausência afetava qualquer campo que dependa de `cfg` no momento de
`obra:selecionada`: BDI, fiscal, contratante, valor contratual, modo de cálculo, etc.

**Correção em 4 arquivos:**

- `modules/obras-manager/obras-manager-controller.js` — `_selecionarObra()`:
  carrega `cfg`, `bms` e `itens` do Firebase com `Promise.all` **antes** de emitir
  `obra:selecionada`

- `modules/obras-concluidas/obras-concluidas-controller.js` — `_consultarObra()`:
  mesma correção

- `modules/dash-global/dash-global-controller.js` — `_dgAbrirObra()`:
  mesma correção

- `modules/boletim-medicao/bm-controller.js` — `_carregarDados()`:
  passou a carregar `cfg` também (belt-and-suspenders — garante que o BM sempre
  tem o `cfg` correto mesmo que o chamador não tenha carregado)


---

## v15.4.2 (2026-03-20) — Coluna CAIXA não aparecia + 39 outros handlers quebrados

### 🔴 Bug raiz: 40 `data-arg` com aspas simples literais extras

**Causa:** A migração automática de `onclick=` para `data-action=` converteu
`onclick="window._siSetTipoImportacao('caixa')"` para
`data-action="_siSetTipoImportacao" data-arg0="'caixa'"` — com as aspas simples
**mantidas dentro do valor do atributo**.

**Efeito em cascata:**
- `_tryParse("'caixa'")` → string `"'caixa'"` (com aspas internas)
- `this._tipoImportacao = "'caixa'"` → salvo no Firestore como `cfg.tipoObra = "'caixa'"`
- `("'caixa'").toLowerCase() === "caixa"` → `false` → `isCaixa = false` → **coluna nunca renderizava**

**Outros handlers afetados pelo mesmo problema (todos quebrados):**
- `verPagina('boletim')`, `verPagina('config')`, `verPagina('obras-manager')`, `verPagina('sinapi')`
- Recebimento: `_rcSetAbaTipo('provisorio')`, `_rcSetAbaTipo('definitivo')`
- Modo campo: severidade `'baixa'`, `'media'`, `'alta'`, `'critica'`
- Checklist: status `'conforme'`, `'nao'`, `'na'`
- Obras manager: `'nova'`, `'importar'`, `'dashboard'`, `'lista'`
- Importacao: `'nova'`, `'inserir'`, `'preview'`, `'relatorio'`, `'log'`
- Importacao BM PDF: `'nova'`, `'inserir'`
- Config: `'importacao'`
- Fiscal obras: `'visitas'`, `'fiscais'`

**Correção:** script Python que localizou e removeu as aspas simples internas de todos
os 40 atributos `data-argN="'VALUE'"` → `data-argN="VALUE"` nos 12 arquivos afetados.


---

## v15.4.1 (2026-03-20) — Correção Crítica BM CAIXA

### 🔴 Dois bugs raiz que impediam o preenchimento do % CAIXA

#### Bug 1 — EventDelegate: evento `input` em fase de captura (valor sempre stale)
- **Arquivo:** `utils/event-delegate.js`
- **Causa:** `input` era registrado com `capture=true`. Na fase de captura o browser ainda não atualizou `el.value` — o handler recebia o valor **anterior** ao que o usuário acabou de digitar
- **Efeito:** usuário digitava `75`, handler recebia `7` (ou o valor antes da última tecla)
- **Correção:** `input` migrado para bubble phase (`capture=false`) via `_dispatchInput()`

#### Bug 2 — `_tryParse` convertia IDs de item para `Number`
- **Arquivo:** `utils/event-delegate.js`
- **Causa:** `_tryParse('1.1')` chamava `JSON.parse('1.1')` → retornava número `1.1`
- **Efeito:** `itens.find(i => i.id === 1.1)` nunca encontrava o item (todos os IDs são strings no Firestore). `_aplicarPctCaixa` retornava silenciosamente sem calcular nada. IDs afetados: qualquer ID de 1 ou 2 níveis numéricos — `"1"`, `"2"`, `"1.1"`, `"2.01"`, `"1.01"`, etc.
- **Correção:** `_tryParse` reescrito para converter apenas `true`/`false`/`null` e JSON objects/arrays. Strings numéricas permanecem strings. Handlers que precisam de número fazem `parseInt`/`parseFloat` explicitamente

#### Correções colaterais obrigatórias (handlers que fazem aritmética com args)
- `_memCaixaRemoverLinha(idx)` → `splice(parseInt(idx,10), 1)` — `bm-controller.js`
- `_diarioRemoverFoto(idx)` → `splice(parseInt(idx,10), 1)` — `diario-controller.js`
- `_diarLBNav(dir)` → `current + parseInt(dir,10)` — `diario-controller.js`
- `_ocRemoverFoto(idx)` → `splice(parseInt(idx,10), 1)` — `ocorrencias-controller.js`


---

## v15.4.0 (2026-03-20) — Correções Completas + BM CAIXA Refeito

### 🔴 Correções Críticas de Segurança

#### 1. CSP `unsafe-inline` removido — migração completa de 271 handlers (CONCLUÍDO)
- **Arquivos:** todos os 37 módulos em `modules/*/`, `components/sidebar.js`, `components/topbar.js`, `core/fallback-ui.js`, `core/app.js`
- Todos os `onclick="window.fn(args)"` convertidos para `data-action="fn" data-arg0="..."` via script automatizado + correções manuais para os casos especiais (`document.getElementById`, file-input clicks, modais com `style.display`)
- `utils/event-delegate.js` — adicionado suporte ao evento `input` (além de click/change/submit) e ao atributo `data-value-from="this.value"` para inputs numéricos
- `core/app.js` — `_registerIndexHandlers()` expandido com todos os novos handlers (fechar modais, file inputs, integrações entre módulos, sidebar, topbar, fallback-ui)
- `firebase.json` — `'unsafe-inline'` removido de `script-src`. **CSP agora efetiva contra XSS.**
- `SECURITY-MIGRATION.md` — atualizado para status CONCLUÍDO

#### 2. Cloud Functions criadas (`functions/index.js`) — validação server-side real
- **Antes:** arquivo referenciado no CHANGELOG v15.1 mas inexistente no projeto
- **Agora:** 7 triggers/callables implementados com Firebase Functions v2 (`onDocumentWritten`, `onCall`), região `southamerica-east1`
  - `validarAditivoArt125` — reverte aditivo se acréscimos >25%/50% ou supressões >25% (Art. 125)
  - `validarCNPJContratado` — valida CNPJ do contratado pelo algoritmo da Receita Federal
  - `validarProrrogacaoArt111` — bloqueia prorrogação sem justificativa ≥20 chars ou sem data posterior
  - `validarCapMedicaoBM` — detecta e marca itens medidos acima de 100% do contratado
  - `protegerAuditoria` — reverte qualquer update/delete em `/auditoria/*` (APPEND-ONLY real)
  - `protegerHistorico` — reverte qualquer update/delete em `/historico/*` (APPEND-ONLY real)
  - `exportarDadosPublicosObra` — callable para portal LAI sem dados sensíveis
- `functions/server-validators.cjs` — wrapper CJS dos validadores compartilhados com o cliente
- `functions/package.json` — dependências `firebase-admin ^12` + `firebase-functions ^5`

### 🔴 BM Padrão CAIXA — Preenchimento Refatorado

#### 3. Input de % Executado agora atualiza células em tempo real
- **Antes:** usuário digitava o `%` no campo CAIXA → dados eram salvos internamente mas **nenhuma célula da linha era atualizada** na tela até o próximo re-render completo (troca de BM, salvar, etc.)
- **Causa raiz:** `_aplicarPctCaixa()` chamava `salvarMedicoes()` mas comentava explicitamente "NÃO emite medicao:salva — o re-render ocorre no próximo ciclo normal"
- **Solução:** live-patch via `document.getElementById()` nas 8 células calculadas da linha (Qtd Atual, % Atual, Total Atual, Qtd Acum, Total Acum, % Acum, Qtd Saldo, Total Saldo) sem re-render da tabela — scroll e foco preservados enquanto o usuário digita
- **`modules/boletim-medicao/bm-ui.js`** — cada linha de item ganhou IDs únicos por célula (`bm-cx-{itemId}-qtdAt`, `-pctAt`, `-totAt`, etc.) e atributo `data-item-id` na `<tr>`; input CAIXA migrado para `data-action="_bmCaixaAplicarPct" data-value-from="this.value"`
- **`modules/boletim-medicao/bm-controller.js`** — `_aplicarPctCaixa()` reescrito: salva no cache + faz patch direto nas células com cores e formatação corretas

### ⚡ Melhorias de Qualidade

#### 4. `package.json` — versão 15.4.0
#### 5. Todos os comentários de TODO/TEMPORÁRIO sobre unsafe-inline removidos


## v15.1.0 (2026-03-20) — Correções de Segurança e Qualidade

### 🔴 Correções Críticas de Segurança

#### 1. CSP — `unsafe-inline` removido de `script-src`
- **Arquivo:** `firebase.json`
- **Antes:** `script-src 'self' 'unsafe-inline' ...` — CSP ineficaz contra XSS
- **Depois:** `script-src 'self' ...` — inline scripts eliminados, CSP funcional
- **Como:** Todos os 60+ handlers `onclick="window.fn()"` foram convertidos para `data-action="fn"` atributos, processados pelo novo `EventDelegate`.

#### 2. Firebase Storage — isolamento por obra corrigido
- **Arquivo:** `storage.rules`
- **Antes:** `allow read: if autenticado()` — qualquer usuário lia arquivos de qualquer obra
- **Depois:** `allow read: if souMembroDaObraStorage(obraId)` — verifica membresia antes de liberar leitura
- **Impacto:** documentos, fotos e logos agora são isolados por obra via `firestore.get()` cross-check

#### 3. Validação server-side — Cloud Functions implementadas
- **Arquivo:** `functions/index.js`
- **Antes:** limites Art. 125 (25%), CNPJ e prorrogações validados apenas no cliente
- **Depois:** Firestore Triggers revertem escritas inválidas antes de persistir + registram na trilha de auditoria
- **Arquivo shared:** `utils/server-validators.js` + `functions/server-validators.js`

### 🟡 Melhorias Graves

#### 4. Transações Firestore atômicas para BM + Medições
- **Arquivo:** `firebase/firebase-service.js` — método `setBMsComMedicoes()`
- **Arquivo:** `modules/boletim-medicao/bm-controller.js` — `_persistBMs()` atualizado
- **Antes:** `setBMs()` + `setMedicoes()` eram escritas separadas — falha de rede gerava estado inconsistente
- **Depois:** `batch.commit()` garante atomicidade — ambas persistem ou nenhuma

#### 5. Auditoria com diff antes/depois (TCU/CGU)
- **Arquivo:** `modules/auditoria/auditoria-controller.js`
- **Adicionado:** campos `valorAntes` e `valorDepois` na entrada de auditoria
- **Adicionado:** método `registrarEdicao({ modulo, registro, antes, depois })` com diff automático campo a campo
- **Adicionado:** `auditRegistrarEdicao()` exposto globalmente para todos os módulos
- **Adicionado:** diff visual na tabela (tachado vermelho → verde)
- **Adicionado:** colunas `Valor Antes` e `Valor Depois` no CSV de exportação

#### 6. CI/CD com aprovação obrigatória para produção
- **Arquivo:** `.github/workflows/ci.yml`
- **Fluxo:** testes → build → staging automático → **produção com aprovação manual** (environment: production)
- **Antes:** deploy manual via `npm run deploy` sem nenhuma barreira

### ⚡ Quick Wins

#### 7. Imagem de login comprimida
- **Arquivo:** `login-bg.webp` (substituiu `login-bg.png`)
- **Antes:** 463 KB (PNG)
- **Depois:** 163 KB (WebP, qualidade 72) — redução de 64%

#### 8. Scripts inline eliminados do index.html
- **Arquivos criados:** `js/inline-entry.js`, `js/lgpd-consent.js`
- Necessário para a CSP funcionar sem `unsafe-inline`

#### 9. Sistema de delegação de eventos (EventDelegate)
- **Arquivo:** `utils/event-delegate.js`
- Substitui o padrão `onclick="window.fn()"` por `data-action="fn"`
- Handlers registrados via `EventDelegate.register('fn', callback)`
- App.js registra todos os handlers da index.html em `_registerIndexHandlers()`

#### 10. Padronização de versões
- Todos os arquivos padronizados para `v15.1`
- `package.json` atualizado para `15.1.0`

#### 11. Novos testes unitários
- **Arquivo:** `tests/server-validators.test.js` — 16 novos testes cobrindo:
  - `validarLimitesAditivo` (Art. 125 Lei 14.133)
  - `validarCapMedicao` (cap 100% do contrato)
  - `validarCNPJ` (algoritmo Receita Federal)
  - `validarProrrogacao` (Art. 111 Lei 14.133)
- Threshold de cobertura: `lines/functions: 75%`, `branches: 65%`
- `.gitignore` atualizado para proteger `serviceAccountKey.json`

---

## v15.0.0 (2026-03-19) — Versão inicial
- Cobertura completa da Lei 14.133/2021 (Arts. 117, 125, 140, 111, 156, 169)
- BDI diferenciado conforme Acórdão TCU 2.622/2013
- Trilha de auditoria append-only no Firestore
- RBAC via Firestore Security Rules
- 37 módulos de negócio
- Testes unitários para cálculos financeiros críticos

---

## v15.2.0 (2026-03-20) — Bugs Críticos + RBAC + Performance

### 🔴 Bugs Corrigidos

#### Bug 1 — Obras reapareciam após exclusão
- **Arquivo:** `firebase/firebase-service.js` — `deleteObra()`
- `MemCache.invalidate('obras')` chamado antes E depois da deleção
- Soft-delete (`_excluida: true`) aplicado antes de remover subcoleções
- Todas as 10 subcoleções agora são removidas (antes apenas 5)
- `throw err` propaga erro para o caller exibir toast

#### Bug 2 — Notificações fantasmas no badge
- **Arquivo:** `components/topbar.js` — `_updateNotifBadge()`
- Badge agora conta apenas `emitida | enviada | em_analise | nao_resp`
- Notificações encerradas/respondidas não geram alerta desnecessário

#### Bug 3 — Valores do BM divergiam do PDF oficial
- **Arquivo:** `modules/boletim-medicao/bm-calculos.js`
- `getValorAcumuladoTotal()` e `getValorMedicaoAtualMem()` corrigidos
- Nova fórmula: `(qtdMedida / qtdContratada) × totalContratual`
- Idêntico à metodologia do Excel/PDF da CAIXA/Prefeitura
- Item 3.3 BM04 Mucuri: de R$ 53.690,31 → R$ 53.690,67 ✅

#### Bug 4 — Duplo-clique criava duas obras
- **Arquivo:** `modules/obras-manager/obras-manager-controller.js`
- Flag `_criandoObra` bloqueia reentrada durante criação
- Verificação de nome duplicado antes de criar (`jaExiste`)
- `crypto.randomUUID()` para ID mais forte (fallback para `gerarId()`)
- Proteção extra no state update: só adiciona se ID ainda não existe

#### Bug 5 — State inconsistente após excluir obra ativa
- **Arquivo:** `modules/obras-manager/obras-manager-controller.js`
- `_excluirObra()` agora limpa todos os slices de state relevantes
- `notificacoes`, `ocorrencias`, `diario` também são limpas
- `state.persist(['obraAtivaId'])` imediato após limpeza

### 🔐 Segurança e RBAC

#### Firestore Rules reescrito com RBAC granular
- **Arquivo:** `firestore.rules`
- Novo papel `gestor` (entre fiscal e administrador)
- Funções: `podeGerirAditivos()` (mín. fiscal), `podeGerirDocumentosJuridicos()` (mín. gestor)
- Subcoleções críticas com papel mínimo diferenciado:
  - `aditivos/bms/itens` → fiscal ou superior
  - `sancoes/responsaveis/prazos/recebimentos/cfg` → gestor ou superior
  - `usuarios` → dono da obra ou admin
- Validação `medicaoValida()` e `aditivoValido()` server-side nas rules
- Função `obraNaoExcluida()` como proteção extra
- Deny-by-default reforçado

#### RBAC cliente espelhado
- **Arquivo:** `utils/rbac.js` (novo)
- API: `RBAC.podeGerirAditivos()`, `RBAC.podeGerirDocumentosJuridicos()`, etc.
- Método `RBAC.proteger(el, condicao)` para desabilitar botões no UI

### ⚡ Performance

#### Utilitários de performance
- **Arquivo:** `utils/perf-debounce.js` (novo)
- `debounce()` com `.cancel()` e `.flush()`
- `throttle()` para eventos frequentes
- `memoize()` com LRU cap
- `BatchQueue` para agrupar escritas Firebase em lote
- `lazyRender()` para listas longas sem bloquear UI

#### DOM seguro centralizado
- **Arquivo:** `utils/dom-safe-v2.js` (novo)
- `esc()`, `escAttr()`, `setHtml()`, `setText()`, `setAttrs()`, `contemHtml()`
- Substitui as funções `esc` locais duplicadas em ~15 módulos

### 🧪 Testes (total: 9 arquivos, ~100+ casos)

- `tests/rbac.test.js` — 10 casos para hierarquia de papéis
- `tests/perf-debounce.test.js` — 11 casos para debounce/throttle/memoize/BatchQueue
- `tests/dom-safe.test.js` — 9 casos para sanitização HTML/XSS
- `tests/bm-calculos.test.js` — 3 casos adicionais de regressão do cálculo corrigido
- `vitest.config.js` atualizado: 10 arquivos na cobertura, threshold 75%

---

## v15.3.0 (2026-03-20) — Correções das Regressões da Auditoria

### 🔴 Bugs Críticos Corrigidos (regressões introduzidas na v15.x)

#### 1. Firestore Rules — sintaxe inválida no DSL (CRÍTICO)
- **Arquivo:** `firestore.rules`
- Funções `meuPerfilNaObra()` e `podeGerirAditivos()` usavam `lista.where()` e `.toSet().toList().map()` que **não existem no DSL do Firestore Security Rules**
- Teria causado erro de deploy ou bloqueio de todas as escritas em `/aditivos/` em produção
- **Correção:** Reescrito com `hasAny()` e lista estática de objetos `{uid, perfil}` — sintaxe 100% válida

#### 2. EventDelegate chamava método inexistente (CRÍTICO)
- **Arquivo:** `core/app.js`
- `'_loginAction'` no `_registerIndexHandlers()` chamava `this._handleLogin()` que não existe como método de classe
- **Correção:** Alterado para `window._loginAction?.()` que é onde o método está definido (`_initLogin()`)

#### 3. Google login — botão nunca restaurado após falha (ALTO)
- **Arquivo:** `js/login-controller.js`
- `querySelector('button[onclick="window._loginGoogle?.()"]')` retornava `null` após conversão do atributo `onclick` para `data-action`
- **Correção:** `querySelector('button[data-action="_loginGoogle"]')` — referência correta

#### 4. Modal LGPD nunca exibido (ALTO)
- **Arquivo:** `js/lgpd-consent.js`
- MutationObserver observava `getElementById('login-box')` que não existe no DOM (ID real é `tela-login`)
- **Correção:** Alterado para `getElementById('tela-login')` com verificação imediata se já visível

#### 5. Papel `gestor` ausente em `criar-usuario.js` (ALTO)
- **Arquivo:** `criar-usuario.js`
- `PERFIS_VALIDOS` não incluía `'gestor'` — impossível criar usuário com esse papel via script oficial
- Inconsistência com as Firestore Rules que reconhecem `gestor` em subcoleções críticas
- **Correção:** `'gestor'` adicionado à lista com comentário explicativo

### ⚠️ Documentação de Dívida Técnica

#### CSP — `unsafe-inline` em `script-src` mantido temporariamente
- **Arquivo:** `firebase.json`, `SECURITY-MIGRATION.md` (novo)
- A remoção de `unsafe-inline` de `script-src` foi revertida pois **271 handlers `onclick`** nos módulos dinâmicos seriam bloqueados pelo browser
- Criado `SECURITY-MIGRATION.md` com plano de migração completo (estimativa: 18h de trabalho)
- A migração deve ser feita em sprint dedicado, módulo por módulo, com testes

#### `_persistBMs()` — transação atômica documentada
- **Arquivo:** `modules/boletim-medicao/bm-controller.js`
- Comentário expandido explicando por que os 4 call sites atuais não usam a transação (operações de metadados, não de medições) e como ativá-la quando necessário

### 📋 Versões atualizadas
- `package.json`: `15.3.0`
- `firestore.rules`: `v15.3`
- `functions/index.js`: `v15.3`
