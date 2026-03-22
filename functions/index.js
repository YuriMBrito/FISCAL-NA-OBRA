/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — functions/index.js                                    ║
 * ║  PLANO GRATUITO (Spark) — Cloud Functions DESATIVADAS                   ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  MOTIVO: O plano Spark (gratuito) do Firebase não suporta               ║
 * ║  Cloud Functions. Este arquivo foi esvaziado para permitir              ║
 * ║  operação 100% gratuita sem cobranças.                                  ║
 * ║                                                                          ║
 * ║  ONDE FOI CADA VALIDAÇÃO:                                               ║
 * ║                                                                          ║
 * ║  1. validarAditivoArt125 (Art. 125 Lei 14.133)                         ║
 * ║     → modules/aditivos/aditivos-controller.js                           ║
 * ║       Método _salvarAditivo() — validação client-side completa          ║
 * ║                                                                          ║
 * ║  2. validarCNPJContratado (Receita Federal)                             ║
 * ║     → modules/config/config-controller.js                               ║
 * ║       Método _salvarConfig() — usa validarCNPJ() de server-validators   ║
 * ║                                                                          ║
 * ║  3. validarProrrogacaoArt111 (Art. 111 Lei 14.133)                     ║
 * ║     → modules/prazos/prazos-controller.js                               ║
 * ║       Método _prazoSalvarProrr() — validação de justificativa e data    ║
 * ║                                                                          ║
 * ║  4. validarCapMedicaoBM (Cap 100% por item)                             ║
 * ║     → modules/boletim-medicao/bm-controller.js                          ║
 * ║       Método _marcarSalvoBol() — usa validarCapMedicao() de             ║
 * ║       server-validators antes de bloquear o BM                          ║
 * ║                                                                          ║
 * ║  5. protegerAuditoria (APPEND-ONLY)                                     ║
 * ║     → firestore.rules: allow update: if false (já implementado)         ║
 * ║       Regra nativa do Firestore — sem custo                             ║
 * ║                                                                          ║
 * ║  6. protegerHistorico (APPEND-ONLY)                                     ║
 * ║     → firestore.rules: allow update: if false (já implementado)         ║
 * ║       Regra nativa do Firestore — sem custo                             ║
 * ║                                                                          ║
 * ║  7. exportarDadosPublicosObra (portal LAI)                              ║
 * ║     → modules/exportacao-obra/exportacao-obra-controller.js             ║
 * ║       Leitura direta do Firestore com regras de acesso adequadas        ║
 * ║                                                                          ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  SEGURANÇA MANTIDA:                                                      ║
 * ║  • Firestore Rules continuam aplicando todas as restrições de acesso    ║
 * ║  • Usuário mal-intencionado autenticado ainda é bloqueado pelas Rules   ║
 * ║  • Validações client-side protegem o fluxo UX normal                   ║
 * ║  • Auditoria e histórico continuam imutáveis via Firestore Rules        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

'use strict';

// Nenhuma Cloud Function exportada — plano gratuito Spark.
// Todas as validações foram migradas para o cliente e Firestore Rules.
