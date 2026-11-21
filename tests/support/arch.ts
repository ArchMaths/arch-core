/**
 * Arch 图形计算器测试公共层。
 *
 * - 每个测试都在全新的浏览器上下文里打开 index.html（无 localStorage 残留）。
 * - 所有非本机的网络请求都会被拦截（云存档、登录、通知、更新、AI 都不测试，也不允许影响计算器功能）。
 * - 测试结束时自动断言：页面没有出现未捕获异常 / 未处理的 Promise 拒绝。
 *   这是“健壮性”最重要的一道网：任何操作把引擎弄崩，哪怕断言没覆盖到，也会让测试失败。
 */
import { test as base, expect, type Page, type Dialog, type BrowserType, type TestInfo } from '@playwright/test';

/** 已知且已报告的缺陷产生的页面异常。只在列出的浏览器上豁免，修复后应删除对应条目。 */
export const KNOWN_PAGE_ERRORS: { id: string; pattern: RegExp; browsers: string[] }[] = [
  {
    // BUG-3：Firefox 启动时 ArchAiGate 早于 archInstance 创建被调用（12.01 startNewConversation → updateAgentUI）。
    id: 'BUG-3 firefox ArchAiGate 早于 archInstance',
    pattern: /syncObjectConfirmationState/,
    browsers: ['firefox'],
  },
];

export interface EntryInfo {
  index: number;
  type: string;
  plotType?: string;
  geometryType?: string;
  name?: string;
  key?: string;
  autoNumber?: string;
  expr?: string;
  content?: string;
  value?: number | null;
  x?: number;
  y?: number;
  radius?: number;
  meaningful?: boolean;
  error?: string;
  sign?: string;
  independent?: boolean;
  min?: number;
  max?: number;
  step?: number;
  visible?: boolean;
  details?: string;
  color?: { h: number; s: number; b: number; a: number };
}

/** 在页面里执行：把引擎条目转成可序列化的精简描述。 */
const DESCRIBE = `(e, i) => ({
  index: i, type: e.type, plotType: e.plotType, geometryType: e.geometryType, name: e.name, key: e.key,
  autoNumber: e.autoNumber, expr: e.expr, content: e.content,
  value: typeof e.value === 'number' ? e.value : (e.value ?? undefined),
  x: e.x_val, y: e.y_val, radius: typeof e.radius === 'number' ? e.radius : undefined,
  meaningful: e.isMeaningful, error: e.compilationError || undefined, sign: e.sign,
  independent: e.isEditableIndependent, min: e.min ?? undefined, max: e.max ?? undefined, step: e.step ?? undefined,
  visible: e.visible, details: e.detailsString, color: e.color ? { ...e.color } : undefined,
})`;

export class Arch {
  /** 页面未捕获异常（已排除白名单）。 */
  readonly pageErrors: string[] = [];
  /** 被拦截的外部请求（仅记录，便于排查）。 */
  readonly blockedRequests: string[] = [];
  /** 遇到 prompt/confirm 时的回答；返回 undefined 表示 dismiss。 */
  dialogHandler: (d: Dialog) => string | boolean | undefined = () => undefined;
  readonly dialogs: string[] = [];
  /** 测试故意把页面弄卡死（已知缺陷用例）时设为 true，收尾时跳过页面健康检查。 */
  skipHealthCheck = false;

  constructor(readonly page: Page, readonly browserName: string) {}

  async open() {
    const { page } = this;
    await page.route(
      url => /^https?:$/.test(url.protocol) && !/^(127\.0\.0\.1|localhost)$/.test(url.hostname),
      route => {
        this.blockedRequests.push(route.request().url());
        return route.abort('blockedbyclient');
      },
    );
    await page.addInitScript(() => {
      (window as any).__archRejections = [];
      window.addEventListener('unhandledrejection', ev => {
        const r: any = (ev as PromiseRejectionEvent).reason;
        (window as any).__archRejections.push(String(r?.stack || r?.message || r));
      });
    });
    page.on('pageerror', err => {
      const text = `${err.name}: ${err.message}\n${err.stack ?? ''}`;
      const known = KNOWN_PAGE_ERRORS.find(k => k.pattern.test(text) && k.browsers.includes(this.browserName));
      if (!known) this.pageErrors.push(text);
    });
    page.on('dialog', async d => {
      this.dialogs.push(`${d.type()}: ${d.message()}`);
      const answer = this.dialogHandler(d);
      if (answer === undefined || answer === false) await d.dismiss().catch(() => {});
      else await d.accept(typeof answer === 'string' ? answer : undefined).catch(() => {});
    });

    await page.goto('/index.html');
    await page.waitForFunction(() => (window as any).archStartupFinished && (window as any).archInstance, null, { timeout: 60_000 });
    // 首次打开会停在“关于”页；进入绘图页（关于页按钮本身在 smoke 测试里单独测）。
    const nav = page.locator('#nav-btn-plot');
    if (await nav.isVisible()) await nav.click();
    else await page.evaluate(() => (window as any).archInstance.createArchScriptExtensions().ui.click('sidebar-plot')); // 竖屏布局
    await expect.poll(() => page.evaluate(() => (window as any).archInstance.currentUIMode)).toBe('plot');
    await this.idle();
  }

