/**
 * 统计表格：导入/导出、单元格公式、描述统计（总体方差）、五种回归、排序联动、列增删，以及表格界面操作。
 */
import { test, expect, expectClose } from './support/arch';

const T = (arch: any, fn: (t: any, arg: any) => any, arg?: any) => arch.run((_e: any, api: any, a: any) => new Function('t', 'arg', `return (${a.fn})(t, arg)`)(api.table, a.arg), { fn: fn.toString(), arg });

test.describe('统计表格（接口）', () => {
  test('导入数据、读取计算值、描述统计', async ({ arch }) => {
    await T(arch, t => t.import([[1, 3], [2, 5], [3, 7], [4, 9]]));
    const v = await T(arch, t => t.values());
    expect(v.values.slice(0, 4)).toEqual([[1, 3], [2, 5], [3, 7], [4, 9]]);
    const s = await T(arch, t => t.summary('y1'));
    expect(s).toMatchObject({ n: 4, sum: 24, sumSquares: 164, mean: 6, variance: 5, meanAbsoluteDeviation: 2, max: 9, min: 3, median: 6, modes: [] });
    expectClose(s.standardDeviation, Math.sqrt(5));
  });

  test('众数、偶数个数的中位数、空值与错误单元格不计入', async ({ arch }) => {
    await T(arch, t => t.import([[1, 2], [2, 2], [3, 5], [4, 7], [5, 'sqrt(-1)'], [6, null]]));
    const s = await T(arch, t => t.summary('y1'));
    expect(s.n).toBe(4);
    expect(s.modes).toEqual([2]);
    expect(s.median).toBe(3.5);
    const v = await T(arch, t => t.values());
    expect(v.errors[4][1], '非有限值应报告错误').toBeTruthy();
  });

  test('单元格公式：x 表示同一行的 x 值，可引用全局变量', async ({ arch }) => {
    await arch.add('k=10');
    await T(arch, t => t.import([[1, '2*x+1'], [2, '2*x+1'], [3, 'x^2+k']]));
    const v = await T(arch, t => t.values());
    expect(v.values.slice(0, 3).map((r: number[]) => r[1])).toEqual([3, 5, 19]);
    await arch.add('k=20');
    const v2 = await T(arch, t => t.values());
    expect(v2.values[2][1], '全局变量变化后表格重算').toBe(29);
  });

  const REG: [string, number[][], number[]][] = [
    ['linear', [[1, 3], [2, 5], [3, 7], [4, 9]], [1, 2]],
    ['quadratic', [[0, 1], [1, 2], [2, 5], [3, 10]], [1, 0, 1]],
    ['exponential', [[0, 2], [1, 2 * Math.E], [2, 2 * Math.E ** 2]], [2, 1]],
    ['logarithmic', [[1, 3], [Math.E, 5], [Math.E ** 2, 7]], [3, 2]],
    ['reciprocal', [[1, 5], [2, 3], [4, 2]], [1, 4]],
  ];
  for (const [type, data, coef] of REG) {
    test(`回归：${type}`, async ({ arch }) => {
      await T(arch, (t, d) => t.import(d), data);
      const r = await T(arch, (t, ty) => t.addRegression('y1', ty), type);
      expect(r.result.error).toBeFalsy();
      r.result.coefficients.forEach((c: number, i: number) => expectClose(c, coef[i], `${type} 系数 ${i}`, 1e-6));
      expectClose(r.result.r2, 1, 'R²', 1e-9);
      // 回归曲线作为绘图对象出现
      const curve = await arch.entry(r.reference);
      expect(curve.type).toBe('function');
    });
  }

  test('回归数据不足时报告错误而不是崩溃', async ({ arch }) => {
    await T(arch, t => t.import([[1, 1]]));
    const r = await T(arch, t => t.addRegression('y1', 'quadratic'));
    expect(r.result.error).toBeTruthy();
  });

  test('修改数据后回归自动重算；修改/删除回归', async ({ arch }) => {
    await T(arch, t => t.import([[1, 3], [2, 5], [3, 7], [4, 9]]));
    const r = await T(arch, t => t.addRegression('y1', 'linear'));
    await T(arch, t => t.cell(1, 'y1', '2*x+10'));
    const [lin] = await T(arch, t => t.regressions());
    expectClose(lin.result.coefficients[0], 10); expectClose(lin.result.coefficients[1], -0.7);
    const upd = await T(arch, (t, id) => t.updateRegression(id, { type: 'quadratic' }), r.id);
    expect(upd.type).toBe('quadratic');
    expect(upd.id).toBe(r.id);
    await T(arch, (t, id) => t.removeRegression(id), r.id);
    expect(await T(arch, t => t.regressions())).toEqual([]);
    expect((await arch.entries()).filter(e => e.type === 'function')).toHaveLength(0);
  });

  test('排序：联动保持行配对，不联动只排一列', async ({ arch }) => {
    await T(arch, t => t.import([[1, 30], [2, 10], [3, 20]]));
    await T(arch, t => t.sort('y1', 'asc', { sortLinked: true }));
    expect((await T(arch, t => t.values())).values.slice(0, 3)).toEqual([[2, 10], [3, 20], [1, 30]]);
    await T(arch, t => t.sort('x', 'asc', { sortLinked: false }));
    expect((await T(arch, t => t.values())).values.slice(0, 3)).toEqual([[1, 10], [2, 20], [3, 30]]);
  });

  test('增删列、追加行、清空列', async ({ arch }) => {
    await T(arch, t => t.import([[1, 2], [3, 4]]));
    await T(arch, t => t.addColumn());
    let g = await T(arch, t => t.get());
    expect(g.columns.map((c: any) => c.id)).toEqual(['x', 'y1', 'y2']);
    await T(arch, t => t.appendRows([[5, 6, 7]]));
    g = await T(arch, t => t.values());
    expect(g.values[2]).toEqual([5, 6, 7]);
    await T(arch, t => t.clearColumn('y1'));
    expect((await T(arch, t => t.values())).values.slice(0, 3).map((r: any) => r[1])).toEqual([null, null, null]);
    await T(arch, t => t.deleteColumn('y2'));
    expect((await T(arch, t => t.get())).columns.map((c: any) => c.id)).toEqual(['x', 'y1']);
  });

  test('CSV 导出再导入，数据不变', async ({ arch }) => {
    await T(arch, t => t.import([[1, '2*x'], [2.5, -3], [1e-3, 4]]));
    const csv = await T(arch, t => t.export('csv'));
    await T(arch, t => t.import([[0, 0]]));
    await T(arch, (t, c) => t.import(c, { format: 'csv' }), csv);
    expect((await T(arch, t => t.values())).values.slice(0, 3)).toEqual([[1, 2], [2.5, -3], [0.001, 4]]);
  });

  test('带表头的 CSV / TSV 导入', async ({ arch }) => {
    await T(arch, t => t.import('x,y1\n1,2\n3,4\n', { format: 'csv', header: true }));
    expect((await T(arch, t => t.values())).values.slice(0, 2)).toEqual([[1, 2], [3, 4]]);
    await T(arch, t => t.import('x\ty1\n5\t6\n', { format: 'tsv', header: true }));
    expect((await T(arch, t => t.values())).values[0]).toEqual([5, 6]);
  });

  test('非法参数被拒绝', async ({ arch }) => {
    for (const bad of [() => 't.addRegression("y1","cubic")', () => 't.sort("nope")', () => 't.cell(0,"x",1)', () => 't.import(42)']) {
      const msg = await arch.run((_e, api, code) => { const t = api.table; try { new Function('t', code)(t); return null; } catch (e: any) { return String(e.message); } }, bad());
      expect(msg, bad()).toBeTruthy();
    }
  });

  test('统计数据随存档保存和恢复', async ({ arch }) => {
    await T(arch, t => t.import([[1, 3], [2, 5], [3, 7]]));
    await T(arch, t => t.addRegression('y1', 'linear'));
    const state = await arch.run(e => JSON.stringify(e.exportStateObject()));
    await arch.run(e => e.createNewProject());
    await arch.idle();
    expect((await T(arch, t => t.values())).values[0].every((v: any) => v === null), '新建项目后表格为空').toBe(true);
    await arch.run((e, _a, s) => e.loadState(s), state);
    await arch.idle();
    expect((await T(arch, t => t.values())).values.slice(0, 3)).toEqual([[1, 3], [2, 5], [3, 7]]);
    expect(await T(arch, t => t.regressions().length)).toBe(1);
  });
});

test.describe('统计表格（界面）', () => {
  test('打开统计页，点击单元格输入数据，图上出现散点', async ({ arch, page }) => {
    await page.locator('#nav-btn-statistics').click();
    await expect(page.locator('#statistics-add-column')).toBeVisible();
    await arch.run((_e, api) => api.ui.tableCell(1, 'x'));
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await arch.run((_e, api) => api.ui.tableCell(1, 'y1'));
    await page.keyboard.type('x*3');
    await page.keyboard.press('Enter');
    await arch.idle();
    const v = await arch.run((_e, api) => api.table.values().values[0]);
    expect(v.slice(0, 2)).toEqual([2, 6]);
  });

  test('“+”按钮添加一列', async ({ arch, page }) => {
    await page.locator('#nav-btn-statistics').click();
    const before = await arch.run((_e, api) => api.table.get().columns.length);
    await page.locator('#statistics-add-column').click();
    expect(await arch.run((_e, api) => api.table.get().columns.length)).toBe(before + 1);
  });
});
