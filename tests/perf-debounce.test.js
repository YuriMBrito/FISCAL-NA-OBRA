/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TESTES — utils/perf-debounce.js                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle, memoize, BatchQueue } from '../utils/perf-debounce.js';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('executa fn apenas após delay', () => {
    const fn = vi.fn();
    const deb = debounce(fn, 100);
    deb(); deb(); deb();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel interrompe execução pendente', () => {
    const fn = vi.fn();
    const deb = debounce(fn, 100);
    deb();
    deb.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush executa imediatamente', () => {
    const fn = vi.fn();
    const deb = debounce(fn, 1000);
    deb();
    deb.flush('arg');
    expect(fn).toHaveBeenCalledWith('arg');
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('executa no máximo 1x por limit ms', () => {
    const fn = vi.fn();
    const thr = throttle(fn, 100);
    thr(); thr(); thr(); // apenas 1 deve disparar agora
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    thr();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('memoize', () => {
  it('retorna resultado cacheado para os mesmos argumentos', () => {
    const fn = vi.fn((a, b) => a + b);
    const mem = memoize(fn);
    expect(mem(1, 2)).toBe(3);
    expect(mem(1, 2)).toBe(3);
    expect(fn).toHaveBeenCalledTimes(1); // apenas 1 chamada real
  });

  it('chama fn novamente para argumentos diferentes', () => {
    const fn = vi.fn((a, b) => a + b);
    const mem = memoize(fn);
    mem(1, 2); mem(3, 4);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clear limpa o cache', () => {
    const fn = vi.fn((x) => x * 2);
    const mem = memoize(fn);
    mem(5); mem.clear(); mem(5);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('BatchQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('agrupa múltiplos itens em um lote', () => {
    const fn = vi.fn();
    const q  = new BatchQueue(fn, 200);
    q.add('a'); q.add('b'); q.add('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('forceFlush executa imediatamente', () => {
    const fn = vi.fn();
    const q  = new BatchQueue(fn, 1000);
    q.add('x'); q.forceFlush();
    expect(fn).toHaveBeenCalledWith(['x']);
  });

  it('cancel descarta itens pendentes', () => {
    const fn = vi.fn();
    const q  = new BatchQueue(fn, 200);
    q.add('y'); q.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});
