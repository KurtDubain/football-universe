# Production Dependency Audit

## React Router RSC Advisory

`GHSA-qwww-vcr4-c8h2` is intentionally ignored for the current static build.

- The application uses `BrowserRouter`, `Routes`, and client-rendered route components.
- It does not use React Server Components, SSR, route loaders/actions, or a React Router server runtime.
- Vercel serves only generated static files and the SPA history fallback.
- `react-router-dom` remains on the latest published 7.x release and should be upgraded when a compatible release patches the advisory.

The ignore is limited to this GHSA. All other production dependency advisories remain CI failures.
