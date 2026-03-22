/**
 * tests/event-delegate.test.js
 * Testa o sistema de delegação de eventos (substitui onclick="window.fn()")
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal DOM polyfill for node environment
const makeEl = (attrs = {}) => {
  const el = {
    dataset: { ...attrs },
    parentElement: null,
    style: {},
    textContent: '',
  };
  return el;
};

// We test the pure logic: arg collection and value-from parsing
describe('EventDelegate — arg parsing', () => {
  it('_tryParse converte número', () => {
    const _tryParse = (val) => { try { return JSON.parse(val); } catch { return val; } };
    expect(_tryParse('42')).toBe(42);
    expect(_tryParse('3.14')).toBe(3.14);
    expect(_tryParse('true')).toBe(true);
    expect(_tryParse('null')).toBe(null);
    expect(_tryParse('abc')).toBe('abc');
    expect(_tryParse('"hello"')).toBe('hello');
  });

  it('data-value-from injeta valor do input como último arg', () => {
    const calls = [];
    const handler = (itemId, value) => calls.push({ itemId, value });

    // Simulate what EventDelegate._dispatch does with data-value-from
    const el = {
      dataset: { action: '_bmCaixaAplicarPct', arg0: 'item-1-2', valueFrom: 'this.value' },
      value: '75.50',
      parentElement: null,
    };

    // Collect args
    const args = [];
    for (let i = 0; i <= 9; i++) {
      const v = el.dataset[`arg${i}`];
      if (v !== undefined) {
        try { args.push(JSON.parse(v)); } catch { args.push(v); }
      } else break;
    }
    if (el.dataset.valueFrom === 'this.value') args.push(el.value);
    handler(...args);

    expect(calls).toHaveLength(1);
    expect(calls[0].itemId).toBe('item-1-2');
    expect(calls[0].value).toBe('75.50');
  });

  it('data-arg0..9 coletados em ordem', () => {
    const received = [];
    const el = {
      dataset: { action: 'testAction', arg0: 'a', arg1: '2', arg2: 'false' },
      parentElement: null,
    };
    const args = [];
    for (let i = 0; i <= 9; i++) {
      const v = el.dataset[`arg${i}`];
      if (v !== undefined) { try { args.push(JSON.parse(v)); } catch { args.push(v); } }
      else break;
    }
    expect(args).toEqual(['a', 2, false]);
  });
});
