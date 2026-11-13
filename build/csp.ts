/**
 * The Content Security Policy of the production build. The app loads only its own files: no other host appears anywhere in it.
 *
 * - `default-src 'none'` denies everything that is not listed.
 * - `script-src 'self'` and `style-src 'self'` allow the bundled script and stylesheet and no inline code. Styles that scripts set go
 *   through the CSSOM (`element.style`), which this policy allows; a `style` attribute written from markup would be blocked.
 * - `font-src 'self'` allows the bundled font files. It does not allow `data:`, so the build never inlines a font
 *   (`build.assetsInlineLimit: 0`).
 * - `connect-src 'none'`: the app makes no request of its own (no fetch, no socket, no beacon).
 *
 * Shared by the Vite plugin that writes the policy into `index.html` and by `tests/ui/csp.test.ts`.
 */
export const CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
] as const;

export const CSP_POLICY: string = CSP_DIRECTIVES.join('; ');
