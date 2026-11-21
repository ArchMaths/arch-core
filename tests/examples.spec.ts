/**
 * 示例存档回归（黄金指纹）。
 *
 * tests/fixtures/examples 里是官方公开示例存档的快照（新手教程、尺规作图、3D 建模、解析几何、全局脚本……
 * 覆盖了几乎所有功能和大量对象之间的引用）。每个存档：
 *   1. 离线加载，不能有页面异常、编译错误；
 *   2. 计算“指纹”：每个对象的类型/名称/数值/坐标/有意义性，以及 2D 曲线在几个采样点的取值；
 *   3. 与 tests/golden/<serial>.json 比较（浮点容差）——任何改动导致计算结果变化都会在这里暴露；
 *   4. 导出→再加载，指纹不变；
 *   5. 画面确实画出了东西。
 *
 * 有意改变了计算结果时，运行 `npm run test:update-golden` 重新生成黄金文件并在 PR 中说明原因。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, Arch } from './support/arch';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'examples');
const GOLDEN = path.join(HERE, 'golden');
const UPDATE = !!process.env.UPDATE_GOLDEN;
const manifest: { examples: { serial: string; title: string; bytes: number }[] } = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'index.json'), 'utf8'));

/** 在页面里计算指纹（数值保留 10 位有效数字，非有限值记为字符串）。 */
const FINGERPRINT = () => {
  const engine = (window as any).archInstance;
  const num = (v: any) => (typeof v !== 'number' ? (v ?? null) : Number.isFinite(v) ? Number(v.toPrecision(10)) : String(v));
  const sample = (e: any) => {
    const kind = engine.getEntryAutoNumberKind?.(e);
    try {
      if (kind === 'func' && (e.plotType === 'y' || e.plotType === 'x')) return [-1.3, 0.7, 2.1].map(v => num(engine.evaluatePlotFunction(e, v)));
      if (kind === 'eq' && e.plotType === 'implicit') return [[0.3, 0.4], [1.1, -0.7]].map(([x, y]) => num(engine.evaluatePlotFunction(e, { x, y })));
      if (kind === 'para' && e.plotType === 'parametric') return ['X', 'Y'].map(c => num(engine.evaluatePlotFunction(e, 0.5, c)));
    } catch (err) { return 'throws'; }
    return undefined;
  };
  const counts: Record<string, number> = {};
  const entries = engine.entries.map((e: any) => {
    const kind = [e.type, e.plotType, e.geometryType].filter(Boolean).join(':');
    counts[kind] = (counts[kind] ?? 0) + 1;
    const o: any = { kind, id: e.name ?? e.autoNumber ?? e.key ?? null };
    if (e.compilationError) o.error = true;
    if (e.isMeaningful === false) o.meaningless = true;
    for (const [k, src] of [['value', 'value'], ['x', 'x_val'], ['y', 'y_val'], ['r', 'radius']] as const) if (e[src] !== undefined && e[src] !== null && typeof e[src] !== 'object') o[k] = num(e[src]);
    const s = sample(e);
    if (s !== undefined) o.samples = s;
    return o;
  });
  const api = engine.createArchScriptExtensions();
  return {
    count: engine.entries.length,
    kinds: counts,
    is3D: engine.is3DMode,
    annotations: engine.annotations.length,
    script: (engine.globalScript || '').length,
    regressions: api.table.regressions().map((r: any) => ({ type: r.type, coefficients: (r.result?.coefficients ?? []).map(num), error: !!r.result?.error })),
    entries,
  };
};

/** 带容差的深比较，返回差异列表（最多 30 条）。 */
function diff(a: any, b: any, p = '', out: string[] = []): string[] {
  if (out.length >= 30) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > Math.max(1e-7, 1e-6 * Math.max(Math.abs(a), Math.abs(b)))) out.push(`${p}: ${b} → ${a}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${p}: 长度 ${b.length} → ${a.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${p}[${i}]`, out);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], p ? `${p}.${k}` : k, out);
  } else if (a !== b) out.push(`${p}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
  return out;
}

async function loadFrozen(arch: Arch, state: string) {
  // 直接同步加载并立刻停止所有播放，保证指纹与时间无关。
  await arch.page.evaluate(s => {
    const engine = (window as any).archInstance;
    engine.loadState(s);
    for (const e of engine.entries) if (e.playState) e.playState = 0;
    engine.updateGlobalPlayState?.();
    engine.recalculateAll();
    engine.requestDraw();
  }, state);
  await arch.idle(240_000);
}

for (const ex of manifest.examples) {
  test(`示例 ${ex.serial} ${ex.title}`, async ({ arch }, testInfo) => {
    // 大存档（主要是复杂 3D 模型）加载和重算很慢：push/PR 时跳过，每日定时任务和手动触发（ARCH_FULL=1）时才跑。
    test.skip(ex.bytes > 300_000 && !!process.env.CI && !process.env.ARCH_FULL && !UPDATE, '大存档只在完整运行（ARCH_FULL=1）时测试');
    test.setTimeout(ex.bytes > 500_000 ? 600_000 : 240_000);
    const state = fs.readFileSync(path.join(FIXTURES, `${ex.serial}.json`), 'utf8');
    const blank = await arch.pixels();

    await loadFrozen(arch, state);
    await arch.assertHealthy();
    const fp = await arch.page.evaluate(FINGERPRINT);

    // 1. 不应有编译错误
    expect(fp.entries.filter((e: any) => e.error).map((e: any) => e.id), '存在编译错误的对象').toEqual([]);

    // 2. 与黄金指纹比较
    const goldenFile = path.join(GOLDEN, `${ex.serial}.json`);
    if (UPDATE) {
      fs.mkdirSync(GOLDEN, { recursive: true });
      fs.writeFileSync(goldenFile, JSON.stringify({ title: ex.title, ...fp }, null, 1) + '\n');
      testInfo.annotations.push({ type: 'golden', description: `已更新 ${goldenFile}` });
    } else {
      expect(fs.existsSync(goldenFile), `缺少黄金文件 ${goldenFile}，请运行 npm run test:update-golden`).toBe(true);
      const { title: _t, ...golden } = JSON.parse(fs.readFileSync(goldenFile, 'utf8'));
      const d = diff(fp, golden);
      expect(d, `与黄金指纹不一致（${d.length} 处，最多列出 30 处）：\n${d.join('\n')}`).toEqual([]);
    }

    // 3. 画面有内容
    const drawn = await arch.pixels();
    expect(Arch.diffCount(blank, drawn), '加载后画面几乎没有变化').toBeGreaterThan(500);

    // 4. 导出 → 新建 → 再加载，指纹不变
    const exported = await arch.run(e => JSON.stringify(e.exportStateObject()));
    await arch.run(e => e.createNewProject());
    await arch.idle();
    await loadFrozen(arch, exported);
    const fp2 = await arch.page.evaluate(FINGERPRINT);
    const d2 = diff(fp2, fp);
    expect(d2, `导出再加载后结果改变：\n${d2.join('\n')}`).toEqual([]);
  });
}
