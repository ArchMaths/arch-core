/**
 * 全局脚本（QuickJS 沙箱）、自定义 JS 运算符、参数动画与逐帧播放。
 */
import { test, expect, Arch, isolatedArch } from './support/arch';

async function runScript(arch: Arch, code: string) {
  await arch.page.locator('#nav-btn-code').click();
  const toggle = arch.page.locator('#global-script-toggle-btn');
  if (!(await arch.page.locator('#global-script-input').isVisible())) await toggle.click();
  await arch.page.locator('#global-script-input').fill(code);
  await arch.page.locator('#global-script-run-btn').click();
}

test.describe('全局脚本', () => {
  test('通过界面运行脚本：创建对象、修改设置与视图、读写表格', async ({ arch, page }) => {
    await runScript(arch, `
      arch.create("y=x^2");
      arch.create("k=3");
      arch.settings.set("gridStyle", "dots");
      arch.view.set({ center: { x: 1, y: 1 }, unit: 50 });
      arch.table.import([[1, 2], [2, 4]]);
      arch.create("total=" + arch.table.summary("y1").sum);
    `);
    await expect.poll(() => arch.run(e => e.entries.length)).toBe(3);
    await arch.idle();
    expect((await arch.entries()).map(e => e.expr)).toEqual(['y=x^2', 'k=3', 'total=6']);
    expect(await arch.run((_e, api) => api.settings.get('gridStyle'))).toBe('dots');
    expect(await arch.run((_e, api) => api.view.get().unit)).toBeCloseTo(50, 6);
  });

  test('定时器脚本可以被“停止”按钮清理', async ({ arch, page }) => {
    await runScript(arch, `let n = 0; setInterval(() => { n++; arch.create("tick=" + n); }, 100);`);
    await expect.poll(() => arch.run(e => e.entries.find((x: any) => x.name === 'tick')?.value ?? 0)).toBeGreaterThan(2);
    expect(await arch.run(e => e.isGlobalScriptRunning())).toBe(true);
    await page.locator('#global-script-stop-btn').click();
    await expect.poll(() => arch.run(e => e.isGlobalScriptRunning())).toBe(false);
    const v = await arch.run(e => e.entries.find((x: any) => x.name === 'tick').value);
    await page.waitForTimeout(600);
    expect(await arch.run(e => e.entries.find((x: any) => x.name === 'tick').value), '停止后不应继续计时').toBe(v);
  });

  test('脚本抛出异常、语法错误、死循环都不会让页面崩溃', async ({ arch, page }) => {
    for (const code of ['throw new Error("boom")', 'this is not js', 'arch.settings.set("nope", 1)', 'arch.view.set({unit:-1})', 'while(true){}']) {
      await runScript(arch, code);
      await page.waitForTimeout(code.startsWith('while') ? 3000 : 400);
      await page.locator('#global-script-stop-btn').click().catch(() => {});
    }
    await page.locator('#nav-btn-plot').click();
    expect(await arch.value('alive=1+2')).toBe(3);
  });

  test('沙箱隔离：脚本无法访问页面 window / document / 网络', async ({ arch, page }) => {
    await runScript(arch, `
      try { window.__pwned = 1; } catch (e) {}
      try { globalThis.__pwned = 1; } catch (e) {}
      try { document.body.insertAdjacentHTML("beforeend", '<img src=x onerror="window.__pwned=1">'); } catch (e) {}
      try { const d = document.createElement("div"); d.innerHTML = '<img src=x onerror="window.__pwned=1">'; document.body.appendChild(d); } catch (e) {}
      try { const s = document.createElement("script"); s.textContent = "window.__pwned=1"; document.body.appendChild(s); } catch (e) {}
      try { const f = document.createElement("iframe"); f.src = "javascript:parent.__pwned=1"; document.body.appendChild(f); } catch (e) {}
      try { fetch("https://example.com"); } catch (e) {}
      try { (function(){ return this })().__pwned = 1; } catch (e) {}
      try { Function("return window")().__pwned = 1; } catch (e) {}
      arch.create("done=1");
    `);
    await expect.poll(() => arch.run(e => e.entries.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    await expect(page.locator('#plot-canvas')).toBeVisible();
    expect(arch.blockedRequests.some(u => u.includes('example.com')), '脚本不应能发起网络请求').toBe(false);
  });
});

test.describe('自定义 JS 运算符', () => {
  test('定义并调用 JS 运算符，可用于绘图与求值', async ({ arch }) => {
    const [def] = await arch.add('dbl(u)={return u*2}');
    expect(def.type).toBe('advanced_custom_function_definition');
    expect(await arch.value('v=dbl(21)')).toBe(42);
    const [f] = await arch.add('y=dbl(x)+1');
    expect(f.type).toBe('function');
    expect(await arch.evalPlot('func1', 3)).toBe(7);
  });

  test('JS 运算符里的循环与 Math 函数', async ({ arch }) => {
    await arch.add('harm(n)={let s=0;for(let i=1;i<=n;i++){s+=1/i}return s}');
    expect(await arch.value('h=harm(4)')).toBeCloseTo(1 + 1 / 2 + 1 / 3 + 1 / 4, 12);
    await arch.add('hyp(a,b)={return Math.hypot(a,b)}');
    expect(await arch.value('hv=hyp(3,4)')).toBe(5);
  });

  test('JS 运算符无法逃逸沙箱', async ({ arch, page }) => {
    await arch.add('evil(u)={window.__pwned=1;globalThis.__pwned=1;return u}');
    await arch.add('ev=evil(1)');
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  });

  test('已知缺陷：调用含死循环的 JS 运算符后页面仍可响应', async ({ playwright, browserName }, testInfo) => {
    test.fail(true, 'BUG-10：自定义 JS 运算符没有执行时间上限，死循环会永久卡死页面（存档可携带运算符）');
    const { arch, close } = await isolatedArch(playwright[browserName], browserName, testInfo);
    try {
      expect(await arch.addAndCheckResponsive('spin(u)={while(true){}return u}', 10_000), '定义后').toBe(true);
      expect(await arch.addAndCheckResponsive('sv=spin(1)', 10_000), '调用后').toBe(true);
    } finally { await close(); }
  });

  test('删除运算符时依赖它的条目一并删除', async ({ arch }) => {
    await arch.addAll(['tri(u)={return u*3}', 'w=tri(2)']);
    expect((await arch.entry('w')).value).toBe(6);
    await arch.run(e => { const i = e.entries.findIndex((x: any) => x.name === 'tri'); e._handleCascadingDelete(i); });
    await arch.idle();
    expect(await arch.entries()).toEqual([]);
  });
});

test.describe('动画', () => {
  test('变量滑杆播放：值随时间变化，暂停后停止', async ({ arch }) => {
    await arch.addAll(['p=0', 'y=sin(x+p)']);
    await arch.run(engine => { const e = engine.entries[0]; e.min = 0; e.max = 10; e.step = 0.05; e.playMode = 1; e.playState = 1; engine.updateGlobalPlayState(); engine.requestDraw(); });
    await expect.poll(() => arch.run(e => e.entries[0].value), { timeout: 10_000 }).toBeGreaterThan(0.2);
    await arch.run(engine => { engine.entries[0].playState = 0; engine.updateGlobalPlayState(); });
    const v = await arch.run(e => e.entries[0].value);
    await arch.page.waitForTimeout(500);
    expect(await arch.run(e => e.entries[0].value)).toBe(v);
  });

  test('五种播放模式都不越界', async ({ arch }) => {
    for (let mode = 0; mode <= 4; mode++) {
      await arch.run((e, _a, mode) => e.addEntry(`m${mode}=0.5`), mode); // 播放中引擎持续重算，不等待空闲
      await arch.run((engine, _a, mode) => { const e = engine.entries[engine.entries.length - 1]; e.min = 0; e.max = 1; e.step = 0.2; e.playMode = mode; e.playState = 1; engine.updateGlobalPlayState(); }, mode);
    }
    await arch.page.waitForTimeout(2500);
    const vals = await arch.run(e => e.entries.map((x: any) => x.value));
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0 - 1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9); }
    await arch.run(engine => { engine.entries.forEach((e: any) => (e.playState = 0)); engine.updateGlobalPlayState(); });
  });

  test('圆上点播放，依赖它的度量同步变化', async ({ arch }) => {
    await arch.addAll(['point(O1,0,0)', 'circle(c,O1,2)', 'point(P,c,0)', 'point(Q,2,0)', 'length(d,P,Q)']);
    await arch.run(engine => { const p = engine.entries.find((e: any) => e.name === 'P'); p.playState = 1; p.playMode = 1; p.step = 0.01; engine.updateGlobalPlayState(); });
    await expect.poll(() => arch.run(e => e.entries.find((x: any) => x.name === 'd').value), { timeout: 10_000 }).toBeGreaterThan(0.1);
    const p = await arch.entry('P');
    expect(Math.hypot(p.x!, p.y!)).toBeCloseTo(2, 6);
    await arch.run(engine => { engine.entries.forEach((e: any) => (e.playState = 0)); engine.updateGlobalPlayState(); });
  });

  test('动画进行中添加、删除、撤销对象不崩溃', async ({ arch }) => {
    await arch.addAll(['p=0', 'y=sin(x+p)', 'x^2+y^2=1+p/10']);
    await arch.run(engine => { const e = engine.entries[0]; e.min = 0; e.max = 6; e.step = 0.1; e.playMode = 0; e.playState = 1; engine.updateGlobalPlayState(); });
    for (let i = 0; i < 10; i++) {
      await arch.run((e, _a, i) => e.addEntry(`y=x*${i}+p`), i); // 播放中引擎持续重算，不等待空闲
      await arch.page.waitForTimeout(100);
      if (i % 3 === 0) await arch.run(e => e.undo());
    }
    await arch.run(engine => { engine.entries.forEach((e: any) => (e.playState = 0)); engine.updateGlobalPlayState(); });
    await arch.idle();
    expect(await arch.value('alive=2')).toBe(2);
  });
});
