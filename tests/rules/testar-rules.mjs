/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — firestore.rules                                    ║
 * ║  Rodar: npm run test:rules                                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * A política vigente (27/10/2026) é: LEITURA para qualquer autenticado,
 * ESCRITA por papel, lido do custom claim 'role' do token. O que estes
 * testes protegem:
 *
 *   1. Sem sessão, nada passa.
 *   2. Cada papel escreve só até onde deve — e o nível de cada subcoleção
 *      é o de nivelExigido() nas rules.
 *   3. Conta SEM o claim 'role' cai em 'fiscal' e não fica trancada fora
 *      (foi o travamento geral que derrubou o modelo de papéis anterior).
 *   4. As exceções que valem para todo mundo: create em /usuarios,
 *      update em auditoria/historico, update na lixeira.
 *
 * Vitest não serve aqui: quem avalia as rules é o emulador do Firestore.
 * Sem dependências novas — o emulador aceita JWT não assinado ("alg":"none")
 * como token de usuário, e claims no payload chegam em request.auth.token;
 * "Bearer owner" ignora as rules e é usado só no seed.
 * A porta 8099 vem de firebase.emulator.json (a 8080 costuma estar ocupada).
 * Se der "port taken", a JVM do emulador anterior ficou pendurada:
 *   Get-NetTCPConnection -LocalPort 8099 -State Listen | Stop-Process -Id { $_.OwningProcess } -Force
 */
const BASE = 'http://127.0.0.1:8099/v1/projects/demo-fiscal/databases/(default)/documents';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * Token de usuário. `claims` entra no payload e o emulador o expõe em
 * request.auth.token — é assim que o Admin SDK entrega 'role' e
 * 'adminGlobal' (ver criar-usuario.cjs / definir-perfil.mjs).
 * Sem `claims`, o token sai igual ao de uma conta nunca migrada.
 */
function token(uid, email, claims = {}) {
  const agora = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({
      iss: 'https://securetoken.google.com/demo-fiscal',
      aud: 'demo-fiscal', sub: uid, user_id: uid, email,
      email_verified: true, iat: agora, exp: agora + 3600,
      ...claims,
      firebase: { identities: { email: [email] }, sign_in_provider: 'password' },
    }),
    '',
  ].join('.');
}

// JS → formato REST do Firestore
function val(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string')  return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(val) } };
  return { mapValue: { fields: campos(v) } };
}
const campos = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));

