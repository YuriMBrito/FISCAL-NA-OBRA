# 🏗️ Fiscal na Obra v15 — Sistema de Fiscalização de Obras Públicas

> Lei 14.133/2021 · TCU · CGU · LGPD · Firebase

---

## 📋 Visão Geral

Sistema web para fiscalização de obras públicas conforme a **Nova Lei de Licitações (Lei 14.133/2021)**. Cobre o ciclo completo de acompanhamento contratual: Boletins de Medição, Aditivos, Diário de Obra, Ocorrências, Notificações, Sanções, Recebimento Provisório/Definitivo, SINAPI, e geração de relatórios CGU/TCU.

---

## 🚀 Início Rápido

```bash
# 1. Instalar dependências
npm install

# 2. Desenvolvimento local
npm run dev        # → http://localhost:5000

# 3. Build de produção
npm run build      # → dist/

# 4. Deploy Firebase
npm run deploy

# 5. Testes
npm test           # roda todos os testes
npm run test:watch # modo watch
npm run test:coverage  # com relatório de cobertura
```

---

## 🔒 Checklist de Segurança Obrigatório Antes do Deploy

### Imediato (bloqueante para produção)

- [ ] **Restringir API Key no Google Cloud Console**
  - Acesse: https://console.cloud.google.com/apis/credentials
  - Localize "Browser key (auto created by Firebase)"
  - Adicione restrições HTTP para seus domínios apenas
  - Sem isso, qualquer pessoa usa sua cota Firebase

- [ ] **Migrar Custom Claims de todos os usuários**
  ```bash
  # Dry-run primeiro (não aplica, só lista)
  node criar-usuario.js --migrar --dry-run

  # Depois aplica de verdade
  node criar-usuario.js --migrar
  ```
  Necessário para que as Storage Rules (Fase 2) funcionem corretamente.

- [ ] **Verificar SRI hashes dos CDNs no index.html**
  Os hashes no `index.html` são fixos para as versões pinadas. Se atualizar versões de CDN, regenere:
  ```bash
  node scripts/generate-sri.js
  ```

### Antes de ir para produção com múltiplos órgãos

- [ ] Definir estratégia de multi-tenancy (projeto Firebase por órgão ou tenant separation)
- [ ] Designar DPO conforme Art. 41 LGPD — ver `LGPD.md`
- [ ] Elaborar RIPD — ver `LGPD.md` seção 7
- [ ] Configurar backup automático do Firestore (Firebase Console → Firestore → Backups)
- [ ] Definir plano de continuidade e SLA

---

## 🗄️ Estrutura do Banco (Firestore)

```
/usuarios/{uid}                   → perfil e papel do usuário
/obras/{obraId}                   → documento principal
  /cfg/cfg                        → dados contratuais
  /bms/bms                        → boletins de medição
  /itens/{chunkId}                → itens contratuais (chunks ≤ 1MB)
  /medicoes/{bmId}                → medições detalhadas
  /aditivos/{aditivoId}           → aditivos contratuais
  /auditoria/{docId}              → trilha APPEND-ONLY (imutável)
  /historico/{docId}              → histórico APPEND-ONLY (imutável)
  /ocorrencias/{docId}            → ocorrências (documentos individuais)
  /diario/{docId}                 → diário de obra (documentos individuais)
  /notificacoes/lista             → notificações
  /documentos/lista               → documentos vinculados
  /usuarios/lista                 → usuários vinculados à obra
  /versoes/{versaoId}             → versões contratuais (aditivos)
  /lei14133/{docId}               → responsáveis, sanções, prazos, riscos
  /sancoes/{docId}                → sanções administrativas
  /responsaveis/{docId}           → responsáveis designados (Art. 117)
  /prazos/{docId}                 → prorrogações (Art. 111)
  /recebimentos/{docId}           → recebimento provisório/definitivo (Art. 140)
  /riscos/{docId}                 → matriz de riscos
  /fotos-medicao/{docId}          → metadados (foto em Storage)
  /checklist-tecnico/{docId}      → checklist técnico
  /etapas-pac/{docId}             → etapas PAC
  /qualidade/{docId}              → controle de qualidade
/lixeira/{itemId}                 → soft-delete por usuário
```

