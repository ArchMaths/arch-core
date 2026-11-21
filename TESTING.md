# Arch 图形计算器自动化测试

对仓库根目录的 `index.html` 做端到端回归测试。在 **Windows 11 / macOS 26 / Ubuntu** 上，分别用 **Chromium、Chrome、Edge、Firefox、WebKit（Safari 内核）** 各跑一遍。只测计算器本身：登录、云存档、通知、更新、AI 等后端请求在测试里全部被拦截。

## 本地运行

```bash
npm ci
npx playwright install chromium firefox webkit   # 第一次运行需要
npm test                                         # 全部浏览器
npx playwright test --project=chromium           # 只跑一个浏览器
npx playwright test tests/geometry.spec.ts       # 只跑一个文件
npx playwright test -g "交点"                     # 按标题过滤
npx playwright show-report                       # 查看 HTML 报告（失败用例附带截图和 trace）
```

`index.html` 不在仓库根目录时，可以用 `ARCH_ROOT=/path/to/dir npm test` 指定所在目录。

## 测试内容

| 文件 | 覆盖内容 |
| --- | --- |
| `smoke.spec.ts` | 启动、WebGL/WASM、断网可用、异步绘图 worker、“关于”页按钮、启动阶段无异常 |
| `expressions.spec.ts` | 约 50 种输入形式的分类（显函数、隐函数、不等式、参数曲线各写法、点列、变量、文字）、函数定义与自动绘图、编号规则、`$multi$` / `$multi2$` 批量输入 |
| `math.spec.ts` | 约 90 个数值：初等/特殊/概率函数、`sum/prod/int/diff/diffat/root`、条件与逻辑、非有限值、计算预算；依赖传播、点坐标引用、循环依赖 |
| `geometry.spec.ts` | 28 个几何关键字（含手册里的可核对示例：交点 ±1 选根、切线、点变换）、对象上点、依赖更新、级联删除、退化构造；几何工具面板的鼠标操作、拖动点 |
| `three-d.spec.ts` | 维度切换、10 种 3D 对象、3D 网格生成、相机接口、鼠标旋转/平移/缩放、像素级渲染检查 |
| `statistics.spec.ts` | 表格导入导出（CSV/TSV）、单元格公式、描述统计、五种回归（精确系数）、排序联动、增删列、存档；表格界面 |
| `ui.spec.ts` | 物理键盘与虚拟数学键盘输入、卡片编辑/删除、撤销重做、缩放/平移/坐标锁定、侧栏、深色模式、手机竖屏布局；2D 像素级渲染检查（曲线是否画在正确位置） |
| `settings.spec.ts` | 自动遍历所有设置项（布尔、数值、枚举），在复杂场景中逐一切换；非法值必须被拒绝 |
| `persistence.spec.ts` | 存档导出/导入往返、文件下载与读回、损坏文件、向前兼容、新建项目、50 步撤销/重做 |
| `script-animation.spec.ts` | 全局脚本（界面运行、停止、异常、沙箱隔离）、自定义 JS 运算符、参数动画与播放模式 |
| `annotations.spec.ts` | 画笔、橡皮、文字批注、随存档保存、批注编辑开关 |
| `robustness.spec.ts` | 约 150 条畸形输入、26 种 JS 注入、XSS、超长/深嵌套表达式、300 个对象批量创建、极端视口、带种子的随机模糊测试 |
| `examples.spec.ts` | 31 个官方示例存档的“黄金指纹”回归（见下文） |

每个用例结束时都会自动检查页面有没有**未捕获异常 / 未处理的 Promise 拒绝**。也就是说，即使某个功能没有专门的断言，只要操作让引擎抛错，测试也会失败。

### 示例存档黄金指纹

`tests/fixtures/examples/` 是官方公开示例存档的快照（新手教程、尺规作图、3D 建模、高考题演示、全局脚本……对象之间引用复杂）。测试会离线加载每个存档，计算“指纹”：每个对象的类型、名称、数值、坐标、是否有意义，以及 2D 曲线在几个采样点的取值。然后与 `tests/golden/*.json` 比较（浮点容差 1e-6），再做一次导出→加载往返。

**如果你的改动有意改变了计算结果**（比如修正了某个数值算法）：

```bash
npm run test:update-golden          # 用 Chromium 重新生成全部黄金文件
git diff tests/golden               # 检查变化是否符合预期
```

请在 PR 里说明黄金文件为什么会变化。

体积超过 300KB 的 9 个大存档（多为复杂 3D 模型）加载很慢，push/PR 时跳过，只在每日定时任务和手动触发时运行（本地设置 `ARCH_FULL=1` 或不设置 `CI` 都会跑）。

### 模糊测试

`robustness.spec.ts` 的随机模糊测试使用固定种子，失败信息里会打印种子和出问题的输入。复现方式：`FUZZ_SEED=20261121 npx playwright test -g 模糊`。CI 的每日定时任务会用当天日期作种子，持续探索新的输入。

## 已知缺陷（`test.fail` 标注）

下列用例用 `test.fail()` 标注：缺陷存在时测试“按预期失败”，CI 保持绿色；**缺陷修复后这些用例会变红，提醒你删除 `test.fail` 那一行**，让它们变回普通的回归测试。

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| BUG-1 | 焦点式椭圆/双曲线的方程文字缺常数项（`0.200x² + 0.250y² - = 0`） | `formatConicEquation` |
| BUG-2 | 拖动几何点不入撤销栈，撤销时连带撤掉上一步操作 | 08.11 指针拖动 |
| BUG-3 | Firefox 启动时 `ArchAiGate` 早于 `archInstance` 创建，抛 TypeError | 12.01 `updateAgentUI` |
| BUG-4 | WebKit/Safari 异步绘图 worker 无法启动（blob URL 被过早撤销） | `ArchAsyncDrawing.start` |
| BUG-5 | `log` / `lg` / `logbase` 全部退化为文字（虚拟键盘上却有这些按键） | 数学调用校验 |
| BUG-6 | **存储型 XSS**：文字条目 HTML 未转义，打开含恶意文字的存档即执行脚本 | `createEntryCardHTML` |
| BUG-7 | 以 `^` 开头的分词片段（如 `y=^x`）让页面死循环卡死 | `processTokensForEval` |
| BUG-8 | 放大后远离原点，坐标轴刻度循环不再前进，页面卡死 | `drawAxisNumbers` |
| BUG-9 | 画笔批注不入撤销栈，撤销时连带撤掉上一步操作 | 08.40 批注输入 |
| BUG-10 | 自定义 JS 运算符没有执行时间上限，死循环会永久卡死页面 | 运算符沙箱 |

## CI

`.github/workflows/calculator-tests.yml`：push、PR、手动触发和每日定时运行，15 个 job（3 系统 × 5 浏览器）互相独立。失败时在 Actions 页面下载对应 job 的 `report-*` 产物，解压后 `npx playwright show-report playwright-report` 查看截图、录制的 trace 和控制台日志。

Windows 11 使用 GitHub 托管的 `windows-11-arm` 运行器。如果你的仓库用不了它（例如私有仓库），在仓库 **Settings → Secrets and variables → Actions → Variables** 新建 `WINDOWS_RUNNER=windows-2025` 即可，不用改 workflow。
