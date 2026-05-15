#!/usr/bin/env node
/**
 * publish.js
 * 変更ファイルを確認し、git commit + push を一括実行する。
 * 画像のアップロードは含まない（先に npm run sync を実行すること）。
 *
 * Usage:
 *   node scripts/publish.js
 *   npm run publish  （package.json 経由）
 */

import readline from 'readline';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR  = join(__dirname, '..');

// ─── utils ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      cwd: SITE_DIR,
      encoding: 'utf-8',
      stdio: opts.capture ? 'pipe' : 'inherit',
    });
    return out ?? '';
  } catch (err) {
    if (opts.ignoreError) return '';
    throw err;
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌──────────────────────────────────────┐');
  console.log('│  coronalloop  公開（git push）         │');
  console.log('└──────────────────────────────────────┘\n');

  // git status 確認
  const status = run('git status --short', { capture: true, ignoreError: true }).trim();

  if (!status) {
    console.log('✅ 変更なし。公開するファイルがありません。');
    return;
  }

  console.log('変更ファイル:');
  status.split('\n').forEach(line => console.log('  ' + line));

  // コミットメッセージ入力
  const rawMsg = (await ask('\nコミットメッセージ（省略時: "feat: 記事・コンテンツを更新"）: ')).trim();
  const msg    = rawMsg || 'feat: 記事・コンテンツを更新';

  // git add（記事・KMLのみ対象）
  console.log('\n  $ git add src/content/blog/ public/kml/');
  run('git add src/content/blog/ public/kml/');

  // 他に追加済みのものがあれば含める
  const staged = run('git diff --cached --name-only', { capture: true, ignoreError: true }).trim();
  if (!staged) {
    console.log('\n⚠ ステージされたファイルがありません。コミットをスキップします。');
    return;
  }
  console.log('\nコミット対象:');
  staged.split('\n').forEach(f => console.log('  ' + f));

  // git commit
  try {
    run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
  } catch {
    console.log('\n⚠ コミット済みか変更なし。push のみ試みます。');
  }

  // git push
  console.log('\n  $ git push origin master');
  run('git push origin master');

  console.log('\n✅ 公開完了！');
  console.log('   Cloudflare Pages がビルドを開始します（通常 1〜3 分）');
  console.log('   https://coronalloop.jp/');
}

main().catch(err => {
  console.error('\n✗ エラー:', err.message);
  process.exit(1);
});
