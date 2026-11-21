/**
 * 数值正确性：内置函数、特殊函数、高级算子、依赖传播。
 * 期望值来自数学定义或页面内嵌手册给出的确切示例。所有数值都通过“新建变量”这一用户路径得到。
 */
import { test, expect, expectClose } from './support/arch';

const E = Math.E, PI = Math.PI;

/** [表达式, 期望值, 容差] —— 每行单独作为变量 v=表达式 输入。 */
const VALUES: [string, number, number?][] = [
  // 算术与优先级
  ['1+2*3', 7], ['(1+2)*3', 9], ['2^10', 1024], ['2^(-3)', 0.125], ['(-2)^2', 4], ['2^(3^2)', 512], ['(2^3)^2', 64],
  ['7%3', 1], ['-5%2', -1], ['10/4', 2.5], ['2(3+1)', 8], ['2pi', 2 * PI], ['2**3', 8],
  ['(-8)^(1/3)', -2, 1e-9], ['cbrt(-27)', -3], ['sqrt(2)', Math.SQRT2], ['10^(-3)', 0.001],
  // 常量
  ['pi', PI], ['e', E], ['π', PI],
  // 初等函数（弧度）
  ['sin(pi/6)', 0.5, 1e-12], ['cos(0)', 1], ['tan(pi/4)', 1, 1e-12], ['sin(90*pi/180)', 1, 1e-12],
  ['asin(1)', PI / 2], ['acos(0)', PI / 2], ['atan(1)', PI / 4],
  ['cot(pi/4)', 1, 1e-12], ['sec(0)', 1], ['csc(pi/2)', 1],
  ['acot(1)', PI / 4, 1e-9], ['asec(2)', PI / 3, 1e-9], ['acsc(2)', PI / 6, 1e-9],
  ['sinh(1)', Math.sinh(1)], ['cosh(1)', Math.cosh(1)], ['tanh(1)', Math.tanh(1)],
  ['asinh(1)', Math.asinh(1)], ['acosh(2)', Math.acosh(2)], ['atanh(0.5)', Math.atanh(0.5)],
  ['coth(1)', 1 / Math.tanh(1)], ['sech(1)', 1 / Math.cosh(1)], ['csch(1)', 1 / Math.sinh(1)],
  ['ln(e^2)', 2, 1e-12], ['exp(1)', E], ['ln(1000)/ln(10)', 3, 1e-12],
  ['abs(-3.5)', 3.5], ['floor(-1.5)', -2], ['ceil(-1.5)', -1], ['round(2.5)', 3], ['round(-1.5)', -1],
  ['min(3,-2)', -2], ['max(3,-2)', 3], ['pow(2,5)', 32], ['sign(-4)', -1], ['sgn(0)', 0], ['heaviside(0)', 0], ['heaviside(2)', 1],
  // 条件与逻辑
  ['(3>2?10:20)', 10], ['(3<2?10:20)', 20], ['(1==1)?5:6', 5], ['(!0)+0', 1], ['(2>1&&3>2)?1:0', 1],
  // 特殊函数
  ['gamma(5)', 24, 1e-6], ['gamma(0.5)^2', PI, 1e-6], ['beta(2,3)', 1 / 12, 1e-6],
  ['erf(0)', 0, 1e-7], ['erf(1)', 0.8427007929, 1e-6], ['erfc(1)', 1 - 0.8427007929, 1e-6],
  ['zeta(2)', PI * PI / 6, 1e-4], ['lambertw(e)', 1, 1e-6], ['sinintegral(1)', 0.9460830704, 1e-5],
  ['fresnels(1)', 0.4382591474, 1e-4], ['fresnelc(1)', 0.7798934004, 1e-4], ['elliptick(0)', PI / 2, 1e-4], ['elliptice(0)', PI / 2, 1e-4],
  ['normdist(0,1,0,1)', 0.5, 1e-6], ['normdist(0,1,1.96,1)', 0.9750021, 1e-5],
  ['tdist(1,0)', 1 / PI, 1e-5], ['chisqdist(2,2)', 0.5 * Math.exp(-1), 1e-5], ['gammadist(2,1,1)', Math.exp(-1), 1e-6],
  // 高级算子（手册 6.1 的示例）
  ['sum(k^2,k,1,10)', 385, 1e-9], ['prod(k,k,1,5)', 120, 1e-9], ['int(u^2,u,0,1)', 1 / 3, 1e-4],
  ['int(sin(q),q,0,pi)', 2, 1e-3], ['diffat(u^3,u,2)', 12, 1e-4], ['root(u^2-2,u,1)', Math.SQRT2, 1e-9],
  ['sum(sum(i+j,j,1,3),i,1,2)', 21, 1e-9], ['sum(k,k,5,1)', 0], ['prod(k,k,5,1)', 1], ['int(u,u,1,1)', 0], ['int(1,u,1,0)', -1, 1e-6],
];

