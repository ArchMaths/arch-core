/**
 * 几何构造：28 个几何关键字、对象上点、依赖更新与级联删除，以及几何工具面板的鼠标交互。
 * 期望值大多来自页面内嵌手册（manual_geometry 10.6/10.7/10.8 的“可核对示例”）。
 */
import { test, expect, expectClose } from './support/arch';

const pt = async (arch: any, name: string) => { const e = await arch.entry(name); return [e.x, e.y] as [number, number]; };
const expectPoint = async (arch: any, name: string, x: number, y: number, tol = 1e-6) => {
  const e = await arch.entry(name);
  expect(e.meaningful, `${name} 应有意义`).toBe(true);
  expectClose(e.x, x, `${name}.x`, tol);
  expectClose(e.y, y, `${name}.y`, tol);
};

test.describe('几何命令', () => {
  test('点的变换：rotate / reflect / translate / midpoint（手册 10.8 示例）', async ({ arch }) => {
    await arch.addAll(['point(O1,0,0)', 'point(A,2,0)', 'point(B,2,1)', 'vector(v,O1,B)', 'rotate(R,O1,A,90)', 'reflect(S,Yaxis,A)', 'translate(T,v,A)', 'translate(U,A,1,-2)', 'midpoint(M,A,B)']);
    await expectPoint(arch, 'R', 0, 2);
    await expectPoint(arch, 'S', -2, 0);
    await expectPoint(arch, 'T', 4, 1);
    await expectPoint(arch, 'U', 3, -2);
    await expectPoint(arch, 'M', 2, 0.5);
  });

  test('线与圆的交点：±1 选根（手册 10.6 示例）', async ({ arch }) => {
    await arch.addAll(['point(P1,-3,0)', 'point(P2,3,0)', 'point(O1,0,0)', 'line(LineAB,P1,P2)', 'line(LineBA,P2,P1)', 'circle(Ring,O1,2)',
      'intersect(X1,LineAB,Ring,1)', 'intersect(X2,LineAB,Ring,-1)', 'intersect(X3,LineBA,Ring,1)', 'intersect(X4,Ring,LineAB,1)']);
    await expectPoint(arch, 'X1', 2, 0);
    await expectPoint(arch, 'X2', -2, 0);
    await expectPoint(arch, 'X3', -2, 0); // 反向定义直线后 1 选另一支
    await expectPoint(arch, 'X4', 2, 0); // 交换参数位置不改变选择
  });

  test('圆与圆的交点：±1 选根（手册 10.6 示例）', async ({ arch }) => {
    await arch.addAll(['point(C1,0,0)', 'point(C2,2,0)', 'circle(Cfirst,C1,2)', 'circle(Csecond,C2,2)', 'intersect(Y1,Cfirst,Csecond,1)', 'intersect(Y2,Cfirst,Csecond,-1)', 'intersect(Y3,Csecond,Cfirst,1)']);
    await expectPoint(arch, 'Y1', 1, -Math.sqrt(3));
    await expectPoint(arch, 'Y2', 1, Math.sqrt(3));
    await expectPoint(arch, 'Y3', 1, Math.sqrt(3));
  });

  test('数学对象与几何对象的数值求交', async ({ arch }) => {
    await arch.addAll(['y=x^2', 'y=x+2', 'intersect(P,func1,func2,2,4)', 'intersect(Q,func1,func2,-1,1)', 'x^2+y^2=25', 'point(O1,0,0)', 'point(Z,7,7)', 'line(diag,O1,Z)', 'intersect(R,eq1,diag,3,3)']);
    await expectPoint(arch, 'P', 2, 4, 1e-5);
    await expectPoint(arch, 'Q', -1, 1, 1e-5);
    await expectPoint(arch, 'R', 5 / Math.SQRT2, 5 / Math.SQRT2, 1e-4);
  });

  test('切线：圆的两条切线（手册 10.7 示例）', async ({ arch }) => {
    await arch.addAll(['point(O1,0,0)', 'circle(Ring,O1,2)', 'point(Q,4,0)', 'tangent(T1,Ring,Q,1)', 'tangent(T2,Ring,Q,-1)']);
    const slope = (d: any) => d.dir.y / d.dir.x;
    const dirs = await arch.run(engine => ['T1', 'T2'].map(n => engine.entries.find((e: any) => e.name === n)).map((e: any) => ({ dir: e.dir, ok: e.isMeaningful })));
    expect(dirs.every((d: any) => d.ok)).toBe(true);
    expectClose(slope(dirs[0]), 1 / Math.sqrt(3), 'T1 斜率');
    expectClose(slope(dirs[1]), -1 / Math.sqrt(3), 'T2 斜率');
  });

  test('函数图像的切线经过指定点且斜率正确', async ({ arch }) => {
    await arch.addAll(['y=x^2', 'point(P,func1,1)', 'tangent(T,func1,P)']);
    const d = await arch.run(engine => engine.entries.find((e: any) => e.name === 'T').dir);
    expectClose(d.y / d.x, 2, '切线斜率', 1e-4);
  });

  test('度量与判定：length / angle / area / isparallel / isperpendicular / isconcyclic', async ({ arch }) => {
    await arch.addAll(['point(A,0,0)', 'point(B,3,0)', 'point(C,3,4)', 'point(D,0,4)', 'length(lAC,A,C)', 'angle(ang,B,A,D)', 'area(ar,4,A,B,C,D)',
      'line(l1,A,B)', 'line(l2,D,C)', 'line(l3,B,C)', 'isparallel(chk1,l1,l2)', 'isperpendicular(chk2,l1,l3)', 'isparallel(chk3,l1,l3)', 'isconcyclic(chk4,A,B,C,D)']);
    expect((await arch.entry('lAC')).value).toBe(5);
    expectClose((await arch.entry('ang')).value, 90);
    expectClose((await arch.entry('ar')).value, 12);
    expect((await arch.entry('chk1')).value).toBe(1);
    expect((await arch.entry('chk2')).value).toBe(1);
    expect((await arch.entry('chk3')).value).toBe(0);
    expect((await arch.entry('chk4')).value).toBe(1); // 矩形四点共圆
  });

  test('圆锥曲线：参数正确', async ({ arch }) => {
    await arch.addAll(['ellipse(e1,3,2)', 'point(F1,-1,0)', 'point(F2,1,0)', 'point(E3,0,2)', 'ellipse(e2,F1,F2,E3)', 'point(H,2,1)', 'hyperbola(h1,F1,F2,H)',
      'point(Fo,0,1)', 'point(L1,-1,-1)', 'point(L2,1,-1)', 'line(dir,L1,L2)', 'parabola(pb,Fo,dir)', 'point(O1,0,0)', 'point(Pc,3,4)', 'circle(c1,O1,Pc)']);
    const g = await arch.run(engine => Object.fromEntries(engine.entries.filter((e: any) => e.type === 'geometry').map((e: any) => [e.name, { a: e.a, b: e.b, r: e.radius, p: e.p, vertex: e.vertex, ok: e.isMeaningful }])));
    expect([g.e1.a, g.e1.b]).toEqual([3, 2]);
    expectClose(g.e2.a, Math.sqrt(5), 'e2.a'); expectClose(g.e2.b, 2, 'e2.b');
    expectClose(g.h1.a, (Math.sqrt(10) - Math.sqrt(2)) / 2, 'h1.a'); // |HF1-HF2|/2
    expect(g.c1.r).toBe(5);
    expect(g.pb.ok).toBe(true);
    expectClose(g.pb.vertex.x, 0, 'parabola vertex x'); expectClose(g.pb.vertex.y, 0, 'parabola vertex y');
  });

  test('正多边形 polyeq 自动补建顶点，改边数后同步', async ({ arch }) => {
    await arch.addAll(['point(A,0,0)', 'point(B,1,0)', 'polyeq(hex,A,B,6)']);
    let pts = (await arch.entries()).filter(e => e.geometryType === 'point');
    expect(pts).toHaveLength(6);
    await expectPoint(arch, 'C', 1.5, Math.sqrt(3) / 2);
    await arch.add('polyeq(hex,A,B,4)');
    pts = (await arch.entries()).filter(e => e.geometryType === 'point');
    expect(pts).toHaveLength(4);
  });

  test('对象上点：圆 / 线段 / 函数 / 隐式方程 / 参数曲线 / 点列 / 坐标轴', async ({ arch }) => {
    await arch.addAll(['point(O1,1,1)', 'circle(Ring,O1,2)', 'point(OnC,Ring,0.25)', 'point(A,0,0)', 'point(B,4,2)', 'segment(sg,A,B)', 'point(OnS,sg,0.5)',
      'y=x^2', 'point(OnF,func1,1.5)', 'x^2+y^2=9', 'point(OnE,eq1,0)', 'curve(cos(u),sin(u),u,0,2*pi)', 'point(OnP,para1,pi)',
      '/-/(0,0)(1,2)(3,1)', 'point(OnL,plist1,2)', 'point(OnX,Xaxis,7)']);
    await expectPoint(arch, 'OnC', 1, 3);
    await expectPoint(arch, 'OnS', 2, 1);
    await expectPoint(arch, 'OnF', 1.5, 2.25);
    await expectPoint(arch, 'OnE', 3, 0, 1e-6);
    await expectPoint(arch, 'OnP', -1, 0, 1e-9);
    await expectPoint(arch, 'OnL', 1, 2);
    await expectPoint(arch, 'OnX', 7, 0);
  });

  test('fitline 与 circulararc', async ({ arch }) => {
    await arch.addAll(['point(A,0,1)', 'point(B,1,3)', 'point(C,2,5)', 'fitline(fl,3,A,B,C)', 'point(O1,0,0)', 'point(S,2,0)', 'point(E,0,5)', 'circulararc(arc,O1,S,E)']);
    const r = await arch.run(engine => { const f = engine.entries.find((e: any) => e.name === 'fl'); const a = engine.entries.find((e: any) => e.name === 'arc'); return { dir: f.dir, r: a.radius, s: a.startAngle, e: a.endAngle }; });
    expectClose(r.dir.y / r.dir.x, 2, '拟合直线斜率');
    expect(r.r).toBe(2);
    expectClose(r.e - r.s, Math.PI / 2, '圆弧张角');
  });

  test('依赖更新：移动自由点后所有下游对象同步', async ({ arch }) => {
    await arch.addAll(['point(A,0,0)', 'point(B,4,0)', 'midpoint(M,A,B)', 'length(len,A,B)', 'circle(c,A,B)', 'point(OnC,c,0.25)', 'segment(s,A,B)', 'point(OnS,s,0.25)']);
    await arch.add('point(B,0,6)');
    await expectPoint(arch, 'M', 0, 3);
    expect((await arch.entry('len')).value).toBe(6);
    await expectPoint(arch, 'OnC', 0, 6);
    await expectPoint(arch, 'OnS', 0, 1.5);
  });

  test('点坐标可依赖变量，变量改变时点移动', async ({ arch }) => {
    await arch.addAll(['k=1', 'point(P,cos(k),sin(k))', 'point(O1,0,0)', 'length(r,O1,P)']);
    await arch.add('k=2');
    await expectPoint(arch, 'P', Math.cos(2), Math.sin(2));
    expectClose((await arch.entry('r')).value, 1);
  });

  test('级联删除：删除依赖源时连带删除下游对象，撤销后全部恢复', async ({ arch }) => {
    await arch.addAll(['point(A,0,0)', 'point(B,1,0)', 'point(C,5,5)', 'segment(s,A,B)', 'midpoint(M,A,B)', 'length(len,A,B)', 'circle(c,A,1)']);
    const before = (await arch.entries()).length;
    await arch.run(engine => engine.deleteEntryByIndex(engine.entries.findIndex((e: any) => e.name === 'A') + 1) /* 序号从 1 开始 */);
    await arch.idle();
    const names = (await arch.entries()).map(e => e.name);
    expect(names).toEqual(['B', 'C']);
    await arch.run(engine => engine.undo());
    await arch.idle();
    expect((await arch.entries()).length).toBe(before);
    expect((await arch.entry('len')).value).toBe(1);
  });

  test('退化构造被标记为无意义而不是崩溃', async ({ arch }) => {
    await arch.addAll(['point(A,1,1)', 'point(B,1,1)', 'line(l,A,B)', 'point(C,0,0)', 'point(D,5,0)', 'point(E,0,1)', 'point(F,5,1)', 'line(l1,C,D)', 'line(l2,E,F)', 'intersect(P,l1,l2)']);
    expect((await arch.entry('l')).meaningful).toBe(false);
    expect((await arch.entry('P')).meaningful).toBe(false);
  });

  test('几何对象名称与数学变量互不干扰（手册 1.3）', async ({ arch }) => {
    await arch.addAll(['point(A,1,2)', 'a=5', 'y=a*x']);
    expect((await arch.entry('a')).value).toBe(5);
    expect((await arch.entry('A')).x).toBe(1);
  });

  test('已知缺陷：焦点式椭圆/双曲线的方程文字缺少常数项', async ({ arch }) => {
    test.fail(true, 'BUG-1：formatConicEquation 在常数项为 ±1 时把数字省略，显示 “0.200x² + 0.250y² - = 0”');
    await arch.addAll(['point(F1,-1,0)', 'point(F2,1,0)', 'point(E3,0,2)', 'ellipse(e2,F1,F2,E3)']);
    expect((await arch.entry('e2')).details).not.toMatch(/- = 0|\+ = 0/);
  });
});

