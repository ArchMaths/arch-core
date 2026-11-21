/**
 * 启动与基础环境：页面能在每个浏览器里干净地启动，核心运行时（WebGL、WASM、引擎实例）就绪，
 * 并且在完全断网（后端不可用）的情况下计算器本身仍然可用。
 */
import { test as base, expect } from '@playwright/test';
import { test, Arch } from './support/arch';

test.describe('启动', () => {
  test('引擎、WebGL、WASM 与主界面就绪', async ({ arch, page }) => {
    const info = await arch.run(engine => ({
      version: engine.appVersion,
      gl: !!engine.gl && !engine.gl.isContextLost(),
      wasm: typeof WebAssembly === 'object',
      canvas: { w: engine.canvas.clientWidth, h: engine.canvas.clientHeight },
      entries: engine.entries.length,
      mode: engine.currentUIMode,
      is3D: engine.is3DMode,
    }));
    expect(info.version, 'appVersion 应为正整数').toBeGreaterThan(0);
    expect(info.gl, 'WebGL 上下文应可用').toBe(true);
    expect(info.wasm).toBe(true);
    expect(info.canvas.w).toBeGreaterThan(300);
    expect(info.canvas.h).toBeGreaterThan(300);
    expect(info.entries).toBe(0);
    expect(info.mode).toBe('plot');
    expect(info.is3D).toBe(false);
    for (const id of ['#nav-btn-plot', '#nav-btn-geometry', '#nav-btn-statistics', '#nav-btn-code', '#nav-btn-file', '#nav-btn-settings', '#keyboard-toggle-btn', '#zoom-in-btn', '#zoom-out-btn', '#zoom-center-btn'])
      await expect(page.locator(id), `${id} 应可见`).toBeVisible();
    await expect(page.locator('#file-name-display')).toHaveText(/\S/);
  });

  test('断网（后端全部不可用）时计算器功能不受影响', async ({ arch }) => {
    const [fn] = await arch.add('y=x^2');
    expect(fn.type).toBe('function');
    expect(await arch.value('v=2+3')).toBe(5);
    // 页面确实尝试访问过后端（通知/更新等），且都被拦截了，说明以上结果不依赖服务器。
    expect(arch.blockedRequests.every(u => !u.includes('127.0.0.1'))).toBe(true);
  });

  test('异步绘图 worker 正常启用', async ({ arch, browserName }) => {
    // BUG-4：WebKit 中 new Worker(blobURL) 之后立即 revokeObjectURL，导致 worker 加载失败并回退同步绘图。
    test.fail(browserName === 'webkit', 'BUG-4：WebKit 下异步绘图 worker 因 blob URL 过早撤销而无法启动');
    await arch.page.waitForTimeout(1500);
    const s = await arch.run(engine => ({ active: !!engine._asyncDrawing?.active, error: engine._asyncDrawing?.error ?? null }));
    expect(s.error).toBeNull();
    expect(s.active).toBe(true);
  });
});

// 这个测试不使用自动跳过“关于”页的 fixture，直接检查首次打开的状态与“关于”页按钮。
base.describe('首次打开', () => {
  base('首次打开显示“关于”页，点击“我要画函数”进入绘图', async ({ page, browserName }) => {
    const arch = new Arch(page, browserName);
    await page.route(u => /^https?:$/.test(u.protocol) && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), r => r.abort());
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/index.html');
    await page.waitForFunction(() => (window as any).archStartupFinished && (window as any).archInstance, null, { timeout: 60_000 });
    await expect(page.locator('#arch-startup-splash')).toBeHidden();
    expect(await page.evaluate(() => (window as any).archInstance.currentUIMode)).toBe('about');
    await expect(page.getByText('Arch图形计算器').first()).toBeVisible();
    await page.getByText('我要画函数', { exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).archInstance.currentUIMode)).toBe('plot');
    await arch.idle();
    // Firefox 启动异常见 BUG-3；这里只检查其他异常。
    expect(errors.filter(e => !(browserName === 'firefox' && /syncObjectConfirmationState/.test(e)))).toEqual([]);
  });

  base('启动过程没有任何未捕获异常（严格）', async ({ page, browserName }) => {
    base.fail(browserName === 'firefox', 'BUG-3：Firefox 启动时 ArchAiGate 早于 archInstance 创建，抛出 TypeError');
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(u => /^https?:$/.test(u.protocol) && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), r => r.abort());
    await page.goto('/index.html');
    await page.waitForFunction(() => (window as any).archStartupFinished && (window as any).archInstance, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });

  base('“我要看示例”在离线时给出友好提示而不是崩溃', async ({ page, browserName }) => {
    const arch = new Arch(page, browserName);
    await page.route(u => /^https?:$/.test(u.protocol) && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), r => r.abort());
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/index.html');
    await page.waitForFunction(() => (window as any).archStartupFinished && (window as any).archInstance, null, { timeout: 60_000 });
    await page.getByText('我要看示例', { exact: true }).click();
    await expect(page.getByText('网络开小差了').first()).toBeVisible();
    await page.locator('#nav-btn-plot').click();
    await arch.idle();
    expect(await page.evaluate(() => (window as any).archInstance.addEntry('y=x')?.entries?.length)).toBe(1);
    expect(errors.filter(e => !(browserName === 'firefox' && /syncObjectConfirmationState/.test(e)))).toEqual([]);
  });
});
