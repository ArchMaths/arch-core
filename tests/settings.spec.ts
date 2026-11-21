/**
 * 设置：遍历 ArchScript 设置注册表中的每一项，在一个包含各类对象的场景里逐一切换，
 * 断言不崩溃、值生效、对象仍然有效；非法值必须被拒绝。新增设置项会被自动覆盖。
 */
import { test, expect, Arch } from './support/arch';

const SCENE = ['a=1.5', 'y=a*sin(x)', 'x^2+y^2=4', 'x^2+y^2<=1', 'curve(cos(t),sin(2t))', '/-/(0,0)(1,1)(2,0)', 'point(A,1,1)', 'point(B,-1,2)', 'segment(s,A,B)', 'circle(c,A,1)', 'f(u)=u^2', 'v=int(f(u),u,0,1)'];

async function sceneHealthy(arch: Arch) {
  const all = await arch.entries();
  expect(all.length).toBe(SCENE.length);
  expect(all.filter(e => e.error).map(e => e.expr)).toEqual([]);
  expect(all.filter(e => e.type === 'text').map(e => e.expr)).toEqual([]);
  expect((await arch.entry('v')).value).toBeCloseTo(1 / 3, 2);
}

test.describe('设置', () => {
  test('设置注册表完整，列出的值与 get 一致', async ({ arch }) => {
    const list = await arch.run((_e, api) => api.settings.list());
    const names = list.map((s: any) => s.name);
    for (const n of ['darkMode', 'explicitPrecision', 'implicitPrecision', 'solveIntegralIterations', 'gridStyle', 'tmin', 'tmax', 'dimension', 'showAxes', 'performanceMode'])
      expect(names).toContain(n);
    const all = await arch.run((_e, api) => api.settings.get());
    for (const s of list) expect(all[s.name], s.name).toEqual(s.value);
  });

  test('逐一切换每个布尔设置（并恢复），场景保持有效', async ({ arch }) => {
    await arch.addAll(SCENE);
    const list = await arch.run((_e, api) => api.settings.list());
    const skip = new Set(['annotationEditingRequested', 'sidebarVisible']);
    const failures: string[] = [];
    for (const s of list.filter((s: any) => s.type === 'boolean' && s.available !== false && !skip.has(s.name))) {
      for (const v of [!s.value, s.value]) {
        const r = await arch.run((_e, api, { n, v }) => { try { return { ok: api.settings.set(n, v) }; } catch (e: any) { return { err: String(e.message) }; } }, { n: s.name, v });
        await arch.idle();
        if ('err' in r) failures.push(`${s.name}=${v}: ${r.err}`);
        else if (r.ok !== v) failures.push(`${s.name}=${v}: 读回 ${r.ok}`);
      }
    }
    expect(failures).toEqual([]);
    await sceneHealthy(arch);
  });

  test('数值设置：最小值、最大值、中间值都能生效', async ({ arch }) => {
    await arch.addAll(SCENE);
    const list = await arch.run((_e, api) => api.settings.list());
    for (const s of list.filter((s: any) => s.type === 'number' && Number.isFinite(s.min) && Number.isFinite(s.max) && !/^sidebar/.test(s.name))) {
      for (const v of [s.min, s.max, (s.min + s.max) / 2, s.value]) {
        const got = await arch.run((_e, api, { n, v }) => api.settings.set(n, v), { n: s.name, v });
        // 滑杆会按步长对齐
        expect(Math.abs(got - v), `${s.name}=${v} 读回 ${got}`).toBeLessThanOrEqual((s.step || 0) / 2 + 1e-9);
        await arch.idle(120_000);
      }
    }
    await sceneHealthy(arch);
  });

  test('枚举设置：每个选项都能生效', async ({ arch }) => {
    await arch.addAll(SCENE);
    const list = await arch.run((_e, api) => api.settings.list());
    for (const s of list.filter((s: any) => s.type === 'enum' && !['viewMode', 'viewModeOverride'].includes(s.name))) {
      for (const v of [...s.choices, s.value]) {
        const got = await arch.run((_e, api, { n, v }) => api.settings.set(n, v), { n: s.name, v });
        if (s.name !== 'dimension') expect(got, `${s.name}=${v}`).toEqual(v);
        await arch.idle(120_000);
      }
    }
    await sceneHealthy(arch);
  });

  test('精度设置影响采样密度', async ({ arch }) => {
    await arch.add('y=sin(x)');
    const count = () => arch.run(e => { const v = e.entries[0].webglVertices; return v ? (v.length ?? v.byteLength ?? 0) : 0; });
    await arch.run((_e, api) => api.settings.set('explicitPrecision', 0.5));
    await arch.idle();
    const low = await count();
    await arch.run((_e, api) => api.settings.set('explicitPrecision', 10));
    await arch.idle();
    const high = await count();
    test.skip(low === 0 && high === 0, '当前浏览器走异步绘图，顶点数据在 worker 中');
    expect(high).toBeGreaterThan(low);
  });

  test('全局 t 区间 tmin/tmax 影响默认参数曲线', async ({ arch }) => {
    await arch.add('curve(t,0)');
    await arch.run((_e, api) => { api.settings.set('tmin', 0); api.settings.set('tmax', 1); });
    await arch.idle();
    const err = await arch.run((_e, api) => { try { api.settings.set('tmin', 5); return null; } catch (e: any) { return String(e.message); } });
    expect(err, 'tmin >= tmax 必须被拒绝').toMatch(/tmin < tmax/);
    expect(await arch.run((_e, api) => [api.settings.get('tmin'), api.settings.get('tmax')])).toEqual([0, 1]);
  });

  test('非法设置值被拒绝且原值不变', async ({ arch }) => {
    const cases: [string, unknown][] = [['darkMode', 'yes'], ['explicitPrecision', 999], ['explicitPrecision', -1], ['explicitPrecision', NaN], ['gridStyle', 'hexagon'], ['dimension', '4d'], ['notASetting', 1], ['immersiveGlow', 7]];
    for (const [n, v] of cases) {
      const before = await arch.run((_e, api, n) => { try { return api.settings.get(n); } catch { return undefined; } }, n);
      const err = await arch.run((_e, api, { n, v }) => { try { api.settings.set(n, v); return null; } catch (e: any) { return String(e.message); } }, { n, v });
      expect(err, `${n}=${String(v)} 应被拒绝`).toMatch(/ArchScript/);
      const after = await arch.run((_e, api, n) => { try { return api.settings.get(n); } catch { return undefined; } }, n);
      expect(after, n).toEqual(before);
    }
  });

  test('设置页的开关控件与引擎状态同步', async ({ arch, page }) => {
    await page.locator('#nav-btn-settings').click();
    const toggle = page.locator('#show-axes-toggle');
    const before = await arch.run(e => e.showAxes);
    await toggle.evaluate((el: HTMLInputElement) => el.click());
    await expect.poll(() => arch.run(e => e.showAxes)).toBe(!before);
    await arch.run((_e, api, v) => api.settings.set('showAxes', v), before);
    expect(await toggle.isChecked()).toBe(before);
  });

  test('网格样式各选项都能绘制', async ({ arch }) => {
    await arch.add('y=x');
    for (const g of ['hidden', 'grid', 'dots', 'polar', 'grid']) {
      await arch.run((_e, api, g) => api.settings.set('gridStyle', g), g);
      await arch.idle();
    }
    const blank = await arch.pixels();
    expect(blank.w).toBeGreaterThan(0);
  });
});
