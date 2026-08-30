import { spawn, execSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ASSETS_DIR = join(process.cwd(), 'docs', 'assets');
const PORT = 5299;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitUrl(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (text.includes('AMBIT') || text.includes('ambit') || text.includes('root')) {
          return true;
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function captureShot(url: string, outFile: string, width = 1440, height = 900, delayMs = 3000) {
  console.log(`📸 Capturing: ${outFile} (${width}x${height})...`);
  const tmpProfile = mkdtempSync(join(tmpdir(), 'ambit-chrome-'));
  try {
    const cmd = `"${CHROME_PATH}" --headless=new --user-data-dir="${tmpProfile}" --no-first-run --hide-scrollbars --window-size=${width},${height} --virtual-time-budget=${delayMs} --screenshot="${outFile}" "${url}"`;
    execSync(cmd, { stdio: 'pipe' });
    console.log(`✅ Saved ${outFile}`);
  } finally {
    try { rmSync(tmpProfile, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  console.log('🚀 Building production client...');
  execSync('bun run build', { stdio: 'inherit' });

  console.log(`🚀 Starting preview server on port ${PORT}...`);
  const server = spawn('bun', ['run', 'vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'pipe',
  });

  try {
    const ready = await waitUrl(BASE_URL);
    if (!ready) {
      throw new Error(`Server failed to respond with Ambit client at ${BASE_URL}`);
    }
    console.log(`🌐 Server active at ${BASE_URL}`);

    // 1. Tech Tree Screenshot (1440x900)
    await captureShot(
      `${BASE_URL}/?demo=1&view=tree`,
      join(ASSETS_DIR, 'screenshot-tree.png'),
      1440,
      900,
      3500
    );

    // 2. My Setup / Config Inspection with a focused node (1440x900)
    await captureShot(
      `${BASE_URL}/?demo=1&focus=mcp:context7`,
      join(ASSETS_DIR, 'screenshot-config.png'),
      1440,
      900,
      3500
    );

    // 3. Docs Modal (1440x900)
    await captureShot(
      `${BASE_URL}/?demo=1&docs=open`,
      join(ASSETS_DIR, 'screenshot-docs.png'),
      1440,
      900,
      3500
    );

    // 4. Social preview (1280x640)
    await captureShot(
      `${BASE_URL}/?demo=1&view=tree`,
      join(ASSETS_DIR, 'ambit-social-preview.png'),
      1280,
      640,
      3500
    );

    // Copy to social-preview.png and public/social-preview.png
    copyFileSync(join(ASSETS_DIR, 'ambit-social-preview.png'), join(ASSETS_DIR, 'social-preview.png'));
    if (existsSync(join(process.cwd(), 'public'))) {
      copyFileSync(join(ASSETS_DIR, 'ambit-social-preview.png'), join(process.cwd(), 'public', 'social-preview.png'));
    }

    console.log('🎉 All screenshots generated successfully!');
  } finally {
    server.kill();
  }
}

main().catch(err => {
  console.error('❌ Error capturing screenshots:', err);
  process.exit(1);
});
