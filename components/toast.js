/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15.1 — components/toast.js                  ║
 * ║  Componente de notificações toast                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export const ToastComponent = {
  _container: null,
  _queue: [],

  init() {
    if (this._container) return;
    this._container = document.createElement('div');
    this._container.id = 'toast-container';
    this._container.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:9999;
      display:flex;flex-direction:column-reverse;gap:8px;
      pointer-events:none;max-width:380px;
    `;
    document.body.appendChild(this._container);
  },

  show(msg, tipo = 'ok', duration = 3500) {
    if (!this._container) this.init();

    const el = document.createElement('div');
    const icons = { ok: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };
    const colors = {
      ok:    '#059669',
      warn:  '#d97706',
      error: '#dc2626',
      info:  '#2563eb',
    };
    const t = tipo in icons ? tipo : 'ok';

    const labels = { ok: 'Sucesso', warn: 'Atenção', error: 'Erro', info: 'Info' };
    el.style.cssText = `
      background:#0A0A0A;color:#E5E5E5;padding:12px 16px 12px 14px;
      border-radius:12px;font-size:13px;line-height:1.45;
      font-family:'Inter',-apple-system,sans-serif;
      pointer-events:all;cursor:pointer;
      box-shadow:0 8px 24px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.3);
      border:1px solid #1E1E1E;border-left:3px solid ${colors[t]};
      animation:toastIn .22s cubic-bezier(0,0,.2,1);
      max-width:380px;word-break:break-word;
      display:flex;align-items:flex-start;gap:11px;
    `;
    el.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:${colors[t]};flex-shrink:0;margin-top:4px;box-shadow:0 0 6px ${colors[t]}60"></span>
      <div style="flex:1;min-width:0">
        <div style="font-size:10.5px;font-weight:700;color:${colors[t]};letter-spacing:.4px;text-transform:uppercase;margin-bottom:2px">${labels[t]}</div>
        <div style="font-size:12.5px;color:#D4D4D4;line-height:1.45">${msg}</div>
      </div>
      <span style="font-size:15px;color:#404040;flex-shrink:0;margin-top:-1px;cursor:pointer;transition:color .15s" onmouseover="this.style.color='#A3A3A3'" onmouseout="this.style.color='#404040'">✕</span>
    `;
    el.addEventListener('click', () => this._remove(el));
    this._container.appendChild(el);

    // Adiciona keyframes se necessário
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        @keyframes toastIn  { from { transform:translateX(110%) scale(.96); opacity:0 } to { transform:none; opacity:1 } }
        @keyframes toastOut { from { opacity:1; transform:none } to { opacity:0; transform:translateX(110%) scale(.96) } }
      `;
      document.head.appendChild(style);
    }

    const timer = setTimeout(() => this._remove(el), duration);
    el._timer = timer;
    return el;
  },

  success(msg, dur) { return this.show(msg, 'ok',    dur); },
  warn(msg, dur)    { return this.show(msg, 'warn',  dur); },
  error(msg, dur)   { return this.show(msg, 'error', dur); },
  info(msg, dur)    { return this.show(msg, 'info',  dur); },

  _remove(el) {
    clearTimeout(el._timer);
    el.style.animation = 'toastOut .2s ease forwards';
    setTimeout(() => el.remove(), 200);
  },
};

export default ToastComponent;
