/**
 * 表达式解析与对象分类：每一种合法输入都应该被识别为正确的对象类型，且不能“退化成文字条目”。
 * 语法依据：页面内嵌的 Arch 手册（manual_syntax / manual_graphs）。
 */
import { test, expect, expectClose } from './support/arch';

type Case = { input: string; type: string; plotType?: string; autoPrefix?: string; extra?: (e: any) => void };

const CASES: Case[] = [
  // 显函数
  { input: 'y=sin(x)', type: 'function', plotType: 'y', autoPrefix: 'func' },
  { input: 'x=y^2', type: 'function', plotType: 'x', autoPrefix: 'func' },
  { input: 'y=3', type: 'function', plotType: 'y', autoPrefix: 'func' },
  { input: 'x=-2', type: 'function', plotType: 'x', autoPrefix: 'func' },
  { input: 'y=2x+1', type: 'function', plotType: 'y' }, // 隐式乘法
  { input: 'y=(x+1)(x-1)', type: 'function', plotType: 'y' },
  { input: 'y=2sin(x)', type: 'function', plotType: 'y' },
  { input: 'y=(x<0?-x:x^2)', type: 'function', plotType: 'y' }, // 分段
  { input: 'y=((x>=0&&x<=2)?sin(x):0)', type: 'function', plotType: 'y' },
  { input: 'y=x%2', type: 'function', plotType: 'y' },
  { input: 'y=x^2+range(x,-2,2)', type: 'function', plotType: 'y' },
  { input: 'y=sin(x)+llim(x,0)', type: 'function', plotType: 'y' },
  { input: 'y=x+ulim(x,3)', type: 'function', plotType: 'y' },
  { input: 'y=diff(sin(x),x)', type: 'function', plotType: 'y' },
  { input: 'y=ln(x)/ln(10)', type: 'function', plotType: 'y' },
  { input: 'y=abs(x)+floor(x)+ceil(x)+round(x)+sign(x)', type: 'function', plotType: 'y' },
  { input: 'y=x**2', type: 'function', plotType: 'y' },
  { input: 'y=（x+1）', type: 'function', plotType: 'y' }, // 全角括号自动转换
  { input: 'Y = SIN( X )', type: 'function', plotType: 'y' }, // 大小写与空白
  // 隐式方程 / 不等式
  { input: 'x^2+y^2=4', type: 'function', plotType: 'implicit', autoPrefix: 'eq', extra: e => expect(e.sign).toBe('=') },
  { input: 'x*y=1', type: 'function', plotType: 'implicit' },
  { input: 'sin(x)+cos(y)=0', type: 'function', plotType: 'implicit' },
  { input: 'y=x+y^2', type: 'function', plotType: 'implicit' }, // 右侧含左侧坐标 → 隐式
  { input: 'x^2+y^2-4+llim(y,0)=0', type: 'function', plotType: 'implicit' },
  { input: 'x^2+y^2<=4', type: 'function', plotType: 'implicit', extra: e => { expect(e.sign).toBe('<='); expect(e.color.a, '新建不等式默认半透明').toBe(50); } },
  { input: 'y>sin(x)', type: 'function', plotType: 'implicit', extra: e => expect(e.sign).toBe('>') },
  { input: 'y<x', type: 'function', plotType: 'implicit', extra: e => expect(e.sign).toBe('<') },
  { input: 'x>=1', type: 'function', plotType: 'implicit', extra: e => expect(e.sign).toBe('>=') },
  // 参数曲线（所有合法写法）
  { input: 'curve(cos(u),sin(u),u,0,2*pi)', type: 'function', plotType: 'parametric', autoPrefix: 'para' },
  { input: 'curve(cos(theta),sin(theta),theta,0,2*pi)', type: 'function', plotType: 'parametric' },
  { input: '(cos(t),sin(t))', type: 'function', plotType: 'parametric' },
  { input: 'curve(t,t^2)', type: 'function', plotType: 'parametric' },
  { input: 'x=cos(t),y=sin(t)', type: 'function', plotType: 'parametric' },
  { input: '(2*cos(q),sin(q),q,0,pi)', type: 'function', plotType: 'parametric' },
  { input: 'x=cos(u),y=sin(u){u,0,pi}', type: 'function', plotType: 'parametric' },
  { input: 'curve((1+cos(t))*cos(t),(1+cos(t))*sin(t),t,0,2*pi)', type: 'function', plotType: 'parametric' },
  // 点列
  { input: '/-/(0,0)(1,2)(3,1)', type: 'point_list', autoPrefix: 'plist' },
  { input: '/-/(0,0)(1,1)/(2,0)(3,1)', type: 'point_list' },
  { input: '/-/(0,0)(1,1)(x,x)(2,0)(3,1)', type: 'point_list' },
  { input: '/-/(1/2,0)(1,1)', type: 'point_list' },
  // 变量 / 数值
  { input: 'k=2', type: 'variable', extra: e => { expect(e.independent).toBe(true); expect(e.value).toBe(2); } },
  { input: 'k0=0', type: 'variable', extra: e => { expect(e.min).toBe(-10); expect(e.max).toBe(10); expect(e.step).toBe(0.02); } },
  { input: 'k3=-3', type: 'variable', extra: e => { expect(e.min).toBe(-6); expect(e.max).toBe(6); } },
  { input: 'kk=1+1', type: 'variable', extra: e => { expect(e.independent).toBe(false); expect(e.value).toBe(2); } },
  { input: 'kp=pi', type: 'variable', extra: e => { expect(e.independent).toBe(false); expectClose(e.value, Math.PI); } },
  { input: 'small=1e-3', type: 'variable', extra: e => expect(e.value).toBe(0.001) },
  { input: '2+3', type: 'variable', extra: e => { expect(e.name).toMatch(/^value\d+$/); expect(e.value).toBe(5); } },
  // 文字
  { input: '//这是一段说明', type: 'text', extra: e => expect(e.content).toBe('这是一段说明') },
  { input: '//<smart>/b参数/r a={value(1+1)}', type: 'text' },
];