// auth: string = token/"owner"; null = requisição sem sessão.
async function gravar(caminho, dados, auth) {
  const r = await fetch(`${BASE}/${caminho}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify({ fields: campos(dados) }),
  });
  return r.status;
}

async function ler(caminho, auth) {
  const r = await fetch(`${BASE}/${caminho}`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });
  return r.status;
}

async function apagar(caminho, auth) {
  const r = await fetch(`${BASE}/${caminho}`, {
    method: 'DELETE',
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });
  return r.status;
}

// ── Contas, uma por papel ────────────────────────────────────
// Nenhuma é dona de obra; nenhuma tem documento de perfil no Firestore.
// O papel vem SÓ do claim, que é o ponto da mudança de 27/10/2026.
const VISUALIZADOR = token('uid-vis',  'vis@pmm.gov.br',  { role: 'visualizador' });
const TECNICO      = token('uid-tec',  'tec@pmm.gov.br',  { role: 'tecnico' });
const ENGENHEIRO   = token('uid-eng',  'eng@pmm.gov.br',  { role: 'engenheiro' });
const FISCAL       = token('uid-fis',  'fis@pmm.gov.br',  { role: 'fiscal' });
const GESTOR       = token('uid-ges',  'ges@pmm.gov.br',  { role: 'gestor' });
const ADMIN        = token('uid-adm',  'adm@pmm.gov.br',  { role: 'administrador', adminGlobal: true });

// Conta legada: criada no Console antes dos claims existirem. Tem de cair
// no papelPadrao() das rules ('fiscal'), nunca em bloqueio total.
const SEM_CLAIM    = token('uid-velho', 'moreira.yuri@outlook.com.br');

// ── Seed (ignora rules) ──────────────────────────────────────
await gravar('obras/obra1', { id: 'obra1', nome: 'UBS Triângulo', uid: 'uid-dono' }, 'owner');
await gravar('obras/obra1/auditoria/reg1', { acao: 'criou BM', ts: 1 }, 'owner');
await gravar('obras/obra1/historico/reg1', { acao: 'editou item', ts: 1 }, 'owner');
await gravar('obras/obra2', { id: 'obra2', nome: 'Creche', uid: 'uid-dono' }, 'owner');
await gravar('lixeira/item1', { uid: 'uid-dono', obraId: 'obra9' }, 'owner');
await gravar('lixeira/item2', { uid: 'uid-dono', obraId: 'obra8' }, 'owner');

const dadosChuva = { dados: { '2026-08-12': { manha: 'sol', tarde: 'chuva', noite: null, obs: '' } } };

// ── Casos ────────────────────────────────────────────────────
const casos = [
  // ═══ A porta de fora: sem sessão, nada ═══
  ['SEM sessão não lê',
    () => ler('obras/obra1', null), 403],
  ['SEM sessão não grava',
    () => gravar('obras/obra1/chuva/2024', dadosChuva, null), 403],

  // ═══ Leitura: qualquer autenticado, em qualquer obra ═══
  ['visualizador lê obra de outro',
    () => ler('obras/obra1', VISUALIZADOR), 200],
  ['visualizador lê a trilha de auditoria',
    () => ler('obras/obra1/auditoria/reg1', VISUALIZADOR), 200],

  // ═══ visualizador (0): lê tudo, escreve nada ═══
  ['visualizador NÃO grava o clima',
    () => gravar('obras/obra1/chuva/2026', dadosChuva, VISUALIZADOR), 403],
  ['visualizador NÃO grava em subcoleção imprevista',
    () => gravar('obras/obra1/modulo-novo/doc1', { x: 1 }, VISUALIZADOR), 403],

  // ═══ tecnico (1): campo sim, dinheiro e contrato não ═══
  ['tecnico grava o clima',
    () => gravar('obras/obra1/chuva/2026', dadosChuva, TECNICO), 200],
  ['tecnico grava entrada de diário',
    () => gravar('obras/obra1/diario/d1', { texto: 'concretagem' }, TECNICO), 200],
  ['tecnico grava em subcoleção que ninguém previu (cai no nível 1)',
    () => gravar('obras/obra1/modulo-novo/doc1', { x: 1 }, TECNICO), 200],
  ['tecnico NÃO grava medição',
    () => gravar('obras/obra1/medicoes/bm1', { data: { i1: { qtd: 5 } } }, TECNICO), 403],
  ['tecnico NÃO grava a configuração contratual',
    () => gravar('obras/obra1/cfg/cfg', { objeto: 'UBS' }, TECNICO), 403],

  // ═══ engenheiro (2): medição e aditivo sim, contrato não ═══
  ['engenheiro grava medição',
    () => gravar('obras/obra1/medicoes/bm1', { data: { i1: { qtd: 5 } } }, ENGENHEIRO), 200],
  ['engenheiro grava a lista de BMs',
    () => gravar('obras/obra1/bms/bms', { bms: [{ num: 1 }] }, ENGENHEIRO), 200],
  ['engenheiro grava aditivo',
    () => gravar('obras/obra1/aditivos/ad1', { tipo: 'prazo', valor: 0 }, ENGENHEIRO), 200],
  ['engenheiro NÃO grava a configuração contratual',
    () => gravar('obras/obra1/cfg/cfg', { objeto: 'UBS' }, ENGENHEIRO), 403],
  ['engenheiro NÃO grava sanção',
    () => gravar('obras/obra1/sancoes/s1', { tipo: 'advertencia' }, ENGENHEIRO), 403],

  // ═══ gestor (4): contrato e jurídico sim, excluir obra não ═══
  ['gestor grava a configuração contratual',
    () => gravar('obras/obra1/cfg/cfg', { objeto: 'UBS', contrato: 'CE01-25' }, GESTOR), 200],
  ['gestor grava sanção',
    () => gravar('obras/obra1/sancoes/s1', { tipo: 'advertencia' }, GESTOR), 200],
  ['gestor grava prazo',
    () => gravar('obras/obra1/prazos/p1', { dias: 30 }, GESTOR), 200],
  ['gestor edita o documento raiz da obra',
    () => gravar('obras/obra1', { nome: 'UBS Triângulo Leal' }, GESTOR), 200],
  ['gestor esvazia item da lixeira',
    () => apagar('lixeira/item2', GESTOR), 200],
  ['gestor NÃO exclui a obra',
    () => apagar('obras/obra2', GESTOR), 403],
  ['gestor NÃO mexe na lista de usuários da obra',
    () => gravar('obras/obra1/usuarios/lista', { lista: [] }, GESTOR), 403],

  // ═══ fiscal (3): acima de engenheiro, abaixo de gestor ═══
  ['fiscal grava medição',
    () => gravar('obras/obra1/medicoes/bm2', { data: {} }, FISCAL), 200],
  ['fiscal NÃO grava a configuração contratual',
    () => gravar('obras/obra1/cfg/cfg', { objeto: 'X' }, FISCAL), 403],

  // ═══ administrador (5) ═══
  ['administrador mexe na lista de usuários da obra',
    () => gravar('obras/obra1/usuarios/lista', { lista: [] }, ADMIN), 200],
  ['administrador exclui a obra',
    () => apagar('obras/obra2', ADMIN), 200],

  // ═══ Conta legada, sem o claim: vira 'fiscal', não vira bloqueio ═══
  ['sem claim grava entrada de diário',
    () => gravar('obras/obra1/diario/d2', { texto: 'alvenaria' }, SEM_CLAIM), 200],
  ['sem claim grava medição (papelPadrao = fiscal)',
    () => gravar('obras/obra1/medicoes/bm3', { data: {} }, SEM_CLAIM), 200],
  ['sem claim NÃO grava a configuração contratual',
    () => gravar('obras/obra1/cfg/cfg', { objeto: 'X' }, SEM_CLAIM), 403],

  // ═══ Exceções que valem para todo mundo ═══
  ['auditoria aceita registro novo de qualquer papel',
    () => gravar('obras/obra1/auditoria/reg2', { acao: 'salvou clima', ts: 2 }, TECNICO), 200],
  ['auditoria NÃO aceita reescrever registro passado',
    () => gravar('obras/obra1/auditoria/reg1', { acao: 'nada aconteceu' }, ADMIN), 403],
  ['auditoria NÃO é apagada por quem não é administrador',
    () => apagar('obras/obra1/auditoria/reg2', GESTOR), 403],
  ['historico NÃO aceita reescrever registro passado',
    () => gravar('obras/obra1/historico/reg1', { acao: 'nada aconteceu' }, ADMIN), 403],
  ['lixeira aceita item novo de tecnico (excluir diário/BM passa aqui)',
    () => gravar('lixeira/item3', { uid: 'uid-tec', obraId: 'obra1' }, TECNICO), 200],
  ['item da lixeira é imutável',
    () => gravar('lixeira/item1', { obraId: 'outra' }, ADMIN), 403],
  ['tecnico NÃO esvazia a lixeira',
    () => apagar('lixeira/item1', TECNICO), 403],
  ['ninguém se autodeclara administrador',
    () => gravar('usuarios/uid-tec', { perfil: 'administrador' }, TECNICO), 403],
  ['coleção fora de /usuarios, /obras e /lixeira continua bloqueada',
    () => gravar('qualquer-outra/doc1', { x: 1 }, ADMIN), 403],
];

let falhas = 0;
for (const [nome, executar, esperado] of casos) {
  const status = await executar();
  const ok = status === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? '✔' : '✖'}  ${nome}  →  HTTP ${status} (esperado ${esperado})`);
}

console.log(falhas ? `\n${falhas} de ${casos.length} caso(s) falharam.\n`
                   : `\nTodos os ${casos.length} casos passaram.\n`);
process.exit(falhas ? 1 : 0);
