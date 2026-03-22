/**
 * TESTES — utils/dom-safe-v2.js
 */
import { describe, it, expect } from 'vitest';
import { esc, escAttr, contemHtml } from '../utils/dom-safe-v2.js';

describe('esc — sanitização HTML', () => {
  it('escapa & < > " \'', () => {
    expect(esc('a & b')).toBe('a &amp; b');
    expect(esc('<script>')).toBe('&lt;script&gt;');
    expect(esc('"quoted"')).toBe('&quot;quoted&quot;');
    expect(esc("it's")).toBe("it&#39;s");
  });
  it('retorna string vazia para null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
  it('converte números para string', () => {
    expect(esc(42)).toBe('42');
  });
  it('neutraliza XSS clássico', () => {
    const payload = '<img src=x onerror=alert(1)>';
    expect(esc(payload)).toContain('&lt;img');
    expect(esc(payload)).not.toContain('<img');
  });
});

describe('escAttr — sanitização de atributos', () => {
  it('remove aspas e chevrons', () => {
    expect(escAttr('"hello"')).toBe('hello');
    expect(escAttr('<b>')).toBe('b');
  });
  it('não altera texto limpo', () => {
    expect(escAttr('minha-classe')).toBe('minha-classe');
  });
});

describe('contemHtml', () => {
  it('detecta tags HTML', () => {
    expect(contemHtml('<b>bold</b>')).toBe(true);
    expect(contemHtml('<script>alert(1)</script>')).toBe(true);
  });
  it('não detecta em texto simples', () => {
    expect(contemHtml('texto simples 100%')).toBe(false);
    expect(contemHtml('R$ 1.234,56')).toBe(false);
  });
  it('retorna false para null', () => {
    expect(contemHtml(null)).toBe(false);
  });
});
