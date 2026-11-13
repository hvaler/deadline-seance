// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';

describe('UI test tooling', () => {
  test('jsdom is available for this file', () => {
    const el = document.createElement('p');
    el.textContent = 'hello';
    document.body.append(el);
    expect(document.body.textContent).toBe('hello');
    el.remove();
  });

  test('textContent keeps markup as text', () => {
    const el = document.createElement('div');
    el.textContent = '<b>x</b>';
    expect(el.children).toHaveLength(0);
    expect(el.textContent).toBe('<b>x</b>');
  });
});