test.describe('表达式分类', () => {
  for (const c of CASES) {
    test(`${c.input}`, async ({ arch }) => {
      const created = await arch.add(c.input);
      expect(created.length, '应创建至少一个条目').toBeGreaterThan(0);
      const e = created[created.length - 1];
      expect(e.error, `编译错误: ${e.error}`).toBeUndefined();
      if (c.type !== 'text') expect(e.type, `“${c.input}” 不应退化为文字条目（得到 ${e.type}: ${e.content ?? ''}）`).not.toBe('text');
      expect(e.type).toBe(c.type);
      if (c.plotType) expect(e.plotType).toBe(c.plotType);
      if (c.autoPrefix) expect(e.autoNumber).toBe(`${c.autoPrefix}1`);
      c.extra?.(e);
    });
  }
});

test.describe('函数定义与自动绘图', () => {
  test('f(x)=... 自动附带 y=f(x)；f(u)=... 只定义', async ({ arch }) => {
    const fx = await arch.add('f(x)=x^2+1');
    expect(fx.map(e => e.type).sort()).toEqual(['custom_function_definition', 'function']);
    const plot = fx.find(e => e.type === 'function')!;
    expect(plot.expr).toBe('y=f(x)');
    const gu = await arch.add('g(u)=u^3');
    expect(gu.map(e => e.type)).toEqual(['custom_function_definition']);
    const hy = await arch.add('h(y)=y^2');
    expect(hy.find(e => e.type === 'function')?.expr).toBe('x=h(y)');
    expect(await arch.value('r=g(2)+f(3)')).toBeCloseTo(18, 9);
  });

  test('多参数函数、嵌套调用与引用全局参数', async ({ arch }) => {
    await arch.addAll(['m=3', 'g(u,v)=u*v+m', 'h(w)=g(w,w)+1']);
    expect(await arch.value('r=h(2)')).toBeCloseTo(8, 9);
  });

  test('重复输入同名函数会覆盖而不是新建', async ({ arch }) => {
    await arch.add('f(u)=u+1');
    await arch.add('f(u)=u+2');
    const defs = (await arch.entries()).filter(e => e.type === 'custom_function_definition');
    expect(defs).toHaveLength(1);
    expect(await arch.value('r=f(1)')).toBeCloseTo(3, 9);
  });

  test('函数编号 func/eq/para/plist 各自独立递增', async ({ arch }) => {
    await arch.addAll(['y=x', 'y=2x', 'x^2+y^2=1', 'curve(t,t)', '/-/(0,0)(1,1)', 'x*y=2']);
    const nums = (await arch.entries()).map(e => e.autoNumber);
    expect(nums).toEqual(['func1', 'func2', 'eq1', 'para1', 'plist1', 'eq2']);
  });

  test('函数在采样点上的取值正确', async ({ arch }) => {
    await arch.addAll(['y=x^2-3x+2', 'x=y^2', 'x^2+y^2=4', 'curve(2*cos(u),3*sin(u),u,0,2*pi)', 'y=(x<0?-x:x^2)']);
    expectClose(await arch.evalPlot('func1', 4), 6);
    expectClose(await arch.evalPlot('func2', -3), 9);
    expectClose(await arch.evalPlot('eq1', { x: 1, y: 1 }), -2);
    expectClose(await arch.evalPlot('para1', 0, 'X'), 2);
    expectClose(await arch.evalPlot('para1', Math.PI / 2, 'Y'), 3);
    expectClose(await arch.evalPlot('func3', -2), 2);
    expectClose(await arch.evalPlot('func3', 3), 9);
  });

  test('定义域限制：区间外为 NaN，区间内为原值', async ({ arch }) => {
    await arch.add('y=x^2+range(x,-2,2)');
    expectClose(await arch.evalPlot('func1', 1.5), 2.25);
    expect(await arch.evalPlot('func1', 2.5)).toBeNaN();
  });
});

