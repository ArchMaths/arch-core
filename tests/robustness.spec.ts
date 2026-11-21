/**
 * 健壮性：任何输入都不应让页面抛出未捕获异常、卡死、执行任意脚本，输入失败后程序必须仍然可用。
 * fixture 会在每个测试结束时自动检查页面异常。
 */
import { test, expect, isolatedArch } from './support/arch';

/**
 * BUG-7：'^' 作为某段分词的第一个 token 时 processTokensForEval 死循环，页面永久卡死。
 * 下面的正则匹配“可能触发该缺陷”的输入；模糊测试会先跳过它们，修复后请删除这个过滤。
 */
export const KNOWN_FREEZE = /(^|[=,(])\s*\^/;

const GARBAGE = [
  '', '   ', '=', '==', '===', '((((', '))))', '(()', 'sin(', 'y=', '=x', 'y==x', 'y=x=', '+', '-', '*', '/', ',', '.', '..', '1..2',
  'y=sin()', 'y=sin(,)', 'y=x^', 'y=*x', 'y=x^^2', 'y=2+^3', 'y=x//2', 'y=(x', 'y=x)', 'y=)x(', '()', '(,)', '(1,2,3,4)', '(1,2,3,4,5,6,7)',
  '|x|', 'y=|x|', 'x!', '5!', 'y={x}', 'y=x{1<x<2}', 'f()=1', 'f(=1', '(x)=1', 'x(x)=1', 'sin(x)=x', 'pi=3', 'e=2', 'x=1=2',
  'point(', 'point()', 'point(A)', 'point(A,1)', 'point(1,2,3)', 'circle(c,Nope,2)', 'segment(s,A,A)', 'circle(c,O,-1)', 'circle(c,O,0)',
  'polygon(p,2,A,B)', 'polyeq(p,A,B,2)', 'polyeq(p,A,B,1000)', 'intersect(P,X,Y)', 'tangent(T,nothing,P)', 'root[x^2-2,x,1]',
  'curve(x,y,x,0,1)', 'curve(cos(u),sin(u),u,1,0)', 'curve(u,u,u,0,u)', 'surface(u,v,u*v,u,0,1,u,0,1)', 'curve(1,2,3,4)',
  '/-/', '/-/(', '/-/()', '/-/(1)', '/-/(1,2', '/-/(a,b)(c,d)',
  '$multi$', '$multi$$$', '$multi2$', '$multi2$$', '$multi2$y=x$(1,2,3)$', '$multi2$y=x$(a,b,c,d)$',
  '1e999', 'y=1e999*x', 'v=10^308*10', 'v=-10^308*10', 'v=(-1)^(0.5)', 'y=0^0', 'v=0^(-1)',
  '中文表达式', 'y=中', '😀', 'y=x😀', 'y=\u0000x', 'y=x​', '\t\n', 'y=x\ny=2x', 'ＹＹ＝ｘ',
  '__proto__=1', 'constructor=1', 'prototype=1', 'toString=1', 'valueOf(x)=1', 'hasOwnProperty=2', '__arch_parameter_0=1', 'Math=1', 'window=1',
  'y=Math.random()', 'y=this', 'y=globalThis', 'y=document', 'y=eval', 'y=x;alert(1)', 'y=x,alert(1)', 'alert(1)', 'y=alert(1)',
  'y=(()=>1)()', 'y=function(){}', 'y=x`', 'y=${x}', 'y=x/*', 'y=x//', "y='x'", 'y="x"', 'y=[1,2]', 'y=new Date()', 'y=x?.a',
  '<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', '//<img src=x onerror=window.__pwned=1>', 'y=<b>x</b>',
  "'; DROP TABLE entries; --", '../../etc/passwd', 'data:image/png;base64,AAAA', '//data:image/png;base64,AAAA',
];

/** 试图逃逸到 JS 的表达式：执行了就会设置 window.__pwned。 */
const INJECTIONS = [
  'y=(window.__pwned=1)', 'y=x+(window.__pwned=1)', 'y=constructor.constructor("window.__pwned=1")()',
  'y=x.constructor.constructor("window.__pwned=1")()', 'v=[].constructor.constructor("window.__pwned=1")()',
  'f(u)=(window.__pwned=1)', 'y=(()=>{window.__pwned=1})()', 'y=Function("window.__pwned=1")()', 'y=eval("window.__pwned=1")',
  'y=self["__pwned"]=1', 'y=top.__pwned=1', 'y=parent.__pwned=1', 'y=sin.constructor("window.__pwned=1")()',
  'y=Math.constructor.constructor("window.__pwned=1")()', 'point(A,(window.__pwned=1),0)', '/-/((window.__pwned=1),0)(1,1)',
  'curve((window.__pwned=1),t)', 'x^2+(window.__pwned=1)=y', 'v=sum((window.__pwned=1),k,1,2)', 'v=root(window.__pwned=1,u,1)',
  '$multi$y=(window.__pwned=1)$', 'y=x;window.__pwned=1', 'y=x\nwindow.__pwned=1', 'y=x//\nwindow.__pwned=1',
  '//<smart>{value(window.__pwned=1)}', 'f(u)={window.__pwned=1;return u}',
];

test.describe('畸形输入', () => {
  const chunks: string[][] = [];
  for (let i = 0; i < GARBAGE.length; i += 20) chunks.push(GARBAGE.slice(i, i + 20));
  chunks.forEach((chunk, i) => {
    test(`第 ${i + 1} 组畸形输入不崩溃、程序仍可用`, async ({ arch }) => {
      // 先放一些正常对象，畸形输入不能破坏它们。
      await arch.addAll(['point(A,1,1)', 'point(B,2,3)', 'a=2', 'y=a*x']);
      arch.dialogHandler = () => undefined; // 有些输入会触发 prompt，全部取消
      for (const g of chunk) {
        await arch.page.evaluate(g => {
          try { (window as any).archInstance.addEntry(g, { conflictAction: 'overwrite' }); } catch (e) { (window as any).__thrown = ((window as any).__thrown || []).concat(String(e)); }
        }, g);
      }
      await arch.idle();
      const thrown = await arch.page.evaluate(() => (window as any).__thrown ?? []);
      expect(thrown, 'addEntry 不应向调用者抛出异常').toEqual([]);
      // 原有对象不受影响
      expect((await arch.entry('A')).x).toBe(1);
      expect((await arch.entry('func1')).type).toBe('function');
      // 程序仍能正常添加和计算
      expect(await arch.value('alive=6*7')).toBe(42);
      // 没有任何条目带着编译错误残留（失败输入应回滚或变为文字）
      const broken = (await arch.entries()).filter(e => e.error);
      expect(broken.map(e => `${e.expr}: ${e.error}`)).toEqual([]);
    });
  });
});

test.describe('安全：表达式不能执行任意 JavaScript', () => {
  test('注入尝试全部无效', async ({ arch, page }) => {
    for (const inj of INJECTIONS) {
      await page.evaluate(g => { try { (window as any).archInstance.addEntry(g, { conflictAction: 'overwrite' }); } catch {} }, inj);
      // 触发一次全量重算和绘制，覆盖“编译时”和“求值时”两条路径
      await page.evaluate(() => { const a = (window as any).archInstance; a.recalculateAll(); a.requestDraw(); });
      await arch.idle();
      expect(await page.evaluate(() => (window as any).__pwned), `注入成功：${inj}`).toBeUndefined();
    }
  });

  // BUG-6：文字条目内容直接拼进 innerHTML（createEntryCardHTML: `// ${entry.content}` 未转义），
  // data:image 分支的 src 属性、条目行的 title 属性同样未转义。打开含恶意文字条目的存档即执行脚本。
  const XSS_VECTORS: [string, string][] = [
    ['文字条目 <img onerror>', '//<img src=x onerror="window.__pwned=1"><b id="arch-xss-probe">x</b>'],
    ['文字条目 <svg onload>', '//<svg onload="window.__pwned=1" id="arch-xss-probe"></svg>'],
    ['data:image 属性逃逸', '//data:image/png;base64,AAAA" onerror="window.__pwned=1" id="arch-xss-probe'],
    ['title 属性逃逸', '//x" onmouseover="window.__pwned=1" id="arch-xss-probe'],
  ];
  for (const [name, input] of XSS_VECTORS) {
    test(`XSS：${name}`, async ({ arch, page }) => {
      test.fail(true, 'BUG-6：文字条目 HTML 未转义（存储型 XSS）');
      await arch.add(input);
      await page.waitForTimeout(300);
      await page.locator('#entry-list').hover().catch(() => {});
      expect(await page.evaluate(() => (window as any).__pwned), '脚本被执行').toBeUndefined();
      expect(await page.locator('#arch-xss-probe').count(), '用户输入被解析成了 DOM 元素').toBe(0);
    });
  }

  test('XSS：加载含恶意文字条目的存档不执行脚本', async ({ arch, page }) => {
    test.fail(true, 'BUG-6：加载存档时同样会执行（分享/社区存档即可攻击其他用户）');
    const state = JSON.stringify({
      entries: [{ type: 'text', name: 'text1', content: '<img src=x onerror="window.__pwned=1">', expr: '//<img src=x onerror="window.__pwned=1">', color: { h: 0, s: 0, b: 60, a: 0 } }],
      scale: 100, offsetX: 500, offsetY: 400,
    });
    await arch.run((engine, _a, s) => engine.loadState(s), state);
    await arch.idle();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  });

  test('几何标签、统计表格单元格中的 HTML 被转义', async ({ arch, page }) => {
    await arch.add('point(A,1,1)');
    await arch.run(engine => { const e = engine.entries[0]; e.labelMode = 'custom'; e.labelText = '<img src=x onerror="window.__pwned=1">'; engine.updateEntryList(); engine.requestDraw(); });
    await arch.run((_e, api) => { api.table.import([['<img src=x onerror="window.__pwned=1">', '1']]); api.ui.sidebar('statistics'); });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  });
});

test.describe('已知缺陷：会让页面卡死的输入（修复后请去掉 test.fail）', () => {
  for (const input of ['^2', 'y=^x', 'curve(^t,t)', 'v=sum(^k,k,1,2)', 'point(A,^1,0)', '/-/(^1,0)(1,1)']) {
    test(`输入 ${input} 后页面仍可响应`, async ({ playwright, browserName }, testInfo) => {
      test.fail(true, 'BUG-7：processTokensForEval 遇到无左操作数的 ^ 死循环');
      const { arch, close } = await isolatedArch(playwright[browserName], browserName, testInfo);
      try {
        expect(await arch.addAndCheckResponsive(input), '页面主线程卡死').toBe(true);
        await arch.assertHealthy();
      } finally { await close(); }
    });
  }

  test('放大后移动到远离原点处，坐标轴刻度绘制不死循环', async ({ playwright, browserName }, testInfo) => {
    test.fail(true, 'BUG-8：drawAxisNumbers 中 x = parseFloat((x+step).toPrecision(10)) 在 |x|/step > 1e10 时不再增长');
    const { arch, close } = await isolatedArch(playwright[browserName], browserName, testInfo);
    try {
      arch.page.evaluate(() => { try { (window as any).archInstance.createArchScriptExtensions().view.set({ unit: 1e6, center: { x: 1e7, y: -1e7 } }); } catch {} }).catch(() => {});
      const ok = await Promise.race([
        new Promise(r => setTimeout(r, 300)).then(() => arch.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))),
        new Promise(r => setTimeout(() => r(false), 6000)),
      ]);
      expect(ok, '页面主线程卡死').toBe(true);
    } finally { await close(); }
  });
});

