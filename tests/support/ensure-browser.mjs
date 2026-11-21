// 确保正式版 Chrome / Edge 可用：先尝试直接启动（CI 镜像通常已预装），失败再用 Playwright 安装。
// 用法：node tests/support/ensure-browser.mjs chrome|msedge
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';

const channel = process.argv[2];
if (!['chrome', 'msedge'].includes(channel)) {
  console.error('参数应为 chrome 或 msedge');
  process.exit(2);
}

async function canLaunch() {
  try {
    const b = await chromium.launch({ channel });
    console.log(`${channel} 可用：${b.version()}`);
    await b.close();
    return true;
  } catch (e) {
    console.log(`${channel} 无法启动：${String(e.message).split('\n')[0]}`);
    return false;
  }
}

if (await canLaunch()) process.exit(0);
const r = spawnSync('npx', ['playwright', 'install', '--force', channel], { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) process.exit(r.status ?? 1);
process.exit((await canLaunch()) ? 0 : 1);
