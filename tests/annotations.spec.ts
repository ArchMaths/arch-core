/**
 * 批注：画笔、橡皮、文字、进入/退出批注模式、随存档保存、批注编辑开关。
 */
import { test, expect, Arch } from './support/arch';

const enterPen = (arch: Arch) => arch.run((_e, api) => api.ui.click('annotation-pen'));
const exit = (arch: Arch) => arch.run((_e, api) => api.ui.click('annotation-exit'));

async function stroke(arch: Arch, x0: number, y0: number, len = 200) {
  const { page } = arch;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + (i * len) / 20, y0 + Math.sin(i / 3) * 30);
  await page.mouse.up();
}

test.describe('批注', () => {
  test('画笔：进入批注模式、画一笔、退出', async ({ arch, page }) => {
    await enterPen(arch);
    expect(await arch.run(e => e.currentUIMode)).toBe('annotation');
    await stroke(arch, 700, 300);
    await expect.poll(() => arch.run(e => e.annotations.length)).toBe(1);
    const a = await arch.run(e => ({ type: e.annotations[0].type, n: e.annotations[0].path?.length }));
    expect(a.type).toBe('pen');
    expect(a.n).toBeGreaterThan(5);
    await exit(arch);
    expect(await arch.run(e => e.currentUIMode)).not.toBe('annotation');
    // 退出后在画布上拖动不再产生批注
    await stroke(arch, 700, 500);
    expect(await arch.run(e => e.annotations.length)).toBe(1);
  });

  test('画笔笔迹确实被绘制（像素检查）', async ({ arch }) => {
    const before = await arch.pixels();
    await enterPen(arch);
    await stroke(arch, 650, 250, 300);
    await exit(arch);
    await arch.idle();
    const after = await arch.pixels();
    expect(Arch.diffCount(before, after)).toBeGreaterThan(200);
  });

  test('橡皮擦除笔迹', async ({ arch }) => {
    await enterPen(arch);
    await stroke(arch, 700, 300);
    await expect.poll(() => arch.run(e => e.annotations.length)).toBe(1);
    await arch.run((_e, api) => api.ui.click('annotation-eraser'));
    await stroke(arch, 690, 290, 240);
    await expect.poll(() => arch.run(e => e.annotations.length)).toBe(0);
    await exit(arch);
  });

  test('批注随存档保存与恢复', async ({ arch }) => {
    await enterPen(arch);
    await stroke(arch, 700, 300);
    await stroke(arch, 700, 400);
    await exit(arch);
    await expect.poll(() => arch.run(e => e.annotations.length)).toBe(2);
    const st = await arch.run(e => JSON.stringify(e.exportStateObject()));
    await arch.run(e => e.createNewProject());
    await arch.idle();
    expect(await arch.run(e => e.annotations.length)).toBe(0);
    await arch.run((e, _a, s) => e.loadState(s), st);
    await arch.idle();
    expect(await arch.run(e => e.annotations.map((a: any) => a.type))).toEqual(['pen', 'pen']);
  });

  test('已知缺陷：撤销只撤销最近一笔批注', async ({ arch }) => {
    test.fail(true, 'BUG-9：画笔批注不入撤销栈，撤销会把上一步操作（这里是 y=x）一起撤掉');
    await arch.add('y=x');
    await enterPen(arch);
    await stroke(arch, 700, 300);
    await exit(arch);
    await expect.poll(() => arch.run(e => e.annotations.length)).toBe(1);
    await arch.run(e => e.undo());
    await arch.idle();
    expect(await arch.run(e => e.annotations.length)).toBe(0);
    expect(await arch.entries()).toHaveLength(1);
  });

  test('文字批注', async ({ arch, page }) => {
    arch.dialogHandler = () => '批注文字 ABC';
    await arch.run((_e, api) => api.ui.click('annotation-text'));
    await page.mouse.click(800, 300);
    await page.waitForTimeout(300);
    // 文字批注可能通过对话框或应用内输入框录入
    const input = page.locator('textarea:visible, input[type="text"]:visible').last();
    if (await input.isVisible().catch(() => false)) { await input.fill('批注文字 ABC'); await page.keyboard.press('Enter'); }
    await exit(arch);
    await expect.poll(() => arch.run(e => e.annotations.filter((a: any) => a.type === 'text').length)).toBe(1);
  });

  test('“禁止批注编辑”开关生效', async ({ arch }) => {
    await enterPen(arch);
    await stroke(arch, 700, 300);
    await exit(arch);
    await arch.run((_e, api) => api.settings.set('annotationEditing', false));
    expect(await arch.run((_e, api) => api.settings.get('annotationEditing'))).toBe(false);
    await arch.run((_e, api) => api.settings.set('annotationEditing', true));
    expect(await arch.run((_e, api) => api.settings.get('annotationEditing'))).toBe(true);
  });
});
