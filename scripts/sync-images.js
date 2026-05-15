#!/usr/bin/env node
/**
 * sync-images.js
 * content/images/inbox/ の画像を YYYY/MM/ に整理して R2 へアップロードする。
 *
 * Usage:
 *   node --env-file=.env scripts/sync-images.js
 *   npm run sync  （package.json 経由）
 *
 * フロー:
 *   1. inbox/ 内の画像をファイル更新日時で YYYY/MM/ に振り分けて移動
 *   2. ファイル名を英数字ハイフン系に正規化（日本語・スペース除去）
 *   3. upload-to-r2.js              → 元画像を R2 にアップロード（増分のみ）
 *   4. generate-responsive-images.js → _480w/_960w/_1024w を生成して R2 へ（増分のみ）
 *   5. Markdown に貼り付けられるパスを一覧表示
 */

import readline from 'readline';
import { readdirSync, statSync, renameSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, extname, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const SITE_DIR    = join(__dirname, '..');
const IMAGES_ROOT = join(__dirname, '..', '..', 'content', 'images');
const INBOX_DIR   = join(IMAGES_ROOT, 'inbox');
const SUPPORTED   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// ─── utils ───────────────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^\w.-]/g, '_')    // 英数字・ドット・ハイフン・アンダースコア以外を _
    .replace(/_+/g, '_')         // 連続アンダースコアをまとめる
    .replace(/^_+/, '')          // 先頭の _ を除去
    .replace(/_+(?=\.)/, '');    // 拡張子直前の _ を除去
}

function getDestParts(filepath) {
  const mtime = statSync(filepath).mtime;
  const year  = String(mtime.getFullYear());
  const month = String(mtime.getMonth() + 1).padStart(2, '0');
  return { year, month };
}

function run(cmd) {
  console.log(`\n  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: SITE_DIR });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌──────────────────────────────────────┐');
  console.log('│  coronalloop  画像取り込み & R2 同期  │');
  console.log('└──────────────────────────────────────┘\n');

  // inbox フォルダが存在しない場合は作成して終了
  if (!existsSync(INBOX_DIR)) {
    mkdirSync(INBOX_DIR, { recursive: true });
    writeFileSync(join(INBOX_DIR, '.gitkeep'), '');
    console.log(`📁 inbox フォルダを作成しました:`);
    console.log(`   ${INBOX_DIR}`);
    console.log('\n取り込みたい画像をここに置いてから再実行してください。');
    return;
  }

  // inbox 内の対象ファイルを収集
  const inboxFiles = readdirSync(INBOX_DIR)
    .filter(f => !f.startsWith('.') && SUPPORTED.has(extname(f).toLowerCase()))
    .map(f => join(INBOX_DIR, f));

  if (inboxFiles.length === 0) {
    console.log(`📭 inbox に画像がありません。`);
    console.log(`   ${INBOX_DIR}\n`);
    const ans = await ask('既存画像の R2 同期だけ実行しますか? (y/N): ');
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('キャンセルしました。');
      return;
    }
    console.log('\n【R2 同期のみ実行】');
    run('node --env-file=.env scripts/upload-to-r2.js');
    run('node --env-file=.env scripts/generate-responsive-images.js');
    console.log('\n✅ 同期完了');
    return;
  }

  // ── ファイルを YYYY/MM/ に振り分け ──────────────────────────────────────────

  console.log(`📷 ${inboxFiles.length} 枚の画像を取り込みます\n`);

  const moved = [];

  for (const src of inboxFiles) {
    const ext         = extname(src).toLowerCase();
    const nameNoExt   = basename(src, extname(src));
    const cleanName   = sanitizeFilename(nameNoExt) + ext;
    const { year, month } = getDestParts(src);
    const destDir     = join(IMAGES_ROOT, year, month);

    mkdirSync(destDir, { recursive: true });

    // 同名ファイルが存在する場合はタイムスタンプサフィックスを付与
    let destPath = join(destDir, cleanName);
    if (existsSync(destPath)) {
      destPath = join(destDir, `${sanitizeFilename(nameNoExt)}_${Date.now()}${ext}`);
    }

    renameSync(src, destPath);

    const mdPath = `/images/${year}/${month}/${basename(destPath)}`;
    moved.push(mdPath);
    console.log(`  ✓ ${basename(src).padEnd(40)} → ${mdPath}`);
  }

  // ── R2 アップロード ─────────────────────────────────────────────────────────

  console.log('\n【Step 1/2】 元画像を R2 にアップロード');
  run('node --env-file=.env scripts/upload-to-r2.js');

  console.log('\n【Step 2/2】 レスポンシブ画像を生成して R2 にアップロード');
  run('node --env-file=.env scripts/generate-responsive-images.js');

  // ── 完了レポート ────────────────────────────────────────────────────────────

  console.log('\n');
  console.log('✅ 取り込み完了！  Markdown に貼り付けるパス:\n');
  moved.forEach(p => console.log(`  ![説明](${p})`));
  console.log('\n次のステップ:');
  console.log('  1. 上記パスを記事 .md に貼り付けて本文を仕上げる');
  console.log('  2. npm run publish  で git push → Cloudflare 自動デプロイ');
}

main().catch(err => {
  console.error('\n✗ エラー:', err.message);
  process.exit(1);
});
