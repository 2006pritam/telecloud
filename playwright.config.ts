import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: [{
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { DATA_DIR: './data-e2e', TELEGRAM_API_ID: '0', TELEGRAM_API_HASH: '', APP_PASSWORD: '' },
  }, {
    command: 'node --import tsx e2e/telegram-server.ts',
    url: 'http://127.0.0.1:3002/api/auth/status',
    reuseExistingServer: false,
  }],
});
