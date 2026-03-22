/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — criar-usuario.js                          ║
 * ║  Cria usuários no Firebase Authentication + Firestore       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * PRÉ-REQUISITO:
 *   1. Ter o arquivo serviceAccountKey.json nesta mesma pasta
 *      (baixar em: Console Firebase → Configurações → Contas de serviço)
 *   2. Ter instalado: npm install firebase-admin
 *
 * USO:
 *   node criar-usuario.js EMAIL SENHA NOME PERFIL
 *
 * EXEMPLOS:
 *   node criar-usuario.js admin@empresa.com Senha123 "Administrador" administrador
 *   node criar-usuario.js joao@empresa.com Senha456 "João Silva" fiscal
 *   node criar-usuario.js maria@empresa.com Senha789 "Maria Costa" engenheiro
 *
 * PERFIS DISPONÍVEIS:
 *   administrador  → Acesso total ao sistema
 *   fiscal         → Fiscal de Obras
 *   engenheiro     → Engenheiro / Gestor
 *   tecnico        → Técnico
 *   visualizador   → Somente leitura
 */

const admin = require('firebase-admin');

// ── Verifica se o arquivo de credenciais existe ──────────────────
let serviceAccount;
try {
  serviceAccount = require('./serviceAccountKey.json');
} catch (e) {
  console.error('');
  console.error('✖  Arquivo serviceAccountKey.json não encontrado!');
  console.error('');
  console.error('   Para obtê-lo:');
  console.error('   1. Acesse https://console.firebase.google.com');
  console.error('   2. Clique na engrenagem ⚙️ → Configurações do projeto');
  console.error('   3. Aba "Contas de serviço"');
  console.error('   4. Clique em "Gerar nova chave privada"');
  console.error('   5. Salve o arquivo como serviceAccountKey.json nesta pasta');
  console.error('');
  process.exit(1);
}

// ── Inicializa o Firebase Admin ──────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ── Lê os argumentos da linha de comando ────────────────────────
const [,, email, senha, nome, perfil] = process.argv;

const PERFIS_VALIDOS = ['administrador', 'gestor', 'fiscal', 'engenheiro', 'tecnico', 'visualizador'];
// CORREÇÃO v15.3: 'gestor' adicionado — necessário pois as Firestore Rules
// reconhecem este papel para sanções, responsáveis, prazos e recebimentos
// (Art. 117, 125, 156 Lei 14.133/2021), mas o script não permitia criá-lo.

// ── Valida os argumentos ─────────────────────────────────────────
if (!email || !senha) {
  console.log('');
  console.log('USO:');
  console.log('  node criar-usuario.js EMAIL SENHA NOME PERFIL');
  console.log('');
  console.log('EXEMPLOS:');
  console.log('  node criar-usuario.js admin@empresa.com Senha123 "Administrador" administrador');
  console.log('  node criar-usuario.js joao@empresa.com Senha456 "João Silva" fiscal');
  console.log('');
  console.log('PERFIS DISPONÍVEIS:');
  PERFIS_VALIDOS.forEach(p => console.log('  ' + p));
  console.log('');
  process.exit(1);
}

if (senha.length < 6) {
  console.error('✖  A senha deve ter pelo menos 6 caracteres.');
  process.exit(1);
}

const perfilFinal = perfil || 'fiscal';
if (!PERFIS_VALIDOS.includes(perfilFinal)) {
  console.error('✖  Perfil inválido:', perfilFinal);
  console.error('   Perfis válidos:', PERFIS_VALIDOS.join(', '));
  process.exit(1);
}

const nomeFinal = nome || email.split('@')[0];

// ── Cria o usuário ───────────────────────────────────────────────
async function criarUsuario() {
  console.log('');
  console.log('Criando usuário...');

  try {
    // 1. Cria no Authentication
    const usuario = await admin.auth().createUser({
      email: email,
      password: senha,
      displayName: nomeFinal,
      emailVerified: false,
    });

    console.log('✔  Usuário criado no Authentication');

        // 2. Define Custom Claims no token de autenticação
    //    Necessário para as Storage Rules (role, adminGlobal)
    //    e para verificação de perfil sem Firestore lookup adicional.
    await admin.auth().setCustomUserClaims(usuario.uid, {
      role:        perfilFinal,
      adminGlobal: perfilFinal === 'administrador',
    });

    console.log('✔  Custom Claims definidos (role: ' + perfilFinal + ')');

    // 3. Cria o perfil no Firestore
    await admin.firestore().collection('usuarios').doc(usuario.uid).set({
      uid:       usuario.uid,
      email:     email,
      nome:      nomeFinal,
      perfil:    perfilFinal,
      criadoEm:  new Date().toISOString(),
    });

    console.log('✔  Perfil criado no banco de dados');
    console.log('');
    console.log('════════════════════════════════════════════');
    console.log('  ✅ Usuário criado com sucesso!');
    console.log('────────────────────────────────────────────');
    console.log('  UID:    ', usuario.uid);
    console.log('  Email:  ', email);
    console.log('  Nome:   ', nomeFinal);
    console.log('  Perfil: ', perfilFinal);
    console.log('  Claims:  role=' + perfilFinal + ', adminGlobal=' + (perfilFinal === 'administrador'));
    console.log('════════════════════════════════════════════');
    console.log('');

    process.exit(0);

  } catch (erro) {
    console.error('');

    if (erro.code === 'auth/email-already-exists') {
      console.error('✖  Este e-mail já está cadastrado.');
      console.error('   Use outro e-mail ou redefina a senha pelo Console Firebase.');
    } else if (erro.code === 'auth/invalid-email') {
      console.error('✖  E-mail inválido:', email);
    } else if (erro.code === 'auth/weak-password') {
      console.error('✖  Senha muito fraca. Use pelo menos 6 caracteres.');
    } else {
      console.error('✖  Erro ao criar usuário:', erro.message);
    }

    console.error('');
    process.exit(1);
  }
}

