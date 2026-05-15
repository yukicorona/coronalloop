#!/usr/bin/env node
/**
 * new-post.js
 * 対話型の新規記事作成スクリプト。
 * Usage: node scripts/new-post.js
 *        npm run new  （package.json 経由）
 */

import readline from 'readline';
import { writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR   = join(__dirname, '..', 'src', 'content', 'blog');

const CATEGORIES = [
  '大規模自転車道',
  'CR・コース',
  'カスタム',
  '輪行旅',
  '情報・日常',
  '自転車',
  'IT/ICT話',
  '未分類',
];

// ─── readline helpers ────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask  = (q)         => new Promise(r => rl.question(q, r));
const askY = (q)         => ask(q).then(a => a.trim().toLowerCase() === 'y');

// ─── utils ───────────────────────────────────────────────────────────────────

function nowISO() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+09:00`;
}

function currentYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

function getExistingSlugs() {
  return new Set(readdirSync(BLOG_DIR).map(f => f.replace(/\.md$/, '')));
}

function yamlArr(items) {
  return items.length ? `[${items.map(s => `"${s.replace(/"/g, '\\"')}"`).join(', ')}]` : '[]';
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n┌──────────────────────────────────────┐');
  console.log('│  coronalloop  新規記事作成             │');
  console.log('└──────────────────────────────────────┘\n');

  const existingSlugs = getExistingSlugs();

  // ── スラッグ ──
  let slug;
  while (true) {
    slug = (await ask('スラッグ（URL識別子、英小文字・数字・ハイフンのみ）\n> ')).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      console.log('  ✗ 使用できる文字: 英小文字・数字・ハイフン\n');
      continue;
    }
    if (existingSlugs.has(slug)) {
      console.log(`  ✗ すでに存在します: ${slug}.md\n`);
      continue;
    }
    console.log(`  → https://coronalloop.jp/${slug}/\n`);
    break;
  }

  // ── タイトル ──
  const title = (await ask('記事タイトル\n> ')).trim();

  // ── カテゴリ ──
  console.log('\nカテゴリ（番号、複数はカンマ区切り、省略可）:');
  CATEGORIES.forEach((c, i) => console.log(`  ${i+1}. ${c}`));
  const catRaw = (await ask('> ')).trim();
  const categories = catRaw
    ? catRaw.split(',')
        .map(s => parseInt(s.trim()) - 1)
        .filter(i => i >= 0 && i < CATEGORIES.length)
        .map(i => CATEGORIES[i])
    : [];

  // ── タグ ──
  const tagRaw = (await ask('\nタグ（カンマ区切り、例: K3,サイクリングロード,兵庫県、省略可）\n> ')).trim();
  const tags = tagRaw ? tagRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  // ── 抜粋 ──
  const excerpt = (await ask('\n記事概要 excerpt（1〜2文、省略可）\n> ')).trim();

  // ── アイキャッチ ──
  const yyyymm  = currentYYYYMM();
  const eyeRaw  = (await ask(`\nアイキャッチ画像ファイル名（省略可、例: top.jpg → /images/${yyyymm}/top.jpg）\n> `)).trim();
  const featuredImage = eyeRaw
    ? `https://asset.coronalloop.jp/images/${yyyymm}/${eyeRaw}`
    : '';

  // ── Leafletマップ ──
  const hasMap = await askY('\nLeafletマップを挿入しますか? (y/N): ');

  // ── ドラフト ──
  const isDraft = await askY('ドラフトとして保存しますか? (y/N): ');

  rl.close();

  // ─── frontmatter 生成 ───────────────────────────────────────────────────────

  const lines = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `date: ${nowISO()}`,
    categories.length  ? `categories: ${yamlArr(categories)}` : null,
    tags.length        ? `tags: ${yamlArr(tags)}`              : null,
    excerpt            ? `excerpt: "${excerpt.replace(/"/g, '\\"')}"` : null,
    featuredImage      ? `featured_image: "${featuredImage}"`  : null,
    'type: "post"',
    `draft: ${isDraft}`,
    '---',
  ].filter(l => l !== null).join('\n');

  // ─── 地図テンプレート ────────────────────────────────────────────────────────

  const mapBlock = hasMap ? `
<div class="leaflet-map-container" data-leaflet-config='{"fitbounds": true, "zoomcontrol": true, "height": 450, "layers": [{"type": "kml", "src": "/kml/FILENAME.kml", "color": "red"}], "markers": [{"lat": 0.0, "lng": 0.0, "label": "起点"}, {"lat": 0.0, "lng": 0.0, "label": "終点"}], "elevation": {"src": "/kml/FILENAME.kml"}}'></div>

起点| （場所名）
---|---
終点| （場所名）

` : '\n';

  // ─── 本文テンプレート ─────────────────────────────────────────────────────────

  const body =
`${lines}
${mapBlock}## はじめに

（本文をここに書く）

## まとめ

<!-- 画像例: ![説明](/images/${yyyymm}/filename.jpg) -->
`;

  const filepath = join(BLOG_DIR, `${slug}.md`);
  writeFileSync(filepath, body, 'utf-8');

  // ─── 完了メッセージ ───────────────────────────────────────────────────────────

  console.log('\n');
  console.log('✅ 作成完了');
  console.log(`   ファイル : ${filepath}`);
  console.log(`   URL      : https://coronalloop.jp/${slug}/`);
  console.log(`   画像パス : /images/${yyyymm}/ファイル名.jpg`);
  if (hasMap) {
    console.log('\n📍 マップ設定:');
    console.log('   site/public/kml/ に KML/GPX を配置し、');
    console.log('   data-leaflet-config 内の FILENAME.kml を実際のファイル名に書き換えてください');
    console.log('   マーカーの lat/lng も実際の座標に変更してください');
  }
  console.log('\n次のステップ:');
  console.log('  1. 上記ファイルを開いて本文を執筆');
  console.log('  2. 画像を content/images/inbox/ に置く');
  console.log(`  3. npm run sync   （画像を整理 → R2アップロード）`);
  console.log(`  4. npm run publish （git push → Cloudflare 自動デプロイ）`);
}

main().catch(err => {
  rl.close();
  console.error('\n✗ エラー:', err.message);
  process.exit(1);
});
