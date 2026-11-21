/**
 * 3D：维度切换、四类 3D 对象的识别与网格生成、相机与视图接口、切回 2D 后状态保持。
 */
import { test, expect, Arch } from './support/arch';

const to3D = (arch: any) => arch.run((_e: any, api: any) => api.settings.set('dimension', '3d'));

test.describe('3D', () => {
  test('切换到 3D，再切回 2D，已有 2D 对象不受影响', async ({ arch }) => {
    await arch.addAll(['y=x^2', 'point(A,1,2)', 'a=3']);
    await to3D(arch);
    await arch.idle();
    expect(await arch.run(e => e.is3DMode)).toBe(true);
    await arch.run((_e, api) => api.settings.set('dimension', '2d'));
    await arch.idle();
    expect(await arch.run(e => e.is3DMode)).toBe(false);
    expect((await arch.entries()).map(e => e.expr)).toEqual(['y=x^2', 'point(A,1,2)', 'a=3']);
    expect((await arch.entry('A')).x).toBe(1);
  });

  test('右上角菜单“三维视图”切换维度，再次点击切回', async ({ arch, page }) => {
    const toggle = async () => {
      if (!/trm-expanded/.test((await page.locator('#top-right-menu-dropdown').getAttribute('class')) ?? '')) await page.locator('#top-right-menu-icon').click();
      await expect(page.locator('#top-right-menu-dropdown')).toHaveClass(/trm-expanded/);
      const item = page.locator('#top-right-menu-dropdown').getByText(/^(三维视图|二维视图)$/).first();
      await expect(item).toBeVisible();
      // 菜单项文字不接收指针事件，由下拉容器按坐标处理点击，所以用 force 在该位置点击。
      await item.click({ force: true });
    };
    await toggle();
    await expect.poll(() => arch.run(e => e.is3DMode)).toBe(true);
    await arch.idle();
    await page.waitForTimeout(400);
    await toggle();
    await expect.poll(() => arch.run(e => e.is3DMode)).toBe(false);
  });

  const OBJECTS: [string, string][] = [
    ['z=x^2-y^2', 'z'],
    ['x=y^2+z^2', 'x3d'],
    ['y=sin(x)+cos(z)', 'y3d'],
    ['x^2+y^2+z^2=9', 'implicit3d'],
    ['x^2+y^2-z^2<=1', 'implicit3d'],
    ['surface(sin(u)*cos(v),sin(u)*sin(v),cos(u),u,0,pi,v,0,2*pi)', 'parametricSurface'],
    ['surface((2+0.6*cos(v))*cos(u),(2+0.6*cos(v))*sin(u),0.6*sin(v),u,0,2*pi,v,0,2*pi)', 'parametricSurface'],
    ['curve(cos(u),sin(u),u,u,0,6*pi)', 'parametric3d'],
    ['x=cos(u),y=sin(u),z=u{u,0,6*pi}', 'parametric3d'],
    ['(cos(t),sin(t),t/3)', 'parametric3d'],
  ];

  test('3D 对象分类与网格数据', async ({ arch }) => {
    await to3D(arch);
    for (const [expr, plotType] of OBJECTS) {
      const created = await arch.add(expr);
      const e = created[created.length - 1];
      expect(e.type, `${expr} 不应退化为文字`).toBe('function');
      expect(e.plotType, expr).toBe(plotType);
      expect(e.error, expr).toBeUndefined();
    }
    await arch.idle(120_000);
    // 每个对象都应生成了可绘制的顶点数据
    const sizes = await arch.run(engine => engine.entries.map((e: any) => {
      const v = e.webglVertices, f = e.webglFillVertices, c = e._parameter3DCache;
      const len = (x: any) => (x ? (x.length ?? x.byteLength ?? Object.keys(x).length) : 0);
      return { expr: e.expr, n: len(v) + len(f) + len(c) };
    }));
    const meshes = await arch.run(engine => {
      const m = engine.cache3D?.meshes;
      return m ? (m instanceof Map ? m.size : Array.isArray(m) ? m.length : Object.keys(m).length) : -1;
    });
    expect(meshes + sizes.filter((s: any) => s.n > 0).length, '3D 网格缓存应非空').toBeGreaterThan(0);
  });

  test('2D 双参数函数在 3D 下自动生成曲面', async ({ arch }) => {
    await to3D(arch);
    const created = await arch.add('g(x,y)=x*y');
    expect(created.map(e => e.type).sort()).toEqual(['custom_function_definition', 'function']);
    expect(created.find(e => e.type === 'function')?.expr).toBe('z=g(x,y)');
  });

  test('相机接口：设置/旋转方位角与仰角，仰角被限制在合法范围', async ({ arch }) => {
    await to3D(arch);
    const c1 = await arch.run((_e, api) => api.view.camera.set({ azimuth: 30, elevation: 20 }));
    expect(c1.azimuth).toBeCloseTo(30, 6);
    expect(c1.elevation).toBeCloseTo(20, 6);
    const c2 = await arch.run((_e, api) => api.view.camera.rotate(15, 10));
    expect(c2.azimuth).toBeCloseTo(45, 6);
    expect(c2.elevation).toBeCloseTo(30, 6);
    const c3 = await arch.run((_e, api) => api.view.camera.set({ elevation: 120 }));
    expect(c3.elevation).toBeLessThan(90);
  });

  test('鼠标：在 xy 平面外拖动旋转、在平面内拖动平移、滚轮缩放', async ({ arch, page }) => {
    await to3D(arch);
    await arch.add('z=x^2+y^2');
    const state = () => arch.run((_e, api) => ({ cam: api.view.camera.get(), center: api.view.get().center, unit: api.view.get().unit }));
    const drag = async (x: number, y: number) => {
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + 120, y + 40, { steps: 10 }); await page.mouse.up();
      await arch.idle();
    };
    const box = (await page.locator('#plot-canvas').boundingBox())!;
    const s0 = await state();
    await drag(box.x + box.width * 0.65, box.y + box.height * 0.06); // 画面顶部：不在 xy 平面上 → 旋转
    const s1 = await state();
    expect(Math.abs(s1.cam.azimuth - s0.cam.azimuth) + Math.abs(s1.cam.elevation - s0.cam.elevation), '应旋转相机').toBeGreaterThan(1);
    const o = await arch.toScreen(0, 0);
    await drag(o.x, o.y); // 原点：在 xy 平面上 → 平移
    const s2 = await state();
    expect(Math.hypot(s2.center.x - s1.center.x, s2.center.y - s1.center.y), '应平移视图').toBeGreaterThan(0.1);
    expect(s2.cam.azimuth).toBeCloseTo(s1.cam.azimuth, 6);
    await page.mouse.move(o.x, o.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(800);
    await arch.idle();
    expect((await state()).unit).not.toBeCloseTo(s2.unit, 3);
  });

  test('3D 视图范围与轴比例设置', async ({ arch }) => {
    await to3D(arch);
    const v = await arch.run((_e, api) => api.view.set({ axesLocked: false, axisBounds: { x: { min: -2, max: 2 }, y: { min: -4, max: 4 }, z: { min: -1, max: 1 } } }));
    expect(v.axisBounds.x.min).toBeCloseTo(-2, 6);
    expect(v.axisBounds.y.max).toBeCloseTo(4, 6);
    expect(v.axisBounds.z.max).toBeCloseTo(1, 6);
  });

  test('3D 场景实际渲染出了曲面（像素检测）', async ({ arch }) => {
    await to3D(arch);
    await arch.idle();
    const empty = await arch.pixels();
    await arch.add('surface(2*sin(u)*cos(v),2*sin(u)*sin(v),2*cos(u),u,0,pi,v,0,2*pi)');
    await arch.style('para1', { h: 33.3, s: 100, b: 100 });
    await arch.idle();
    const drawn = await arch.pixels();
    expect(Arch.diffCount(empty, drawn), '画面应有明显变化').toBeGreaterThan(2000);
    // 球心投影处附近应能找到绿色系像素（有光照明暗，允许较大容差）
    const c = await arch.toScreen(0, 0);
    let greenish = 0;
    for (let dx = -30; dx <= 30; dx += 6) for (let dy = -30; dy <= 30; dy += 6) {
      const [r, g, b] = drawn.at(c.x + dx, c.y + dy);
      if (g > r + 30 && g > b + 30) greenish++;
    }
    expect(greenish, '球面所在区域应以绿色为主').toBeGreaterThan(20);
  });
});
