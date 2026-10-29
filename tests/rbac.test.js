/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — utils/rbac.js                                    ║
 * ║  Hierarquia de papéis e permissões                         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do state para isolar o RBAC
const _state = {};
vi.mock('../core/state.js', () => ({
  default: {
    get: (k) => _state[k] ?? null,
    set: (k, v) => { _state[k] = v; },
  }
}));

import { RBAC } from '../utils/rbac.js';

// O papel vem do claim, que o FirebaseService deixa em usuarioLogado.perfil.
// 'cfg' e 'usuariosObra' são preenchidos de propósito com valores que
// contradizem o papel: servem para provar que NÃO influenciam mais nada.
function setUser(perfil, uid = 'u1') {
  _state['usuarioLogado'] = { uid, perfil };
  _state['cfg']           = { uid: 'owner' };                      // não é dono
  _state['usuariosObra']  = [{ uid, perfil: 'administrador' }];     // ignorado
}

describe('RBAC — hierarquia de papéis', () => {
  beforeEach(() => { Object.keys(_state).forEach(k => delete _state[k]); });

  it('administrador tem todos os poderes', () => {
    setUser('administrador');
    expect(RBAC.podeEscrever()).toBe(true);
    expect(RBAC.podeGerirAditivos()).toBe(true);
    expect(RBAC.podeGerirDocumentosJuridicos()).toBe(true);
  });

  it('gestor pode documentos jurídicos mas não é admin', () => {
    setUser('gestor');
    expect(RBAC.podeGerirDocumentosJuridicos()).toBe(true);
    expect(RBAC.eAdmin()).toBe(false);
  });

  it('fiscal pode aditivos mas não documentos jurídicos', () => {
    setUser('fiscal');
    expect(RBAC.podeGerirAditivos()).toBe(true);
    expect(RBAC.podeGerirDocumentosJuridicos()).toBe(false);
  });

  it('engenheiro pode aditivos', () => {
    setUser('engenheiro');
    expect(RBAC.podeGerirAditivos()).toBe(true);
  });

  it('tecnico pode escrever mas não aditivos', () => {
    setUser('tecnico');
    expect(RBAC.podeEscrever()).toBe(true);
    expect(RBAC.podeGerirAditivos()).toBe(false);
  });

  it('visualizador não pode escrever nada', () => {
    setUser('visualizador');
    expect(RBAC.podeEscrever()).toBe(false);
    expect(RBAC.podeGerirAditivos()).toBe(false);
    expect(RBAC.podeGerirDocumentosJuridicos()).toBe(false);
    expect(RBAC.eSomenteVisualizador()).toBe(true);
  });

  // ── O que mudou em 27/10/2026: papel é da conta, não da obra ──────────
  //
  // O atalho "dono da obra vale gestor" saiu. As rules decidem só por papel
  // e nunca leem obras/{id}.uid, então mantê-lo aqui habilitaria botão que
  // o servidor recusa — a divergência que o arquivo existe para evitar.
  it('dono da obra NÃO ganha poder de gestor', () => {
    _state['usuarioLogado'] = { uid: 'owner', perfil: 'tecnico' };
    _state['cfg']           = { uid: 'owner' }; // é dono, e não importa
    _state['usuariosObra']  = [];
    expect(RBAC.podeGerirDocumentosJuridicos()).toBe(false);
    expect(RBAC.podeAdministrarObra()).toBe(false);
  });

  it('o papel da lista de usuários da obra é ignorado', () => {
    _state['usuarioLogado'] = { uid: 'u1', perfil: 'visualizador' };
    _state['usuariosObra']  = [{ uid: 'u1', perfil: 'administrador' }];
    expect(RBAC.papel()).toBe('visualizador');
    expect(RBAC.podeEscrever()).toBe(false);
  });

  // Espelha papelPadrao() em firestore.rules: conta criada direto no Console,
  // antes dos custom claims, não pode ficar trancada fora do sistema.
  it('conta sem claim cai em fiscal', () => {
    _state['usuarioLogado'] = { uid: 'u-velho' };  // sem 'perfil'
    expect(RBAC.papel()).toBe('fiscal');
    expect(RBAC.podeGerirAditivos()).toBe(true);
    expect(RBAC.podeGerirDocumentosJuridicos()).toBe(false);
  });

  it('papel desconhecido não vira privilégio', () => {
    setUser('superintendente-regional');
    expect(RBAC.podeEscrever()).toBe(false);
    expect(RBAC.eSomenteVisualizador()).toBe(true);
  });

  it('só administrador administra a obra', () => {
    setUser('gestor');
    expect(RBAC.podeAdministrarObra()).toBe(false);
    setUser('administrador');
    expect(RBAC.podeAdministrarObra()).toBe(true);
  });

  it('temPapelMinimo valida hierarquia corretamente', () => {
    setUser('fiscal');
    expect(RBAC.temPapelMinimo('tecnico')).toBe(true);
    expect(RBAC.temPapelMinimo('fiscal')).toBe(true);
    expect(RBAC.temPapelMinimo('gestor')).toBe(false);
  });

  it('resumo retorna objeto completo', () => {
    setUser('gestor');
    const r = RBAC.resumo();
    expect(r).toHaveProperty('papel');
    expect(r).toHaveProperty('nivel');
    expect(r).toHaveProperty('podeGerirAditivos');
    expect(r.papel).toBe('gestor');
  });
});
