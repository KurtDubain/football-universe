# Production Dependency Audit

Last reviewed: 2026-08-09

## Current Status

- `react-router-dom` is on `7.18.2`, the patched 7.x release for `GHSA-qwww-vcr4-c8h2`.
- The former audit exception has been removed from `package.json`; `pnpm audit --prod` now runs without ignored advisories.
- Production remains a static client-rendered Vercel deployment using `BrowserRouter` and SPA history fallback. It does not use React Server Components, SSR, route loaders/actions, or a React Router server runtime.
- Ordinary production builds compile out `window.__gameStore` and `window.__gameAudit`. Those bridges exist only in an explicit `VITE_ENABLE_AUDIT=true` build opened with `?audit=1`.

Any future production advisory is a CI failure until the dependency is patched or this document records a narrowly scoped, evidence-backed exception.
