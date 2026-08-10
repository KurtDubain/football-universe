import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
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

function appVersionAsset(version: string, deploymentId: string): Plugin {
  return {
    name: 'football-app-version-asset',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version, buildId: deploymentId })}\n`,
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    manifest: true,
  },
  plugins: [
    appVersionAsset(packageJson.version, buildId),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'og-image.png'],
      manifest: {
        name: '足球联赛宇宙 Football Universe',
        short_name: '足球宇宙',
        description: '纯前端足球宇宙模拟器 — 32 球队, 3 级联赛, 4 项杯赛, 无限赛季',
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
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff2,webmanifest}'],
        globIgnores: [
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
              cacheName: 'football-route-chunks',
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\/assets\/match-opener-.*\.webp$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'football-match-openers',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\/assets\/world-cup-.*\.m4a$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'football-tournament-music',
              expiration: { maxEntries: 3, maxAgeSeconds: 60 * 60 * 24 * 90 },
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
})
