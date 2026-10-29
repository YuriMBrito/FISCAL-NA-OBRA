/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — firebase/integridade-dados.js             ║
 * ║  Memória de quais leituras falharam, por obra e domínio      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * POR QUE ESTE MÓDULO EXISTE
 *
 * Em 11/08/2026 um BM criado na obra da UBS "sumiu" no dia seguinte. Não foi
 * perda de dado: uma mudança nas Firestore Rules recusou a leitura, getBMs()
 * engoliu o erro e devolveu um BM 01 fabricado. A tela ficou indistinguível
 * de uma obra que só tem o BM 01. O mesmo tinha acontecido dias antes com o
 * Quadro de Chuvas (getChuva devolvia {}).
 *
 * Uma leitura recusada tem duas consequências, e as duas são graves:
 *
 *   1. INVISIBILIDADE — a tela mostra o valor neutro ([] , {} ou pior, um
 *      registro inventado) como se fosse o estado real do Firestore.
 *   2. DESTRUIÇÃO — o state fica com esse valor neutro e a próxima gravação
 *      bem-sucedida o persiste POR CIMA do dado verdadeiro. As escritas deste
 *      sistema são .set() de documento inteiro (setBMs, setItens,
 *      salvarOcorrencias...), então sobrescrevem a coleção toda. Aqui a perda
 *      deixa de ser aparente e passa a ser real.
 *
 * Este módulo é a memória que faltava: quem leu, se conseguiu, e o que fazer
 * enquanto não conseguir. É JS puro (sem Firebase, sem DOM) para poder ser
 * testado sozinho — ver tests/integridade-dados.test.js.
 *
 * CONTRATO
 *   - Leitura OK      → limpa a marca do domínio.
 *   - Leitura FALHOU  → marca o domínio e avisa a UI. O valor neutro pode ser
 *                       devolvido para a tela não quebrar, mas a partir daí
 *                       ele é sabidamente não confiável.
 *   - Escrita total   → recusada enquanto o domínio estiver marcado.
 *   - Escrita pontual → permitida (não sobrescreve o que não foi lido).
 */

import EventBus from '../core/EventBus.js';

/** Rótulos legíveis por domínio — usados na faixa de aviso ao usuário. */
const ROTULOS = {
  bms:          'Boletins de Medição',
  medicoes:     'medições dos BMs',
  itens:        'itens do contrato',
  cfg:          'configuração da obra',
  aditivos:     'aditivos',
  ocorrencias:  'ocorrências',
  chuva:        'Quadro de Chuvas',
  diario:       'Diário de Obra',
  documentos:   'documentos',
  notificacoes: 'notificações',
  historico:    'histórico',
  usuarios:     'usuários da obra',
  versoes:      'versões contratuais',
  obras:        'lista de obras',
};

export function rotuloDominio(dominio) {
  return ROTULOS[dominio] || dominio;
}

/**
 * Erro de escrita recusada pela barreira de integridade.
 * Não é falha de rede: é uma recusa deliberada para não destruir dado.
 */
export class EscritaBloqueadaError extends Error {
  constructor(dominio, obraId) {
    super(
      `Gravação de "${rotuloDominio(dominio)}" bloqueada: a leitura deste dado ` +
      `falhou nesta sessão, então o que está na tela pode não ser o que está ` +
      `salvo. Recarregue a página antes de gravar.`
    );
    this.name    = 'EscritaBloqueadaError';
    this.codigo  = 'escrita-bloqueada';
    this.dominio = dominio;
    this.obraId  = obraId;
  }
}

class IntegridadeDadosClass {
  constructor() {
    /** Map<"obraId::dominio::escopo", { dominio, obraId, escopo, codigo, mensagem, em }> */
    this._falhas = new Map();
  }

  /**
   * `escopo` separa unidades independentes dentro do mesmo domínio — medições
   * são por BM ('bm3'), chuva é por ano ('2026'). Sem ele, uma falha no BM 7
   * bloquearia a gravação do BM 1, que nada tem a ver.
   */
  _chave(obraId, dominio, escopo = '') {
    return `${obraId || '_global'}::${dominio}${escopo ? '::' + escopo : ''}`;
  }

  /**
   * Registra que uma leitura falhou. Idempotente: falhas repetidas do mesmo
   * domínio não repetem o evento para a UI (evita enxurrada de avisos quando
   * a obra carrega 10 domínios e todos são recusados pela mesma regra).
   */
  falhaLeitura(dominio, obraId, err, escopo = '') {
    const chave = this._chave(obraId, dominio, escopo);
    const nova  = !this._falhas.has(chave);

    this._falhas.set(chave, {
      dominio,
      obraId,
      escopo,
      codigo:   err?.code || err?.codigo || 'desconhecido',
      mensagem: err?.message || String(err || 'falha desconhecida'),
      em:       new Date().toISOString(),
    });

    console.error(
      `[Integridade] Leitura de "${dominio}" da obra ${obraId} FALHOU ` +
      `(${err?.code || 'sem código'}). Escritas que sobrescrevem este dado ` +
      `estão bloqueadas até uma leitura bem-sucedida.`,
      err
    );

    if (nova) {
      EventBus.emit('dados:leitura-falhou', {
        obraId, dominio, escopo, codigo: err?.code || 'desconhecido',
      });
    }
    return nova;
  }

  /** Registra leitura bem-sucedida — libera as escritas do domínio. */
  leituraOk(dominio, obraId, escopo = '') {
    const chave = this._chave(obraId, dominio, escopo);
    if (!this._falhas.delete(chave)) return false;

    console.info(`[Integridade] Leitura de "${dominio}" da obra ${obraId} recuperada.`);
    EventBus.emit('dados:leitura-recuperada', { obraId, dominio, escopo });
    return true;
  }

  /** true se a última leitura conhecida deste domínio falhou. */
  degradado(dominio, obraId, escopo = '') {
    return this._falhas.has(this._chave(obraId, dominio, escopo));
  }

  /** Domínios degradados de uma obra (ou de todas, se obraId for omitido). */
  dominiosDegradados(obraId) {
    const saida = [];
    for (const falha of this._falhas.values()) {
      if (obraId === undefined || falha.obraId === obraId) saida.push(falha);
    }
    return saida;
  }

  /** true se qualquer domínio da obra está degradado. */
  temFalha(obraId) {
    return this.dominiosDegradados(obraId).length > 0;
  }

  /**
   * Porta de entrada das escritas. `total` = a gravação substitui o documento
   * inteiro do domínio (o caso perigoso). Lança em vez de retornar false para
   * que nenhum caller consiga ignorar a recusa por descuido.
   */
  exigirLeituraIntegra(dominio, obraId, escopo = '') {
    if (this.degradado(dominio, obraId, escopo)) {
      throw new EscritaBloqueadaError(dominio, obraId);
    }
  }

  /** Zera o registro — usado ao trocar de obra e ao recarregar dados. */
  limpar(obraId) {
    if (obraId === undefined) {
      this._falhas.clear();
      return;
    }
    for (const [chave, falha] of this._falhas.entries()) {
      if (falha.obraId === obraId) this._falhas.delete(chave);
    }
  }
}

export const IntegridadeDados = new IntegridadeDadosClass();
export default IntegridadeDados;
