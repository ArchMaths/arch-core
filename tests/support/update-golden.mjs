// 重新生成示例存档的黄金指纹（只用 Chromium 生成；其他浏览器在 CI 中与之比较）。
// 用法：npm run test:update-golden [-- 额外的 playwright 参数，比如 -g 000000000011]
import { spawnSync } from 'node:child_process';

const args = ['playwright', 'test', 'tests/examples.spec.ts', '--project=chromium', ...process.argv.slice(2)];
const r = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, UPDATE_GOLDEN: '1' } });
process.exit(r.status ?? 1);