test.describe('数值计算', () => {
  // 每个测试打开一次页面，所以这里把一组表达式放在同一个测试里，失败信息里会带上具体表达式。
  const chunks: (typeof VALUES)[] = [];
  for (let i = 0; i < VALUES.length; i += 12) chunks.push(VALUES.slice(i, i + 12));
  chunks.forEach((chunk, ci) => {
    test(`第 ${ci + 1} 组：${chunk.map(c => c[0]).join('  ')}`, async ({ arch }) => {
      const failures: string[] = [];
      for (let i = 0; i < chunk.length; i++) {
        const [expr, expected, tol = 1e-9] = chunk[i];
        const [e] = await arch.add(`v${ci}_${i}=${expr}`);
        const got = e?.value;
        const ok = e?.type === 'variable' && typeof got === 'number' && Math.abs(got - expected) <= Math.max(tol, tol * Math.abs(expected));
        if (!ok) failures.push(`${expr} → ${e?.type === 'variable' ? got : `${e?.type}: ${e?.content ?? e?.error}`}（期望 ${expected}）`);
      }
      expect(failures, failures.join('\n')).toEqual([]);
    });
  });

  test('非有限结果不会让程序崩溃：1/0、sqrt(-1)、ln(0)、gamma(0)、asin(2)', async ({ arch }) => {
    for (const expr of ['1/0', 'sqrt(-1)', 'ln(0)', 'gamma(0)', 'asin(2)', '0/0', '10^400', 'root(u^2+1,u,0)']) {
      const [e] = await arch.add(`bad=${expr}`);
      expect(e.type, expr).toBe('variable');
      expect(Number.isFinite(e.value ?? NaN), `${expr} 应为非有限值，得到 ${e.value}`).toBe(false);
    }
  });

  test('积分强度设置影响积分分段数且结果收敛', async ({ arch }) => {
    await arch.run((_e, api) => api.settings.set('solveIntegralIterations', 1000));
    expectClose(await arch.value('i1=int(exp(u),u,0,1)'), E - 1, '', 1e-4);
    await arch.run((_e, api) => api.settings.set('solveIntegralIterations', 10));
    const coarse = await arch.value('i2=int(exp(u),u,0,1)');
    expect(Math.abs(coarse! - (E - 1))).toBeLessThan(0.05);
  });

  test('sum/prod 的计算预算：超大范围不会卡死页面', async ({ arch }) => {
    const t0 = Date.now();
    const [e] = await arch.add('big=sum(k,k,1,10^9)');
    expect(Date.now() - t0, '应在预算内迅速返回').toBeLessThan(20_000);
    expect(['variable', 'text']).toContain(e.type);
    // 页面仍然可用
    expect(await arch.value('ok=1+1')).toBe(2);
  });
});

test.describe('依赖传播', () => {
  test('修改独立变量后，依赖变量/函数/几何全部更新', async ({ arch }) => {
    await arch.addAll(['a=2', 'b=3*a+1', 'c=b^2', 'f(u)=a*u', 'r=f(10)', 'point(P,a,b)', 'y=a*x']);
    expect((await arch.entry('b')).value).toBe(7);
    // 注：Arch 的实数幂对整数指数也可能有末位误差（7^2 = 48.99999999999999），这里用近似比较。
    expectClose((await arch.entry('c')).value, 49, 'c');
    expect((await arch.entry('r')).value).toBeCloseTo(20, 9);
    await arch.add('a=5'); // 覆盖独立变量
    expect((await arch.entry('b')).value).toBe(16);
    expectClose((await arch.entry('c')).value, 256, 'c');
    expect((await arch.entry('r')).value).toBeCloseTo(50, 9);
    const p = await arch.entry('P');
    expect([p.x, p.y]).toEqual([5, 16]);
    expectClose(await arch.evalPlot('func1', 2), 10);
  });

  test('覆盖独立变量时保留原有滑杆范围与步长', async ({ arch }) => {
    await arch.add('a=1');
    await arch.run(engine => { const e = engine.entries[0]; e.min = -100; e.max = 100; e.step = 0.5; });
    await arch.add('a=3');
    const a = await arch.entry('a');
    expect([a.value, a.min, a.max, a.step]).toEqual([3, -100, 100, 0.5]);
  });

  test('通过滑杆修改变量值', async ({ arch }) => {
    await arch.addAll(['a=1', 'b=a*10']);
    await arch.run(engine => {
      const e = engine.entries.find((x: any) => x.name === 'a');
      e.value = 1.5;
      engine.recalculateAll();
    });
    expect((await arch.entry('b')).value).toBe(15);
  });

  test('缺失的单字母变量自动补建为 1', async ({ arch }) => {
    await arch.add('y=m*x+n');
    const names = (await arch.entries()).filter(e => e.type === 'variable').map(e => e.name).sort();
    expect(names).toEqual(['m', 'n']);
    for (const n of names) expect((await arch.entry(n!)).value).toBe(1);
  });

  test('多字母名称先声明后整体识别', async ({ arch }) => {
    await arch.addAll(['speed=3', 'dist=speed*2']);
    expect((await arch.entry('dist')).value).toBe(6);
  });

  test('点坐标引用 [A,x] [A,y] 参与计算并随点更新', async ({ arch }) => {
    await arch.addAll(['point(A,1,2)', 'point(B,[A,x]+3,[A,y])', 'distance=sqrt(([A,x]-[B,x])^2+([A,y]-[B,y])^2)', 'y=[A,y]*x']);
    expect((await arch.entry('B')).x).toBe(4);
    expect((await arch.entry('distance')).value).toBe(3);
    await arch.add('point(A,-1,5)');
    const b = await arch.entry('B');
    expect([b.x, b.y]).toEqual([2, 5]);
    expectClose(await arch.evalPlot('func1', 2), 10);
  });

  test('循环依赖与自引用不会卡死或崩溃', async ({ arch }) => {
    await arch.addAll(['p=q+1', 'q=p+1', 'w=w+1', 'f(u)=f(u)+1', 'r=f(1)']);
    expect(await arch.value('ok=2*3')).toBe(6);
  });
});