### Firebase Storage

```
obras/{obraId}/logo               → logo da obra (≤ 2MB, imagem)
obras/{obraId}/docs/{arquivo}     → documentos (≤ 20MB, PDF/imagem/Excel/Word)
obras/{obraId}/fotos-medicao/{arquivo} → fotos (≤ 10MB, imagem)
```

---

## 👥 Perfis de Acesso

| Perfil | Pode criar/editar | Pode excluir | Admin global |
|--------|------------------|--------------|--------------|
| `administrador` | ✅ | ✅ | ✅ |
| `fiscal` | ✅ | ❌ | ❌ |
| `engenheiro` | ✅ | ❌ | ❌ |
| `tecnico` | ✅ | ❌ | ❌ |
| `visualizador` | ❌ | ❌ | ❌ |

---

## 🧪 Testes

Os testes cobrem os módulos de maior risco jurídico:

```
tests/
├── formula-engine.test.js      # Motor de cálculos dimensionais (m², m³, m, un)
├── bm-calculos.test.js         # Boletim de Medição, BDI, acumulados, cap 100%
├── aditivos-calculos.test.js   # Acréscimos/supressões, limites Art. 125 Lei 14.133
├── validators.test.js          # CNPJ, email, data, dimensionais
└── unit-normalizer.test.js     # Normalização de unidades
```

```bash
npm test              # todos os testes
npm run test:coverage # cobertura (threshold: 70%)
```

---

## 🏛️ Conformidade Legal

| Norma | Artigo | Módulo |
|-------|--------|--------|
| Lei 14.133/2021 | Art. 117 (Gestor/Fiscal) | Responsáveis |
| Lei 14.133/2021 | Art. 125 (Aditivos 25%) | Aditivos |
| Lei 14.133/2021 | Art. 140 (Recebimento) | Recebimento |
| Lei 14.133/2021 | Art. 111 (Prorrogação) | Prazos |
| Lei 14.133/2021 | Art. 156 (Sanções) | Sanções |
| Lei 14.133/2021 | Art. 169 (Fiscalização) | Diário, BM, Ocorrências |
| Acórdão TCU 2.622/2013 | BDI diferenciado | BM (badge SINAPI) |
| IN CGU nº 5/2017 | Relatório Circunstanciado | Relatório Federal |
| LGPD (Lei 13.709/2018) | Consentimento, Auditoria | Modal LGPD, Auditoria |

---

## 📁 Estrutura do Projeto

```
fiscal-app-fixed/
├── core/                 # Infraestrutura: app.js, router, EventBus, state
├── modules/              # 30+ módulos de negócio (Lei 14.133, BM, Aditivos...)
├── firebase/             # Camada Firebase (único ponto de acesso)
├── utils/                # Funções puras: formatters, validators, formula-engine
├── components/           # Componentes: sidebar, topbar, toast, confirm
├── css/                  # Design system, themes, components
├── js/                   # Login, Firebase loader/stub
├── tests/                # Testes Vitest (execute: npm test)
├── firestore.rules       # Regras de segurança Firestore (RBAC)
├── storage.rules         # Regras Firebase Storage (Custom Claims Fase 2)
├── firebase.json         # Headers CSP, HSTS, X-Frame-Options
├── firestore.indexes.json # 10 índices compostos
├── criar-usuario.js      # Criar usuários + migração Custom Claims em lote
├── LGPD.md               # Política de privacidade e checklist LGPD
└── README.md             # Este arquivo
```

---

## ⚙️ Variáveis de Ambiente / Configuração Firebase

As credenciais Firebase ficam em `firebase-config.js`. A `apiKey` é pública por design — a segurança real vem das Firestore Rules. **Obrigatório:** restringir a chave por domínio HTTP no Google Cloud Console.

---

*Sistema desenvolvido em conformidade com a Nova Lei de Licitações (Lei 14.133/2021) e os padrões de auditoria do TCU/CGU.*