test.describe('几何工具（鼠标交互）', () => {
  test.beforeEach(async ({ arch, page }) => {
    await page.locator('#nav-btn-geometry').click();
    await expect(page.locator('.geo-btn[data-geo-type="point"]')).toBeVisible();
  });

  const click = async (arch: any, x: number, y: number) => { const s = await arch.toScreen(x, y); await arch.page.mouse.click(s.x, s.y); await arch.page.waitForTimeout(150); };

  test('点工具：在画布点击创建点，坐标与点击位置一致', async ({ arch, page }) => {
    await page.locator('.geo-btn[data-geo-type="point"]').click();
    await click(arch, 1, 1);
    await click(arch, -2, 3);
    const pts = (await arch.entries()).filter(e => e.geometryType === 'point');
    expect(pts.map(p => [Math.round(p.x! * 10) / 10, Math.round(p.y! * 10) / 10])).toEqual([[1, 1], [-2, 3]]);
  });

  test('线段工具：点击空白处会自动建点，点击已有点会复用', async ({ arch, page }) => {
    await arch.add('point(A,1,1)');
    await page.locator('.geo-btn[data-geo-type="segment"]').click();
    await click(arch, 1, 1);
    await click(arch, 3, 2);
    const all = await arch.entries();
    const seg = all.find(e => e.geometryType === 'segment');
    expect(seg?.expr).toMatch(/^segment\(\w+,A,\w+\)$/);
    expect(all.filter(e => e.geometryType === 'point')).toHaveLength(2);
  });

  test('圆（圆心与半径）工具：通过对话框输入半径', async ({ arch, page }) => {
    arch.dialogHandler = () => '1.5';
    await page.locator('.geo-btn[data-geo-type="circle_cr"]').click();
    await click(arch, 0, 0);
    await arch.idle();
    const c = (await arch.entries()).find(e => e.geometryType === 'circle');
    expect(c?.radius).toBe(1.5);
  });

  test('中点、交点、垂线、平行线工具', async ({ arch, page }) => {
    await arch.addAll(['point(A,-2,0)', 'point(B,2,0)', 'point(C,0,-2)', 'point(D,0,2)', 'line(l1,A,B)', 'line(l2,C,D)', 'point(P,1,1)']);
    for (const [tool, picks] of [['midpoint', [[-2, 0], [2, 0]]], ['intersect', [[-1.5, 0], [0, 1.5]]], ['perpendicularline', [[1.6, 0], [1, 1]]], ['parallelline', [[1.6, 0], [1, 1]]]] as const) {
      await page.locator(`.geo-btn[data-geo-type="${tool}"]`).click();
      for (const [x, y] of picks) await click(arch, x, y);
      await arch.idle();
    }
    const types = (await arch.entries()).map(e => e.geometryType);
    expect(types).toEqual(expect.arrayContaining(['midpoint', 'intersect', 'perpendicularline', 'parallelline']));
    const mid = (await arch.entries()).find(e => e.geometryType === 'midpoint')!;
    expect([mid.x, mid.y]).toEqual([0, 0]);
    const ix = (await arch.entries()).find(e => e.geometryType === 'intersect')!;
    expectClose(ix.x, 0); expectClose(ix.y, 0);
  });

  test('Esc 取消正在进行的构造，不留下半成品', async ({ arch, page }) => {
    await page.locator('.geo-btn[data-geo-type="segment"]').click();
    await click(arch, 1, 1);
    await page.keyboard.press('Escape');
    await page.locator('#nav-btn-plot').click();
    await click(arch, 3, 3);
    expect((await arch.entries()).filter(e => e.geometryType === 'segment')).toHaveLength(0);
  });

  test('鼠标拖动自由点，依赖对象随之更新', async ({ arch, page }) => {
    await page.locator('#nav-btn-plot').click();
    await arch.addAll(['point(A,1,1)', 'point(B,3,2)', 'length(len,A,B)', 'midpoint(M,A,B)']);
    const s = await arch.toScreen(1, 1), t = await arch.toScreen(3, -2);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x + 5, s.y + 5, { steps: 3 });
    await page.mouse.move(t.x, t.y, { steps: 10 });
    await page.mouse.up();
    await arch.idle();
    const a = await pt(arch, 'A');
    expect(a[0]).toBeCloseTo(3, 1);
    expect(a[1]).toBeCloseTo(-2, 1);
    expect((await arch.entry('len')).value).toBeCloseTo(4, 1);
    const m = await pt(arch, 'M');
    expect(m[0]).toBeCloseTo(3, 1);
  });

  test('已知缺陷：拖动点后撤销只撤销拖动', async ({ arch, page }) => {
    test.fail(true, 'BUG-2：拖动几何点不入撤销栈，撤销会把上一步操作一起撤掉');
    await page.locator('#nav-btn-plot').click();
    await arch.addAll(['point(A,1,1)', 'y=x']);
    const s = await arch.toScreen(1, 1), t = await arch.toScreen(-2, 3);
    await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.move(t.x, t.y, { steps: 10 }); await page.mouse.up();
    await arch.idle();
    await page.locator('#undo-btn-sidebar').click();
    await arch.idle();
    expect((await arch.entries()).map(e => e.expr)).toEqual(['point(A,1,1)', 'y=x']);
  });
});
