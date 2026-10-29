/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — definir-perfil.mjs                        ║
 * ║  Define o perfil de uma conta QUE JÁ EXISTE                 ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * POR QUE ESTE SCRIPT EXISTE
 *
 * O `criar-usuario.js` só cria contas novas com e-mail e senha. Quem entra
 * pelo login do Google já tem conta no Authentication, mas pode não ter o
 * documento /usuarios/{uid} no Firestore — e é esse documento que a regra
 * souAdmin() consulta. Sem ele, a conta não é admin de nada.
 *
 * E não dá para criar esse documento pelo app: desde a correção de escalação
 * de privilégio, as rules têm `allow create: if false` em /usuarios/{uid}
 * (qualquer conta do mundo podia se autodeclarar administrador). A criação
 * passa obrigatoriamente pelo Admin SDK, que não é avaliado pelas rules.
 *
 * PRÉ-REQUISITOS
 *   1. serviceAccountKey.json nesta pasta
 *      (Console Firebase → ⚙️ Configurações → Contas de serviço →
 *       Gerar nova chave privada). O arquivo está no .gitignore.
 *   2. npm install firebase-admin
 *
 * USO
 *   node definir-perfil.mjs meu.email@dominio.com administrador
 *   node definir-perfil.mjs fulano@dominio.com fiscal
 *   node definir-perfil.mjs meu.email@dominio.com            (só consulta)
 *
 * PERFIS: administrador | gestor | fiscal | engenheiro | tecnico | visualizador
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PERFIS = ['administrador', 'gestor', 'fiscal', 'engenheiro', 'tecnico', 'visualizador'];

const [email, perfil] = process.argv.slice(2);

if (!email) {
  console.error('\n✖  Informe o e-mail.\n');
  console.error('   node definir-perfil.mjs email@dominio.com administrador');
  console.error('   node definir-perfil.mjs email@dominio.com              (só consulta)\n');
  process.exit(1);
}

if (perfil && !PERFIS.includes(perfil)) {
  console.error(`\n✖  Perfil inválido: "${perfil}"`);
  console.error(`   Válidos: ${PERFIS.join(', ')}\n`);
  process.exit(1);
}

let credencial;
try {
  credencial = JSON.parse(readFileSync(new URL('./serviceAccountKey.json', import.meta.url)));
} catch {
  console.error('\n✖  serviceAccountKey.json não encontrado nesta pasta.\n');
  console.error('   Console Firebase → ⚙️ Configurações do projeto');
  console.error('   → aba "Contas de serviço" → "Gerar nova chave privada"');
  console.error('   → salve como serviceAccountKey.json aqui.\n');
  process.exit(1);
}

initializeApp({ credential: cert(credencial) });

const auth = getAuth();
const db   = getFirestore();

try {
  const usuario = await auth.getUserByEmail(email);
  const ref     = db.collection('usuarios').doc(usuario.uid);
  const atual   = await ref.get();

  console.log('\n════════════════════════════════════════════');
  console.log('  ANTES');
  console.log('────────────────────────────────────────────');
  console.log('  UID:          ', usuario.uid);
  console.log('  E-mail:       ', usuario.email);
  console.log('  Provedores:   ', usuario.providerData.map(p => p.providerId).join(', ') || '—');
  console.log('  /usuarios/{uid}:', atual.exists ? JSON.stringify(atual.data()) : '❌ NÃO EXISTE');
  console.log('  Custom claims:', JSON.stringify(usuario.customClaims || {}));
  console.log('════════════════════════════════════════════\n');

  if (!perfil) {
    console.log('ℹ️  Nenhum perfil informado — nada foi alterado.');
    console.log(`   Para definir: node definir-perfil.mjs ${email} administrador\n`);
    process.exit(0);
  }

  // Claims no token: usadas pelas Storage Rules.
  await auth.setCustomUserClaims(usuario.uid, {
    role:        perfil,
    adminGlobal: perfil === 'administrador',
  });

  // Documento no Firestore: é o que souAdmin() consulta nas Firestore Rules.
  // merge para não apagar obraAtivaId e outras preferências já gravadas.
  await ref.set({
    uid:         usuario.uid,
    email:       usuario.email,
    nome:        usuario.displayName || usuario.email,
    perfil,
    atualizadoEm: new Date().toISOString(),
    ...(atual.exists ? {} : { criadoEm: new Date().toISOString() }),
  }, { merge: true });

  console.log('✔  Custom claims definidos (role=' + perfil + ')');
  console.log('✔  /usuarios/' + usuario.uid + ' gravado com perfil=' + perfil);
  console.log('\n⚠️  O token do navegador ainda tem os claims antigos.');
  console.log('   Faça logout e login de novo no app para valer.\n');

  process.exit(0);
} catch (err) {
  if (err.code === 'auth/user-not-found') {
    console.error(`\n✖  Nenhuma conta no Authentication com o e-mail "${email}".`);
    console.error('   Confira o e-mail exato em Console Firebase → Authentication → Users.\n');
  } else {
    console.error('\n✖  Falhou:', err.message, '\n');
  }
  process.exit(1);
}