test.describe('规模与极端情况', () => {
  test('超长表达式（1500 项求和）', async ({ arch }) => {
    // 注：5000 项在冷启动页面上有时会退化成文字、有时成功（与时序相关），这里用确定能通过的规模。
    const N = 1500;
    const expr = 'y=' + Array.from({ length: N }, (_, i) => `${i % 7}*x`).join('+');
    const [e] = await arch.add(expr);
    expect(e.type).toBe('function');
    expect(await arch.evalPlot('func1', 1)).toBeCloseTo(Array.from({ length: N }, (_, i) => i % 7).reduce((a, b) => a + b), 6);
  });

  test('深度嵌套括号（300 层）', async ({ arch }) => {
    const [e] = await arch.add('v=' + '('.repeat(300) + '1+1' + ')'.repeat(300));
    expect(e.type).toBe('variable');
    expect(e.value).toBe(2);
  });

  test('一次批量创建 300 个对象，再全部撤销/重做', async ({ arch }) => {
    const t0 = Date.now();
    const batch = '$multi$' + Array.from({ length: 300 }, (_, i) => `y=sin(x+${i})*${(i % 5) + 1}`).join('$');
    const r = await arch.run((engine, _api, b) => engine.addEntry(b), batch);
    await arch.idle(120_000);
    expect(r.processed).toBe(300);
    expect(await arch.run(engine => engine.entries.length)).toBe(300);
    expect(Date.now() - t0, '300 条函数的创建与计算耗时').toBeLessThan(60_000);
    // 视口变化后重算
    await arch.run((_e, api) => api.view.set({ center: { x: 10, y: 0 } }));
    await arch.idle(120_000);
  });

  test('连续添加/删除 200 次后状态一致', async ({ arch }) => {
    const n = await arch.run(engine => {
      for (let i = 0; i < 200; i++) {
        engine.addEntry(`y=x+${i}`);
        if (i % 2) engine.deleteEntryByIndex(engine.entries.length); // 序号从 1 开始：删除最后一条
      }
      return engine.entries.length;
    });
    expect(n).toBe(100);
    await arch.idle();
    // 编号连续性不作要求，但每条都必须有效
    expect((await arch.entries()).every(e => e.type === 'function' && !e.error)).toBe(true);
  });

  test('极端视口：极大/极小缩放与远离原点', async ({ arch }) => {
    await arch.addAll(['y=sin(x)', 'x^2+y^2=1', 'curve(cos(t),sin(t))', 'point(A,1,1)']);
    // 注：同时“放大 1e6 倍 + 远离原点”会触发 BUG-8，单独在已知缺陷里测试。
    for (const v of [{ unit: 0.01 }, { unit: 1e6 }, { unit: 1e6, center: { x: 1000, y: -1000 } }, { unit: 0.01, center: { x: 1e9, y: -1e9 } }, { center: { x: 0, y: 0 }, unit: 100 }]) {
      await arch.run((_e, api, v) => { try { api.view.set(v); } catch {} }, v);
      await arch.idle();
    }
    expect(await arch.value('ok=1')).toBe(1);
  });

  test('视口参数非法时被拒绝且视图不被破坏', async ({ arch }) => {
    const before = await arch.run((_e, api) => api.view.get());
    for (const bad of [{ unit: -1 }, { unit: NaN }, { center: { x: Infinity, y: 0 } }, { axisBounds: { x: { min: 1, max: 0 } } }, { dimension: '4d' }, { foo: 1 }]) {
      const err = await arch.run((_e, api, v) => { try { api.view.set(v); return null; } catch (e: any) { return String(e.message); } }, bad as any);
      expect(err, JSON.stringify(bad)).toMatch(/ArchScript/);
    }
    const after = await arch.run((_e, api) => api.view.get());
    expect(after.center).toEqual(before.center);
    expect(after.unit).toBe(before.unit);
  });
});

