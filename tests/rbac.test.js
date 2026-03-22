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

function setUser(perfil, uid = 'u1') {
  _state['usuarioLogado'] = { uid, perfil };
  _state['cfg']           = { uid: 'owner' }; // não é dono
  _state['usuariosObra']  = [{ uid, perfil }];
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

  it('dono da obra tem papel de gestor', () => {
    _state['usuarioLogado'] = { uid: 'owner', perfil: 'tecnico' };
    _state['cfg']           = { uid: 'owner' }; // É dono
    _state['usuariosObra']  = [];
    expect(RBAC.podeGerirDocumentosJuridicos()).toBe(true);
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
