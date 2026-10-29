/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — firebase/integridade-dados.js                     ║
 * ║  Memória de leituras falhas e barreira contra sobrescrita    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import { describe, it, expect, beforeEach } from 'vitest';

import IntegridadeDados, {
  EscritaBloqueadaError,
  rotuloDominio,
} from '../firebase/integridade-dados.js';

const erroPermissao = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };

describe('IntegridadeDados — registro de falhas', () => {
  beforeEach(() => IntegridadeDados.limpar());

  it('começa sem nenhuma falha', () => {
    expect(IntegridadeDados.degradado('bms', 'obra1')).toBe(false);
    expect(IntegridadeDados.temFalha('obra1')).toBe(false);
  });

  it('marca o domínio quando a leitura falha', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);

    expect(IntegridadeDados.degradado('bms', 'obra1')).toBe(true);
    expect(IntegridadeDados.temFalha('obra1')).toBe(true);
  });

  it('não contamina outras obras nem outros domínios', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);

    expect(IntegridadeDados.degradado('bms',   'obra2')).toBe(false);
    expect(IntegridadeDados.degradado('itens', 'obra1')).toBe(false);
  });

  it('uma leitura bem-sucedida libera o domínio', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);
    IntegridadeDados.leituraOk('bms', 'obra1');

    expect(IntegridadeDados.degradado('bms', 'obra1')).toBe(false);
  });

  it('escopo separa unidades independentes do mesmo domínio', () => {
    // Falha ao ler as medições do BM 7 não pode bloquear o BM 1.
    IntegridadeDados.falhaLeitura('medicoes', 'obra1', erroPermissao, 'bm7');

    expect(IntegridadeDados.degradado('medicoes', 'obra1', 'bm7')).toBe(true);
    expect(IntegridadeDados.degradado('medicoes', 'obra1', 'bm1')).toBe(false);
  });

  it('guarda o código do erro para a tela explicar o motivo', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);

    const [falha] = IntegridadeDados.dominiosDegradados('obra1');
    expect(falha.codigo).toBe('permission-denied');
    expect(falha.dominio).toBe('bms');
  });

  it('limpar(obraId) só apaga as falhas daquela obra', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);
    IntegridadeDados.falhaLeitura('bms', 'obra2', erroPermissao);

    IntegridadeDados.limpar('obra1');

    expect(IntegridadeDados.degradado('bms', 'obra1')).toBe(false);
    expect(IntegridadeDados.degradado('bms', 'obra2')).toBe(true);
  });
});

describe('IntegridadeDados — barreira de escrita', () => {
  beforeEach(() => IntegridadeDados.limpar());

  it('deixa passar quando a leitura está íntegra', () => {
    expect(() => IntegridadeDados.exigirLeituraIntegra('bms', 'obra1')).not.toThrow();
  });

  it('bloqueia quando a leitura do mesmo dado falhou', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);

    expect(() => IntegridadeDados.exigirLeituraIntegra('bms', 'obra1'))
      .toThrow(EscritaBloqueadaError);
  });

  it('a mensagem do bloqueio diz o que fazer, em português', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);

    try {
      IntegridadeDados.exigirLeituraIntegra('bms', 'obra1');
      throw new Error('deveria ter bloqueado');
    } catch (err) {
      expect(err.codigo).toBe('escrita-bloqueada');
      expect(err.message).toContain('Boletins de Medição');
      expect(err.message).toContain('Recarregue');
    }
  });

  it('volta a liberar depois de uma leitura bem-sucedida', () => {
    IntegridadeDados.falhaLeitura('bms', 'obra1', erroPermissao);
    IntegridadeDados.leituraOk('bms', 'obra1');

    expect(() => IntegridadeDados.exigirLeituraIntegra('bms', 'obra1')).not.toThrow();
  });
});

describe('rotuloDominio', () => {
  it('traduz domínios conhecidos', () => {
    expect(rotuloDominio('bms')).toBe('Boletins de Medição');
    expect(rotuloDominio('itens')).toBe('itens do contrato');
  });

  it('devolve a própria chave quando não conhece', () => {
    expect(rotuloDominio('coisa-nova')).toBe('coisa-nova');
  });
});
