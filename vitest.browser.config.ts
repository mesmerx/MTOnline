import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

// Detectar se está rodando com --ui ou VITEST_BROWSER_UI (para manter slowMo e headless: false)
const isUIMode = process.argv.includes('--ui') || process.env.VITEST_BROWSER_UI === 'true';

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions: {
          slowMo: isUIMode ? 500 : 100, // Aumentado para 500ms no modo UI, 100ms no modo normal
        },
      }),
      instances: [{ 
        browser: 'chromium',
      }],
      // Headless apenas quando não estiver em modo UI
      headless: !isUIMode,
    },
  },
});