/** 带种子的伪随机数，失败时可用相同种子复现。 */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomExpr(r: () => number, depth = 0): string {
  const atoms = ['x', 'y', '1', '2', '0.5', 'pi', 'e', 'a', 'k', '-3', '10^(-3)', '0'];
  const fns = ['sin', 'cos', 'tan', 'ln', 'exp', 'sqrt', 'abs', 'floor', 'gamma', 'atan', 'cbrt', 'sinh', 'erf', 'sign'];
  const ops = ['+', '-', '*', '/', '^', '%'];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const p = r();
  if (depth > 3 || p < 0.3) return pick(atoms);
  if (p < 0.55) return `${pick(fns)}(${randomExpr(r, depth + 1)})`;
  if (p < 0.65) return `(${randomExpr(r, depth + 1)}>${randomExpr(r, depth + 1)}?${randomExpr(r, depth + 1)}:${randomExpr(r, depth + 1)})`;
  if (p < 0.7) return `sum(${randomExpr(r, depth + 1).replace(/x|y/g, 'q')},q,1,${1 + Math.floor(r() * 20)})`;
  return `(${randomExpr(r, depth + 1)}${pick(ops)}${randomExpr(r, depth + 1)})`;
}

function mutate(r: () => number, s: string) {
  const junk = ['(', ')', ',', '^', '=', '<', '?', ':', '/', '/-/', '[', ']', '$', 'point(', '{', '}'];
  const chars = s.split('');
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const pos = Math.floor(r() * (chars.length + 1));
    const op = r();
    if (op < 0.4) chars.splice(pos, 0, junk[Math.floor(r() * junk.length)]);
    else if (op < 0.7) chars.splice(pos, 1);
    else chars.splice(pos, 0, ...chars.slice(0, pos).slice(-3));
  }
  return chars.join('');
}