criarUsuario();

// ════════════════════════════════════════════════════════════════════════
//  MIGRAÇÃO EM LOTE DE CUSTOM CLAIMS (v24.0)
//  Ativa as Storage Rules da Fase 2 para todos os usuários existentes.
//
//  USO:
//    node criar-usuario.js --migrar
//    node criar-usuario.js --migrar --dry-run   (apenas lista, não aplica)
//
//  O que faz:
//    1. Lista todos os usuários no Firebase Authentication
//    2. Para cada usuário sem o claim 'role':
//       - Busca o perfil no Firestore (/usuarios/{uid})
//       - Aplica setCustomUserClaims com { role, adminGlobal }
//    3. Gera relatório de migração
//
//  IMPORTANTE: o token do usuário é renovado automaticamente em até 1 hora.
//  Após a migração, as Storage Rules Fase 2 passam a valer automaticamente.
// ════════════════════════════════════════════════════════════════════════

async function migrarCustomClaims(dryRun = false) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  MIGRAÇÃO DE CUSTOM CLAIMS — Fiscal na Obra v15.1   ║');
  console.log(`║  Modo: ${dryRun ? 'DRY-RUN (sem alterações)           ' : 'PRODUÇÃO (vai aplicar claims)      '}║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  const db = admin.firestore();
  let nextPageToken;
  let total = 0, migrados = 0, jaTemClaim = 0, semPerfil = 0, erros = 0;

  do {
    const listResult = await admin.auth().listUsers(1000, nextPageToken);
    for (const user of listResult.users) {
      total++;
      const claims = user.customClaims || {};

      // Já tem claim 'role' → pular
      if (claims.role) { jaTemClaim++; continue; }

      // Busca perfil no Firestore
      let perfil = 'fiscal'; // padrão conservador
      let adminGlobal = false;
      try {
        const doc = await db.collection('usuarios').doc(user.uid).get();
        if (doc.exists) {
          const data = doc.data();
          perfil     = data.perfil || 'fiscal';
          adminGlobal = perfil === 'administrador';
        } else {
          semPerfil++;
          console.log(`  ⚠️  Sem perfil Firestore: ${user.email || user.uid} → usando 'fiscal'`);
        }
      } catch (e) {
        erros++;
        console.log(`  ✖  Erro ao ler perfil: ${user.email || user.uid}`, e.message);
        continue;
      }

      const novosClaims = { role: perfil, adminGlobal };
      console.log(`  ${dryRun ? '[DRY]' : '→'} ${user.email || user.uid} — role: ${perfil}, adminGlobal: ${adminGlobal}`);

      if (!dryRun) {
        try {
          await admin.auth().setCustomUserClaims(user.uid, novosClaims);
          migrados++;
        } catch (e) {
          erros++;
          console.log(`  ✖  Falha ao setar claims: ${user.email}`, e.message);
        }
      } else {
        migrados++;
      }
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);

  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Total de usuários:        ${total}`);
  console.log(`  Já tinham claim 'role':   ${jaTemClaim}`);
  console.log(`  ${dryRun ? 'Seriam migrados:' : 'Migrados com sucesso:'}       ${migrados}`);
  console.log(`  Sem perfil Firestore:     ${semPerfil} (usaram padrão 'fiscal')`);
  console.log(`  Erros:                    ${erros}`);
  console.log('══════════════════════════════════════════════════════');
  if (!dryRun && migrados > 0) {
    console.log('');
    console.log('✅ Migração concluída! As Storage Rules Fase 2 estão ativas.');
    console.log('   Os tokens dos usuários se renovam automaticamente em até 1 hora.');
  }
  if (dryRun) {
    console.log('');
    console.log('ℹ️  DRY-RUN: nenhuma alteração foi aplicada.');
    console.log('   Para aplicar: node criar-usuario.js --migrar');
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--migrar')) {
  const dryRun = args.includes('--dry-run');
  migrarCustomClaims(dryRun).then(() => process.exit(0)).catch(e => {
    console.error('Erro fatal na migração:', e);
    process.exit(1);
  });
}