test.describe('批量输入', () => {
  test('$multi$ 一次创建多个对象', async ({ arch }) => {
    const r = await arch.run(engine => engine.addEntry('$multi$y=x$y=x^2$a=3$//note'));
    expect(r.processed).toBe(4);
    const types = (await arch.entries()).map(e => e.type);
    expect(types).toEqual(['function', 'function', 'variable', 'text']);
  });

  test('$multi2$ 按 HSB+不透明度着色', async ({ arch }) => {
    await arch.run(engine => engine.addEntry('$multi2$y=x^2$(60,100,85,100)$x^2+y^2<=1$(10,50,50,100)$end$$$'));
    const [f, ineq] = await arch.entries();
    expect(f.color).toMatchObject({ h: 60, s: 100, b: 85, a: 0 });
    expect(ineq.color?.a, '不等式不允许完全不透明，自动调到 50').toBe(50);
  });

  test('$multi2$ 格式错误时给出提示且不创建对象', async ({ arch }) => {
    await arch.run(engine => engine.addEntry('$multi2$y=x$(1,2)$'));
    expect(await arch.entries()).toHaveLength(0);
  });
});

test.describe('已知缺陷（修复后请去掉 test.fail）', () => {
  for (const input of ['y=log(x)', 'y=lg(x)', 'y=logbase(2,x)', 'v=log(100)']) {
    test(`对数函数 ${input} 能被解析`, async ({ arch }) => {
      test.fail(true, 'BUG-5：log/lg/logbase 被数学调用校验拒绝，退化为文字条目（虚拟键盘上却有 log( 和 logbase( 按键）');
      const [e] = await arch.add(input);
      expect(e.type).not.toBe('text');
    });
  }
  test('连续乘方 2^3^2', async ({ arch }) => {
    test.fail(true, '手册已记录：裸写连续乘方转译异常，退化为文字条目');
    const [e] = await arch.add('v=2^3^2');
    expect(e.type).toBe('variable');
  });
});