test.describe('随机模糊测试', () => {
  const baseSeed = Number(process.env.FUZZ_SEED || 20261121);
  for (let round = 0; round < 4; round++) {
    const seed = baseSeed + round;
    test(`种子 ${seed}：120 条随机/变异表达式`, async ({ arch }) => {
      const r = rng(seed);
      const inputs: string[] = [];
      for (let i = 0; i < 120; i++) {
        const body = randomExpr(r);
        const forms = [`y=${body}`, `x^2+${body}=y`, `v${i}=${body.replace(/x|y/g, '2')}`, `curve(${body.replace(/x|y/g, 't')},t)`, `y>${body}`];
        let s = forms[Math.floor(r() * forms.length)];
        if (r() < 0.35) s = mutate(r, s);
        if (KNOWN_FREEZE.test(s)) continue; // BUG-7 修复后删除这一行
        inputs.push(s);
      }
      arch.dialogHandler = () => undefined;
      for (const s of inputs) {
        // 带超时：一旦某条输入让主线程卡死，直接报出这条输入，而不是整个测试笼统超时。
        const res = await Promise.race([
          arch.page.evaluate(s => {
            try { (window as any).archInstance.addEntry(s, { conflictAction: 'overwrite' }); return null; } catch (e) { return String(e); }
          }, s),
          new Promise<string>(r => setTimeout(() => r('__FROZEN__'), 15_000)),
        ]);
        if (res === '__FROZEN__') arch.skipHealthCheck = true;
        expect(res, `输入 ${JSON.stringify(s)} ${res === '__FROZEN__' ? '让页面卡死' : '让 addEntry 抛出异常'}（FUZZ_SEED=${seed}）`).toBeNull();
      }
      await arch.idle(120_000);
      // 视口变化触发所有对象重新采样
      await arch.run((_e, api) => api.view.set({ center: { x: 3, y: -2 }, unit: 40 }));
      await arch.idle(120_000);
      // 撤销全部再重做全部
      await arch.run(engine => { while (engine.undoStack.length) engine.undo(); while (engine.redoStack.length) engine.redo(); });
      await arch.idle(120_000);
      expect(await arch.value('alive=1+1'), `FUZZ_SEED=${seed} 之后程序不可用`).toBe(2);
      // 页面异常会在 fixture 收尾时检查（并带上种子信息方便复现）
      test.info().annotations.push({ type: 'fuzz-seed', description: String(seed) });
    });
  }
});
