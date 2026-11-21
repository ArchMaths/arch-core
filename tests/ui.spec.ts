/**
 * 界面交互：真实用户操作路径（物理键盘、虚拟数学键盘、卡片编辑/删除、撤销重做、视图操作、侧栏、主题、布局），
 * 以及 2D 渲染的像素级检查（曲线确实画在了正确的位置）。
 */
import { test, expect, Arch, expectClose } from './support/arch';

const view = (arch: Arch) => arch.run((_e, api) => { const v = api.view.get(); return { center: v.center, unit: v.unit }; });

test.describe('表达式输入', () => {
  test('物理键盘：打开输入框、输入、回车创建函数', async ({ arch, page }) => {
    await page.locator('#keyboard-toggle-btn').click();
    await expect(page.locator('#keyboard')).toBeVisible();
    await page.keyboard.type('y=sin(x)*x');
    await expect(page.locator('#keyboard-input-display')).toContainText('sin');
    await page.keyboard.press('Enter');
    await arch.idle();
    const [e] = await arch.entries();
    expect(e).toMatchObject({ type: 'function', plotType: 'y', expr: 'y=sin(x)*x' });
    await expect(page.locator('#entry-list')).toContainText('func1');
  });

  test('虚拟数学键盘：按键输入 x^2+1 并回车', async ({ arch, page }) => {
    await page.locator('#keyboard-toggle-btn').click();
    const key = (k: string) => page.locator(`#keyboard-page-1 [data-key="${k}"]`).first().click();
    for (const k of ['y', '=', 'x', '^', '2', '+', '1']) await key(k);
    await expect(page.locator('#keyboard-input-display')).toContainText('x');
    await key('enter');
    await arch.idle();
    const [e] = await arch.entries();
    expect(e?.expr).toBe('y=x^2+1');
  });

  test('虚拟键盘：退格、左右移动光标、翻页', async ({ arch, page }) => {
    await page.locator('#keyboard-toggle-btn').click();
    const key = (k: string, p = 1) => page.locator(`#keyboard-page-${p} [data-key="${k}"]`).first().click();
    for (const k of ['y', '=', '2', '3']) await key(k);
    await key('←');
    await key('del'); // 删除光标前的 2
    await key('→');
    await key('+');
    await page.locator('.keyboard-page-btn[data-kpage="2"]').click();
    await key('sin(', 2);
    await page.locator('.keyboard-page-btn[data-kpage="1"]').click();
    for (const k of ['x', ')', 'enter']) await key(k);
    await arch.idle();
    expect((await arch.entries())[0]?.expr).toBe('y=3+sin(x)');
  });

  test('非法输入回车后变为文字条目，界面不报错', async ({ arch, page }) => {
    await page.locator('#keyboard-toggle-btn').click();
    await page.keyboard.type('y=sin(,)');
    await page.keyboard.press('Enter');
    await arch.idle();
    expect((await arch.entries())[0]).toMatchObject({ type: 'text', content: 'y=sin(,)' });
  });

  test('点击已有卡片编辑表达式', async ({ arch, page }) => {
    await arch.addAll(['a=2', 'y=a*x']);
    // 点击卡片展开操作按钮，再点“编辑”
    await page.locator('.entry-item[data-index="1"] .entry-text-area').click();
    await page.locator('.entry-item[data-index="1"] .edit-btn').click();
    await expect(page.locator('#keyboard')).toBeVisible();
    await expect(page.locator('#keyboard-input-display')).toContainText('a');
    await page.keyboard.press('End');
    await page.keyboard.type('+1');
    await page.keyboard.press('Enter');
    await arch.idle();
    expect((await arch.entries()).map(e => e.expr)).toEqual(['a=2', 'y=a*x+1']);
    expectClose(await arch.evalPlot('func1', 3), 7);
  });

  test('卡片删除按钮（默认无确认）与撤销/重做按钮', async ({ arch, page }) => {
    await arch.addAll(['y=x', 'y=2x', 'y=3x']);
    const card = page.locator('.entry-item[data-index="1"]');
    await card.locator('.entry-text-area').click(); // 展开卡片
    await card.locator('.delete-btn').click();
    await arch.idle();
    expect((await arch.entries()).map(e => e.expr)).toEqual(['y=x', 'y=3x']);
    await page.locator('#undo-btn-sidebar').click();
    await arch.idle();
    expect((await arch.entries()).map(e => e.expr)).toEqual(['y=x', 'y=2x', 'y=3x']);
    await page.locator('#redo-btn-sidebar').click();
    await arch.idle();
    expect((await arch.entries()).map(e => e.expr)).toEqual(['y=x', 'y=3x']);
    // 连续撤销到底，按钮变为不可用
    for (let i = 0; i < 5; i++) await arch.run(e => e.undoStack.length && e.undo());
    await expect(page.locator('#undo-btn-sidebar')).toHaveClass(/disabled/);
    expect(await arch.entries()).toEqual([]);
  });

  test('开启删除确认后，取消则不删除', async ({ arch, page }) => {
    await arch.run((_e, api) => api.settings.set('deleteConfirmation', true));
    await arch.add('y=x');
    const card = page.locator('.entry-item[data-index="0"]');
    await card.locator('.entry-text-area').click(); // 展开卡片
    await card.locator('.delete-btn').click();
    // 确认框是应用内弹窗；按 Esc 或点击取消
    const cancel = page.getByRole('button', { name: /取消/ }).first();
    if (await cancel.isVisible().catch(() => false)) await cancel.click(); else await page.keyboard.press('Escape');
    await arch.idle();
    expect(await arch.entries()).toHaveLength(1);
  });

  test('键盘快捷键 Ctrl/Cmd+Z 撤销', async ({ arch, page }) => {
    await arch.addAll(['y=x', 'y=x^2']);
    await page.locator('#plot-canvas').click({ position: { x: 900, y: 100 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await arch.idle();
    expect(await arch.entries()).toHaveLength(1);
  });
});

test.describe('视图操作', () => {
  test('放大 / 缩小 / 居中按钮', async ({ arch, page }) => {
    const v0 = await view(arch);
    await page.locator('#zoom-in-btn').click();
    await arch.idle(); await page.waitForTimeout(400);
    const v1 = await view(arch);
    expect(v1.unit).toBeGreaterThan(v0.unit);
    await page.locator('#zoom-out-btn').click();
    await page.locator('#zoom-out-btn').click();
    await arch.idle(); await page.waitForTimeout(400);
    expect((await view(arch)).unit).toBeLessThan(v1.unit);
    await arch.run((_e, api) => api.view.set({ center: { x: 50, y: 50 } }));
    await page.locator('#zoom-center-btn').click();
    await arch.idle(); await page.waitForTimeout(400);
    const v3 = await view(arch);
    expect(Math.hypot(v3.center.x, v3.center.y)).toBeLessThan(5);
  });

  test('鼠标拖动平移、滚轮缩放（以光标为中心）', async ({ arch, page }) => {
    const v0 = await view(arch);
    const o = await arch.toScreen(0, 0);
    await page.mouse.move(o.x, o.y);
    await page.mouse.down();
    await page.mouse.move(o.x + 200, o.y + 100, { steps: 10 });
    await page.mouse.up();
    await arch.idle(); await page.waitForTimeout(300);
    const v1 = await view(arch);
    expectClose(v1.center.x, v0.center.x - 200 / v0.unit, '平移后中心 x', 0.05);
    expectClose(v1.center.y, v0.center.y + 100 / v0.unit, '平移后中心 y', 0.05);
    const p = await arch.toScreen(1, 1);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(1200);
    await arch.idle();
    const v2 = await view(arch);
    expect(v2.unit).toBeGreaterThan(v1.unit);
    const p2 = await arch.toScreen(1, 1);
    expect(Math.hypot(p2.x - p.x, p2.y - p.y), '光标下的数学点应基本不动').toBeLessThan(15);
  });

  test('坐标系锁定后不能平移，解锁后恢复', async ({ arch, page }) => {
    await page.locator('#coord-lock-btn').click();
    expect(await arch.run(e => e.isCoordLocked)).toBe(true);
    const v0 = await view(arch);
    const o = await arch.toScreen(0, 0);
    await page.mouse.move(o.x, o.y); await page.mouse.down(); await page.mouse.move(o.x + 150, o.y, { steps: 8 }); await page.mouse.up();
    await arch.idle();
    expect((await view(arch)).center).toEqual(v0.center);
    await page.locator('#coord-lock-btn').click();
    expect(await arch.run(e => e.isCoordLocked)).toBe(false);
  });

  test('坐标系设置：非等比例轴范围', async ({ arch }) => {
    const v = await arch.run((_e, api) => api.view.set({ axesLocked: false, axisBounds: { x: { min: -5, max: 5 }, y: { min: -2, max: 3 } } }));
    expect(v.axisBounds.x.min).toBeCloseTo(-5, 6);
    expect(v.axisBounds.y.max).toBeCloseTo(3, 6);
    expect(v.axisRatios.x).not.toBeCloseTo(v.axisRatios.y, 3);
  });
});

test.describe('侧栏与布局', () => {
  for (const mode of ['plot', 'geometry', 'statistics', 'code', 'file', 'settings', 'about']) {
    test(`侧栏导航：${mode}`, async ({ arch, page }) => {
      await page.locator(`#nav-btn-${mode}`).click();
      await expect.poll(() => arch.run(e => e.currentUIMode)).toBe(mode);
      await page.locator('#nav-btn-plot').click();
      await expect.poll(() => arch.run(e => e.currentUIMode)).toBe('plot');
    });
  }

  test('收起 / 展开侧栏，画布宽度随之变化', async ({ arch, page }) => {
    const w0 = await arch.run(e => e.sidebar.getBoundingClientRect().right);
    await page.locator('#nav-btn-collapse').click();
    await expect(page.locator('body')).toHaveClass(/sidebar-hidden/);
    await page.locator('#show-sidebar-btn').click();
    await expect(page.locator('body')).not.toHaveClass(/sidebar-hidden/);
    await expect.poll(() => arch.run(e => Math.round(e.sidebar.getBoundingClientRect().right))).toBe(Math.round(w0));
  });

  test('窗口尺寸变化后画布自适应', async ({ arch, page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(() => arch.run(e => e.canvas.clientWidth)).toBe(1000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect.poll(() => arch.run(e => e.canvas.clientWidth)).toBe(1600);
    await arch.add('y=x');
    expect(await arch.value('ok=1')).toBe(1);
  });

  test('深色模式：背景变暗，对象仍可见', async ({ arch, page }) => {
    await arch.add('y=x');
    const light = await arch.pixels();
    await arch.run((_e, api) => api.settings.set('darkMode', true));
    await arch.idle(); await page.waitForTimeout(500);
    const dark = await arch.pixels();
    const lum = (p: any, x: number, y: number) => p.at(x, y).reduce((a: number, b: number) => a + b, 0) / 3;
    const corner = await arch.toScreen(-3, 3.5);
    expect(lum(dark, corner.x, corner.y)).toBeLessThan(lum(light, corner.x, corner.y) - 80);
    await arch.run((_e, api) => api.settings.set('darkMode', false));
  });
});

test.describe('竖屏 / 小屏布局', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('手机竖屏下可以输入并绘图', async ({ arch, page }) => {
    expect(await arch.run(e => e.isPortraitMode)).toBe(true);
    await page.locator('#keyboard-toggle-btn').click();
    await page.keyboard.type('y=x^2');
    await page.keyboard.press('Enter');
    await arch.idle();
    expect((await arch.entries())[0]?.plotType).toBe('y');
  });
});

test.describe('2D 渲染（像素检查）', () => {
  const GREEN: [number, number, number] = [0, 255, 0];
  const green = { h: 33.333, s: 100, b: 100 };

  /** 在曲线上的若干数学点附近查找目标颜色。 */
  async function expectDrawnAt(arch: Arch, ref: string, points: [number, number][]) {
    await arch.style(ref, green, 6);
    const px = await arch.pixels();
    const misses: string[] = [];
    for (const [x, y] of points) {
      const s = await arch.toScreen(x, y);
      const d = px.nearest(s.x, s.y, GREEN, 5);
      if (d > 60) misses.push(`(${x},${y}) 最近颜色距离 ${d}`);
    }
    expect(misses, `${ref} 没有画在预期位置`).toEqual([]);
  }

  test('显函数 y=x^2/2-1', async ({ arch }) => {
    await arch.add('y=x^2/2-1');
    await expectDrawnAt(arch, 'func1', [[-2, 1], [-1, -0.5], [0, -1], [1, -0.5], [2, 1]]);
  });

  test('x=g(y) 型函数', async ({ arch }) => {
    await arch.add('x=y^2-2');
    await expectDrawnAt(arch, 'func1', [[-2, 0], [-1, 1], [-1, -1], [2, 2]]);
  });

  test('隐式曲线 x^2+y^2=4', async ({ arch }) => {
    await arch.add('x^2+y^2=4');
    await expectDrawnAt(arch, 'eq1', [[2, 0], [0, 2], [-2, 0], [0, -2], [Math.SQRT2, Math.SQRT2]]);
  });

  test('不等式区域被填充', async ({ arch }) => {
    await arch.add('x^2+y^2<=1');
    await arch.run(engine => { const e = engine.entries[0]; engine.setStyleParameters(e, { h: 33.333, s: 100, b: 100, a: 0 }); engine.recalculateAll(); engine.requestDraw(); });
    await arch.idle();
    const px = await arch.pixels();
    const inside = await arch.toScreen(0.3, 0.2), outside = await arch.toScreen(2.5, 2.5);
    const [r, g, b] = px.at(inside.x, inside.y);
    expect(g > r + 60 && g > b + 60, `区域内应为绿色，得到 ${[r, g, b]}`).toBe(true);
    const [r2, g2, b2] = px.at(outside.x, outside.y);
    expect(g2 > r2 + 60 && g2 > b2 + 60, '区域外不应被填充').toBe(false);
  });

  test('参数曲线', async ({ arch }) => {
    await arch.add('curve(3*cos(u),2*sin(u),u,0,2*pi)');
    await expectDrawnAt(arch, 'para1', [[3, 0], [0, 2], [-3, 0], [0, -2]]);
  });

  test('点列折线', async ({ arch }) => {
    await arch.add('/-/(-3,-1)(-1,2)(2,-2)');
    await expectDrawnAt(arch, 'plist1', [[-3, -1], [-2, 0.5], [-1, 2], [0.5, 0], [2, -2]]);
  });

  test('隐藏对象后不再绘制', async ({ arch }) => {
    await arch.add('y=x');
    await arch.style('func1', green, 6);
    await arch.run(engine => { engine.entries[0].visible = false; engine.requestDraw(); });
    await arch.idle();
    const px = await arch.pixels();
    const s = await arch.toScreen(1, 1);
    expect(px.nearest(s.x, s.y, GREEN, 4)).toBeGreaterThan(60);
  });

  test('函数断点处不画竖直连线（y=1/x）', async ({ arch }) => {
    await arch.add('y=1/x');
    await arch.style('func1', green, 4);
    const px = await arch.pixels();
    // x=0 附近、y 在 ±1 范围内不应有曲线像素
    const misses: string[] = [];
    for (const y of [-1, -0.5, 0.5, 1]) { const s = await arch.toScreen(0, y); if (px.nearest(s.x, s.y, GREEN, 3) < 60) misses.push(String(y)); }
    expect(misses, '在 x=0 处出现了跨越断点的连线').toEqual([]);
    const s = await arch.toScreen(2, 0.5);
    expect(px.nearest(s.x, s.y, GREEN, 5)).toBeLessThan(60);
  });

  test('几何对象（线段与圆）被绘制', async ({ arch }) => {
    await arch.addAll(['point(A,-3,-2)', 'point(B,-1,2)', 'segment(s,A,B)', 'point(O1,2,0)', 'circle(c,O1,1.5)']);
    for (const n of ['s', 'c']) await arch.style(n, green, 5);
    const px = await arch.pixels();
    for (const [x, y] of [[-2, 0], [3.5, 0], [2, 1.5], [0.5, 0]] as [number, number][]) {
      const s = await arch.toScreen(x, y);
      expect(px.nearest(s.x, s.y, GREEN, 5), `(${x},${y})`).toBeLessThan(60);
    }
  });
});
