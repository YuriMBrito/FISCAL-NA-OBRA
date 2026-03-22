/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — core/EventBus.js                     ║
 * ║  Bus de eventos singleton para comunicação entre módulos    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CATÁLOGO DE EVENTOS:
 * ─────────────────────────────────────────────────────────────
 *  obra:selecionada        { obraId, cfg, bms, itens }
 *  obra:criada             { obraId, nome }
 *  obra:excluida           { obraId }
 *  obra:concluida          { obraId }
 *  obra:reativada          { obraId }
 *
 *  boletim:atualizado      { bms }
 *  boletim:criado          { bm }
 *  boletim:excluido        { bmNum }
 *
 *  medicao:salva           { bmNum, medicoes }
 *  itens:atualizados       { itens }
 *  config:salva            { cfg }
 *
 *  aditivo:salvo           { aditivo }
 *  aditivo:excluido        { aditivoId }
 *
 *  chuva:salva             { ano, dados }
 *  ocorrencia:salva        { ocorrencia }
 *  ocorrencia:excluida     { id }
 *  historico:registrado    { entry }
 *  diario:salvo            { entrada }
 *  documento:adicionado    { doc }
 *  documento:excluido      { docId }
 *  notificacao:adicionada  { notif }
 *
 *  auth:login              { user }
 *  auth:logout             {}
 *  firebase:conectado      { projectId }
 *  firebase:desconectado   {}
 *
 *  ui:pagina               { pageId }
 *  ui:toast                { msg, tipo }
 *  undo:snapshot           { desc }
 *  undo:desfazer           {}
 *  undo:refazer            {}
 * ─────────────────────────────────────────────────────────────
 */

class EventBusClass {
  constructor() {
    this._handlers = {};
    this._history  = [];
    this._maxHist  = 150;
    this._idSeq    = 0;
    this._maxListenersPerEvent = 50;
  }

  /**
   * Registra handler para um evento.
   * @param {string}   event
   * @param {Function} fn
   * @param {string}   [ctx] — identificador do módulo (debug)
   * @returns {Function} unsubscribe
   */
  on(event, fn, ctx = 'anon') {
    if (!this._handlers[event]) this._handlers[event] = [];
    // Guard: warn if listener count is growing unusually large (possible leak)
    if (this._handlers[event].length >= this._maxListenersPerEvent) {
      console.warn(`[EventBus] ⚠️ "${event}" tem ${this._handlers[event].length} listeners (possível leak). Contextos: ${this._handlers[event].map(h => h.ctx).join(', ')}`);
    }
    const id = ++this._idSeq;
    this._handlers[event].push({ id, fn, ctx, once: false });
    return () => this.off(event, id);
  }

  /** Registra handler que dispara apenas uma vez. */
  once(event, fn, ctx = 'anon') {
    if (!this._handlers[event]) this._handlers[event] = [];
    const id = ++this._idSeq;
    this._handlers[event].push({ id, fn, ctx, once: true });
    return () => this.off(event, id);
  }

  /** Remove handler por id ou função. */
  off(event, idOrFn) {
    if (!this._handlers[event]) return;
    this._handlers[event] = this._handlers[event].filter(h =>
      typeof idOrFn === 'number' ? h.id !== idOrFn : h.fn !== idOrFn
    );
  }

  /**
   * Emite um evento para todos os handlers registrados.
   * Erros em um handler NÃO propagam para os demais.
   * @param {string} event
   * @param {*}      payload
   */
  emit(event, payload = {}) {
    this._history.unshift({ event, payload, ts: Date.now() });
    if (this._history.length > this._maxHist) this._history.pop();

    const subs = this._handlers[event];
    if (!subs || !subs.length) return;

    const toRemove = [];
    [...subs].forEach(h => {
      try {
        h.fn(payload);
      } catch (err) {
        console.error(`[EventBus] Erro em handler "${event}" (ctx: ${h.ctx}):`, err);
      }
      if (h.once) toRemove.push(h.id);
    });

    toRemove.forEach(id => this.off(event, id));
  }

  /** Emite de forma assíncrona (não bloqueia call stack). */
  emitAsync(event, payload = {}) {
    Promise.resolve().then(() => this.emit(event, payload));
  }

  /** Remove todos os handlers de um evento (ou todos). */
  clear(event) {
    if (event) delete this._handlers[event];
    else this._handlers = {};
  }

  /**
   * Remove todos os handlers registrados por um contexto (módulo).
   * Deve ser chamado no destroy() de cada módulo para evitar leaks.
   * @param {string} ctx — identificador do módulo (ex: 'boletim', 'memoria')
   */
  offByContext(ctx) {
    if (!ctx) return;
    let removed = 0;
    for (const event of Object.keys(this._handlers)) {
      const before = this._handlers[event].length;
      this._handlers[event] = this._handlers[event].filter(h => h.ctx !== ctx);
      removed += before - this._handlers[event].length;
      if (this._handlers[event].length === 0) delete this._handlers[event];
    }
    if (removed > 0) {
      console.log(`[EventBus] offByContext("${ctx}"): ${removed} handler(s) removido(s).`);
    }
  }

  /** Lista eventos ativos (debug). */
  debug() {
    return Object.keys(this._handlers).map(e => ({
      event: e,
      subs:  this._handlers[e].length,
      ctxs:  this._handlers[e].map(h => h.ctx),
    }));
  }

  getHistory() { return [...this._history]; }

  /** Returns total listener count across all events (diagnostics). */
  getListenerCount() {
    let total = 0;
    for (const event of Object.keys(this._handlers)) {
      total += this._handlers[event].length;
    }
    return total;
  }

  /** Returns listener count for a specific event. */
  getEventListenerCount(event) {
    return this._handlers[event]?.length || 0;
  }

  /** Returns list of all registered events with their listener counts. */
  getEventMap() {
    const map = {};
    for (const event of Object.keys(this._handlers)) {
      map[event] = this._handlers[event].length;
    }
    return map;
  }
}

export const EventBus = new EventBusClass();
export default EventBus;