  /** 等待引擎空闲：表达式解析完成、异步绘图 worker 无待处理任务，再多等两帧让画面落地。 */
  async idle(timeout = 60_000) {
    await this.page.waitForFunction(
      () => {
        const a = (window as any).archInstance;
        const w = a._asyncDrawing;
        return !a._expressionParsingSources?.size && (!w?.active || (w.ready && !w.preparing && !w.busy && !w.dirty && !w.timer));
      },
      null,
      { timeout, polling: 50 },
    );
    await this.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  /** 在页面中执行函数，第一个参数是 archInstance，第二个是 ArchScript 扩展 API。 */
  run<R, A = undefined>(fn: (engine: any, api: any, arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    return this.page.evaluate(
      ({ src, arg }) => {
        const engine = (window as any).archInstance;
        const api = engine.createArchScriptExtensions();
        // eslint-disable-next-line no-new-func
        return new Function('engine', 'api', 'arg', `return (${src})(engine, api, arg)`)(engine, api, arg);
      },
      { src: fn.toString(), arg: arg as any },
    );
  }

  /**
   * 通过引擎添加一条输入（与输入框回车走同一入口 addEntry）。返回本次新增的条目。
   * 同名冲突时默认覆盖（不弹确认框）。
   */
  async add(expr: string): Promise<EntryInfo[]> {
    const out = await this.page.evaluate(
      ({ expr, describe }) => {
        const a = (window as any).archInstance;
        const d = new Function(`return ${describe}`)();
        const r = a.addEntry(expr, { conflictAction: 'overwrite' });
        return (r?.entries ?? []).map((e: any) => d(e, a.entries.indexOf(e)));
      },
      { expr, describe: DESCRIBE },
    );
    await this.idle();
    return out;
  }

  /** 批量添加，返回每条输入各自新增的条目。 */
  async addAll(exprs: string[]): Promise<EntryInfo[][]> {
    const res: EntryInfo[][] = [];
    for (const e of exprs) res.push(await this.add(e));
    return res;
  }

  async entries(): Promise<EntryInfo[]> {
    return this.page.evaluate(describe => {
      const d = new Function(`return ${describe}`)();
      return (window as any).archInstance.entries.map((e: any, i: number) => d(e, i));
    }, DESCRIBE);
  }

  /** 按名字 / key / 编号（func1、eq1…）/ 表达式查找条目。 */
  async entry(ref: string): Promise<EntryInfo> {
    const all = await this.entries();
    const low = ref.toLowerCase();
    const found =
      all.find(e => e.autoNumber?.toLowerCase() === low) ??
      all.find(e => e.name === ref || e.key === ref) ??
      all.find(e => e.name?.toLowerCase() === low || e.key?.toLowerCase() === low) ??
      all.find(e => e.expr === ref);
    if (!found) throw new Error(`找不到条目 ${ref}；现有：${all.map(e => e.name ?? e.autoNumber ?? e.expr).join(', ')}`);
    return found;
  }

  /** 新建变量 name=expr 并返回其数值（走用户输入路径）。 */
  async value(expr: string): Promise<number | null | undefined> {
    const [e] = await this.add(expr);
    if (!e) throw new Error(`输入 ${expr} 没有产生条目`);
    if (e.type !== 'variable') throw new Error(`输入 ${expr} 产生了 ${e.type}（${e.content ?? e.expr}），不是变量`);
    return e.value;
  }

  /** 对 2D 绘图对象（funcN / eqN / paraN）在给定参数处求值。 */
  evalPlot(ref: string, at: number | { x: number; y: number }, component: '' | 'X' | 'Y' = '') {
    return this.run(
      (engine, _api, { ref, at, component }) => {
        const e = engine.entries.find((x: any) => x.autoNumber?.toLowerCase() === ref.toLowerCase());
        if (!e) throw new Error('no entry ' + ref);
        return engine.evaluatePlotFunction(e, at, component);
      },
      { ref, at, component },
    );
  }

  /** 数学坐标 → 页面像素坐标（2D）。 */
  toScreen(x: number, y: number) {
    return this.run(
      (engine, _api, { x, y }) => {
        const r = engine.canvas.getBoundingClientRect();
        if (engine.is3DMode) {
          const s = engine.createArchScriptExtensions().view.toScreen(x, y, 0);
          return { x: r.left + s.x, y: r.top + s.y };
        }
        return { x: r.left + engine.offset.x + x * engine.scaleX, y: r.top + engine.offset.y - y * engine.scaleY };
      },
      { x, y },
    );
  }

  /** 设置条目颜色（HSB 0..100，a=透明度）与线宽，便于像素检测。 */
  async style(ref: string, color: { h: number; s: number; b: number; a?: number }, thickness?: number) {
    await this.run(
      (engine, _api, { ref, color, thickness }) => {
        const low = ref.toLowerCase();
        const e = engine.entries.find((x: any) => x.autoNumber?.toLowerCase() === low || x.name?.toLowerCase() === low);
        engine.setStyleParameters(e, { a: 0, ...color });
        if (thickness) engine.setStyleParameter(e, 'thickness', thickness);
        engine.recalculateAll();
        engine.updateEntryList();
        engine.requestDraw();
      },
      { ref, color, thickness },
    );
    await this.idle();
  }

  /**
   * 截图并在页面内解码，返回一个可以按页面坐标取色的采样器。
   * 用截图而不是 readPixels，是为了不依赖 preserveDrawingBuffer，且在所有浏览器/GPU（含软件渲染）上行为一致。
   */
  async pixels() {
    const png = await this.page.screenshot();
    const data = await this.page.evaluate(async b64 => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, dpr: img.width / innerWidth, px: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
    }, png.toString('base64'));
    const at = (x: number, y: number): [number, number, number] => {
      const px = Math.round(x * data.dpr), py = Math.round(y * data.dpr);
      const i = (py * data.w + px) * 4;
      return [data.px[i], data.px[i + 1], data.px[i + 2]];
    };
    /** 在 (x,y) 周围 radius 像素内，与 rgb 最接近的颜色距离（曼哈顿距离，0=完全相同）。 */
    const nearest = (x: number, y: number, rgb: [number, number, number], radius = 4) => {
      let best = Infinity;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const c = at(x + dx, y + dy);
          best = Math.min(best, Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]));
        }
      return best;
    };
    return { ...data, at, nearest };
  }

  /**
   * 在页面里“发后不理”地执行一段输入，然后检查主线程在 ms 毫秒内是否还能响应。
   * 用于检测死循环：返回 false 表示页面已卡死（此时应设置 skipHealthCheck）。
   */
  async addAndCheckResponsive(expr: string, ms = 5000): Promise<boolean> {
    this.page.evaluate(e => (window as any).archInstance.addEntry(e, { conflictAction: 'overwrite' }), expr).catch(() => {});
    const ok = await Promise.race([
      new Promise(r => setTimeout(r, 50)).then(() => this.page.evaluate(() => true)),
      new Promise<boolean>(r => setTimeout(() => r(false), ms)),
    ]).catch(() => false);
    return ok === true;
  }

  /** 统计两张截图在某矩形区域内差异明显的像素数量。 */
  static diffCount(a: { px: number[]; w: number; h: number }, b: { px: number[]; w: number; h: number }, threshold = 48) {
    let n = 0;
    for (let i = 0; i < Math.min(a.px.length, b.px.length); i += 4) {
      const d = Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]);
      if (d > threshold) n++;
    }
    return n;
  }

  /** 断言没有页面异常（fixture 收尾时会自动调用；测试中间也可以主动调用尽早失败）。 */
  async assertHealthy() {
    if (this.skipHealthCheck) return;
    const rejections: string[] = await this.page.evaluate(() => (window as any).__archRejections ?? []).catch(() => []);
    const filtered = rejections.filter(r => !KNOWN_PAGE_ERRORS.some(k => k.pattern.test(r) && k.browsers.includes(this.browserName)));
    expect(this.pageErrors, '页面出现未捕获异常').toEqual([]);
    expect(filtered, '页面出现未处理的 Promise 拒绝').toEqual([]);
  }
}

