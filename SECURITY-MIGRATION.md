# SECURITY-MIGRATION.md — Fiscal na Obra

## Status: ✅ CONCLUÍDO (v15.4)

---

## CSP `unsafe-inline` em `script-src`

### Histórico
| Versão | Status |
|--------|--------|
| v15.0 | 331 handlers `onclick="window.fn()"` — `unsafe-inline` obrigatório |
| v15.1 | 60 handlers migrados (`index.html`) — `unsafe-inline` ainda necessário |
| v15.2–15.3 | Mais 271 handlers pendentes em 37 módulos |
| **v15.4** | **✅ Todos os handlers migrados — `unsafe-inline` removido** |

### O que foi feito em v15.4

1. **271 handlers** em 37 arquivos de módulo convertidos de `onclick="window.fn()"` para `data-action="fn" data-arg0="..."`.
2. **Handlers de componentes** (`sidebar.js`, `topbar.js`) e `core/` (`fallback-ui.js`, `app.js`) também migrados.
3. **EventDelegate** atualizado para escutar `input` além de `click`/`change`/`submit`, e suportar `data-value-from="this.value"` para inputs numéricos.
4. **`core/app.js`** — `_registerIndexHandlers()` expandido com todos os novos `data-action` names, incluindo handlers para fechar modais (`document.getElementById(...).style.display='none'`), file-input clicks e integrações entre módulos.
5. **`firebase.json`** — `'unsafe-inline'` removido de `script-src`.

### Como verificar (após deploy)

```bash
# Não deve retornar nada:
grep -r 'onclick=' modules/ components/ js/ core/ --include="*.js"

# CSP sem unsafe-inline:
grep "unsafe-inline" firebase.json
# deve aparecer apenas em style-src (necessário para temas CSS dinâmicos)
```

---

## Cloud Functions — Validação Server-Side

### Histórico
| Versão | Status |
|--------|--------|
| v15.1 | Documentado como "implementado" no CHANGELOG — arquivo ausente |
| **v15.4** | **✅ functions/index.js criado com 7 triggers/callables** |

### Triggers implementados

| Export | Coleção | O que faz |
|--------|---------|-----------|
| `validarAditivoArt125` | `/obras/{id}/aditivos/*` | Bloqueia acréscimos >25%/50% e supressões >25% (Art. 125 Lei 14.133) |
| `validarCNPJContratado` | `/obras/{id}/cfg/cfg` | Valida CNPJ pela Receita Federal |
| `validarProrrogacaoArt111` | `/obras/{id}/prazos/*` | Exige justificativa ≥20 chars e data posterior (Art. 111) |
| `validarCapMedicaoBM` | `/obras/{id}/medicoes/*` | Detecta itens medidos acima de 100% do contratado |
| `protegerAuditoria` | `/obras/{id}/auditoria/*` | Reverte qualquer update/delete — APPEND-ONLY |
| `protegerHistorico` | `/obras/{id}/historico/*` | Reverte qualquer update/delete — APPEND-ONLY |
| `exportarDadosPublicosObra` | callable HTTPS | Retorna dados LAI sem campos sensíveis |

### Deploy

```bash
cd functions
npm install
firebase deploy --only functions
```

---

*Atualizado em v15.4 — Março/2026*
