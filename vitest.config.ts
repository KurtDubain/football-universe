import { defineConfig } from 'vitest/config';
import * as BRAND from './src/config/brand';

export default defineConfig({
  define: { __APP_BRAND__: JSON.stringify(BRAND) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
