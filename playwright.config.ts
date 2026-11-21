import { defineConfig, devices } from '@playwright/test';

/**
 * 被测页面：仓库根目录的 index.html（可用 ARCH_ROOT 指向别的目录，便于本地调试）。
 * 浏览器项目：
 *   chromium  —— Playwright 自带 Chromium
 *   chrome    —— 正式版 Google Chrome
 *   msedge    —— 正式版 Microsoft Edge
 *   firefox   —— Playwright 自带 Firefox
 *   webkit    —— Playwright 自带 WebKit（Safari 内核）
 * CI 里每个 job 只跑一个项目：npx playwright test --project=<browser>
 */
const PORT = Number(process.env.PORT || 4173);
const CI = !!process.env.CI;
const desktop = { viewport: { width: 1400, height: 900 } };

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: CI,
  // 环境出问题（例如浏览器拿不到 WebGL）时所有用例都会失败，累计 25 个失败就提前结束，避免空跑几个小时。
  maxFailures: CI ? 25 : undefined,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    // Linux CI 上 Firefox/WebKit 的无头模式没有软件 WebGL，workflow 会设置 HEADED=1 并在 Xvfb 中以有界面模式运行。
    headless: !process.env.HEADED,
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    acceptDownloads: true,
  },
  webServer: {
    command: 'node tests/support/server.mjs',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    timeout: 30_000,
    env: { PORT: String(PORT), ARCH_ROOT: process.env.ARCH_ROOT || '.' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'chrome', use: { ...devices['Desktop Chrome'], ...desktop, channel: 'chrome' } },
    { name: 'msedge', use: { ...devices['Desktop Edge'], ...desktop, channel: 'msedge' } },
    {
      name: 'firefox',
      // 无 GPU 的 CI 机器上 Firefox 默认会禁用 WebGL，这里强制启用（走 Mesa / WARP 软件渲染）。
      use: { ...devices['Desktop Firefox'], ...desktop, launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } } },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...desktop } },
  ],
});
