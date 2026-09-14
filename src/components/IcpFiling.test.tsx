import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IcpFiling } from './ui';

afterEach(() => vi.unstubAllGlobals());

it('renders no element when disabled', () => {
  vi.stubGlobal('__ICP_FILING_ENABLED__', false);
  expect(renderToStaticMarkup(<IcpFiling />)).toBe('');
});

it('renders only the full filing link when enabled', () => {
  vi.stubGlobal('__ICP_FILING_ENABLED__', true);
  const html = renderToStaticMarkup(<IcpFiling />);
  expect(html).toContain('冀ICP备2023028175号-1');
  expect(html).toContain('href="https://beian.miit.gov.cn/"');
  expect(html).toContain('noopener noreferrer');
  expect(html).not.toContain('welcome-footer');
  expect(html).not.toMatch(/fixed|sticky/);
});
