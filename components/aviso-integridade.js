/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA — components/aviso-integridade.js           ║
 * ║  A tela avisa quando NÃO conseguiu ler ou gravar             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * O incidente do BM sumido não foi causado por perda de dado: foi causado por
 * uma tela que não tinha como dizer "eu não consegui ler isso". O usuário só
 * descobriu no dia seguinte, e descobriu como "sumiu".
 *
 * Este componente fecha esse buraco com dois avisos:
 *
 *   FAIXA FIXA (leitura falhou) — fica na tela enquanto o dado não carregar.
 *   Diz o que não veio, que o que está na tela pode estar incompleto e que a
 *   gravação daquele dado está bloqueada. Não é um toast de 4 segundos: o
 *   estado é persistente, o aviso também precisa ser.
 *
 *   TOAST DE ERRO (gravação falhou) — substitui o "✅ salvo" que aparecia
 *   mesmo quando o Firestore recusava a escrita.
 *
 * Sem `onclick=` inline: a CSP em produção usa script-src 'self' e mata
 * handlers inline silenciosamente (foi o que matou a janela de impressão e o
 * registro de clima do Quadro de Chuvas).
 */

import EventBus from '../core/EventBus.js';
import IntegridadeDados, { rotuloDominio } from '../firebase/integridade-dados.js';

const ID_FAIXA = 'fo-aviso-integridade';

export const AvisoIntegridade = {
  _ligado: false,

  init() {
    if (this._ligado) return;
    this._ligado = true;

    EventBus.on('dados:leitura-falhou',     () => this._render(), 'aviso-integridade');
    EventBus.on('dados:leitura-recuperada', () => this._render(), 'aviso-integridade');

    EventBus.on('dados:escrita-falhou', ({ dominio, codigo, mensagem }) => {
      EventBus.emit('ui:toast', { msg: this._mensagemEscrita(dominio, codigo, mensagem), tipo: 'error' });
    }, 'aviso-integridade');
  },

  /** Texto do toast de gravação recusada — direto sobre o que NÃO aconteceu. */
  _mensagemEscrita(dominio, codigo, mensagem) {
    const alvo = rotuloDominio(dominio);

    if (codigo === 'sessao-expirada') {
      return `🔒 NÃO foi salvo: sua sessão expirou. O que está na tela veio do cache do ` +
             `navegador. Entre novamente e refaça — nada foi para o servidor.`;
    }
    if (codigo === 'permission-denied') {
      return `❌ NÃO foi salvo: seu usuário não tem permissão para gravar ${alvo} nesta obra. ` +
             `Fale com o administrador — nada do que você fez foi para o servidor.`;
    }
    if (codigo === 'escrita-bloqueada') {
      return `⛔ NÃO foi salvo: ${alvo} não pôde ser lido nesta sessão, então gravar agora ` +
             `apagaria o que está no servidor. Recarregue a página (F5) e refaça.`;
    }
    if (codigo === 'firebase-indisponivel' || codigo === 'unavailable') {
      return `❌ NÃO foi salvo: sem conexão com o banco de dados. Verifique a internet e refaça.`;
    }
    return `❌ NÃO foi salvo (${alvo}): ${mensagem || 'erro desconhecido'}.`;
  },

  /** Desenha, atualiza ou remove a faixa conforme o estado atual. */
  _render() {
    const falhas = IntegridadeDados.dominiosDegradados();
    const faixa  = document.getElementById(ID_FAIXA);

    if (!falhas.length) {
      faixa?.remove();
      return;
    }

    const nomes = [...new Set(falhas.map(f => rotuloDominio(f.dominio)))];
    const semPermissao = falhas.some(f => f.codigo === 'permission-denied');

    const texto = semPermissao
      ? 'Seu usuário não tem permissão de leitura para estes dados nesta obra.'
      : 'Não foi possível carregar estes dados do servidor.';

    const el = faixa || this._criarFaixa();
    el.querySelector('[data-fo="lista"]').textContent  = nomes.join(', ');
    el.querySelector('[data-fo="motivo"]').textContent = texto;
  },

  _criarFaixa() {
    const faixa = document.createElement('div');
    faixa.id = ID_FAIXA;
    faixa.setAttribute('role', 'alert');
    faixa.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#b91c1c', 'color:#fff', 'font-size:13px',
      'padding:10px 16px', 'display:flex', 'align-items:center',
      'gap:10px', 'box-shadow:0 2px 8px rgba(0,0,0,.35)',
    ].join(';');

    faixa.innerHTML = `
      <span style="font-size:18px">⚠️</span>
      <span style="flex:1">
        <strong>Esta tela está incompleta — não edite antes de recarregar.</strong><br>
        <span data-fo="motivo" style="opacity:.95"></span>
        <strong data-fo="lista"></strong>
        <br>
        <span style="opacity:.9;font-size:12px">
          O que aparece na tela pode não ser o que está salvo. Para não gravar por
          cima do que existe no servidor, a gravação desses dados está bloqueada
          até uma leitura bem-sucedida.
        </span>
      </span>
      <button type="button" data-fo="recarregar"
        style="background:rgba(255,255,255,.25);border:none;color:#fff;
               padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px">
        Recarregar
      </button>`;

    // addEventListener, nunca onclick inline — ver comentário do topo.
    faixa.querySelector('[data-fo="recarregar"]')
         .addEventListener('click', () => location.reload());

    document.body.prepend(faixa);
    return faixa;
  },
};

export default AvisoIntegridade;
