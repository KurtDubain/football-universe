import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import { resolveBuildTarget } from './scripts/build-target'
import { editionPlugin } from './scripts/edition-plugin'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  || process.env.GITHUB_SHA?.trim()
  || packageJson.version

function appVersionAsset(version: string, deploymentId: string, edition: string, presetId: string): Plugin {
  return {
    name: 'football-app-version-asset',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version, buildId: deploymentId, edition, presetId })}\n`,
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const target = resolveBuildTarget(mode, { ...loadEnv(mode, process.cwd(), ''), ...process.env });
  const deploymentId = target.edition + ':' + target.presetId + ':' + target.target + ':' + buildId;
  return {
  publicDir: target.edition === 'contest' ? false : 'public',
  define: {
    __APP_BUILD_ID__: JSON.stringify(deploymentId),
    'import.meta.env.VITE_ENABLE_AUDIT': JSON.stringify(String(target.audit)),
  },
  build: {
    manifest: true,
    outDir: target.outDir,
    sourcemap: false,
  },
  plugins: [
    editionPlugin(target),
    appVersionAsset(packageJson.version, deploymentId, target.edition, target.presetId),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: '足球联赛宇宙 Football Universe',
        id: '/' + target.edition + '/' + target.presetId,
        short_name: '足球宇宙',
        description: '观察者视角足球宇宙模拟器：默认32支球队、三级联赛、六项杯赛与跨赛季历史',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        skipWaiting: true,
        cacheId: 'football-' + target.edition + '-' + target.presetId,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff2}'],
        globIgnores: [
          'og-image.png',
          'favicon.svg',
          'icon-192.png',
          'icon-512.png',
          'assets/{AdvancedSearch,Calendar,Chronicle,CoachDetail,Coaches,Compare,Cup,History,League,Legends,Market,MemorableMatches,PlayerDetail,Players,Settings,TeamDetail,TeamEditor,Teams,Transfers}-*.js',
          'assets/match-opener-domestic-cup-v1-*.webp',
          'assets/match-opener-continental-v1-*.webp',
          'assets/match-opener-world-v1-*.webp',
        ],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'football-' + target.edition + '-route-chunks',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\/assets\/match-opener-.*\.webp$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'football-' + target.edition + '-match-openers',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\/assets\/(?:world|league|super|mainland|southern|eastern)-cup-.*\.m4a$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'football-' + target.edition + '-tournament-music',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
        ],
      },
    }),
  ],
  };
})