export const test = base.extend<{ arch: Arch }>({
  arch: async ({ page, browserName }, use) => {
    const arch = new Arch(page, browserName);
    await arch.open();
    await use(arch);
    await arch.assertHealthy();
  },
});

export { expect };

/**
 * 在独立的浏览器进程里打开 Arch。专门给“会把页面卡死”的已知缺陷用例使用：
 * 卡死的渲染进程如果留在共享浏览器里，会拖慢甚至卡住同一 worker 后续用例的导航；独立进程测完直接整个关闭。
 */
export async function isolatedArch(browserType: BrowserType, browserName: string, testInfo: TestInfo) {
  const use = testInfo.project.use as any;
  const browser = await browserType.launch({ channel: use.channel });
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, locale: use.locale });
  const page = await context.newPage();
  const arch = new Arch(page, browserName);
  await arch.open();
  return { arch, close: () => browser.close().catch(() => {}) };
}

/** 浮点比较：相对 + 绝对容差。 */
export function close(actual: number | null | undefined, expected: number, rel = 1e-9, abs = 1e-9) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return false;
  return Math.abs(actual - expected) <= Math.max(abs, rel * Math.abs(expected));
}

export function expectClose(actual: number | null | undefined, expected: number, message?: string, tol = 1e-6) {
  expect(actual, message).toEqual(expect.any(Number));
  expect(Math.abs((actual as number) - expected), `${message ?? ''} 实际 ${actual} 期望 ${expected}`).toBeLessThanOrEqual(
    Math.max(tol, tol * Math.abs(expected)),
  );
}
