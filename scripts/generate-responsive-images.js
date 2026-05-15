#!/usr/bin/env node
/**
 * generate-responsive-images.js
 *
 * Y:/claude/blogmove/images/ にある元画像を
 *   _480w.jpg  (スマートフォン用)
 *   _1024w.jpg (PC用)
 * にリサイズして Cloudflare R2 へアップロードする。
 *
 * 使用方法:
 *   node --env-file=.env scripts/generate-responsive-images.js
 *
 * オプション:
 *   --force   既に R2 に存在するファイルも再生成・再アップロード
 *   --dry-run リサイズ・アップロードせず対象ファイル数だけ表示
 */

import sharp from 'sharp';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __scriptDir = dirname(__filename);

// ========== 設定 ==========
// 元画像のディレクトリ
const SOURCE_DIR = join(__scriptDir, '..', '..', 'content', 'images');

// 生成するサイズ定義
const SIZES = [
  { suffix: '_480w',  width: 480  },
  { suffix: '_960w',  width: 960  },
  { suffix: '_1024w', width: 1024 },
];

const JPEG_QUALITY   = 82;
const CONCURRENT     = 8;
const FORCE          = process.argv.includes('--force');
const DRY_RUN        = process.argv.includes('--dry-run');
const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ========== R2 接続 ==========
const required = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ 環境変数 ${key} が設定されていません。--env-file=.env を確認してください。`);
    process.exit(1);
  }
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;

// ========== 既存 R2 キー取得 ==========
async function listExistingKeys() {
  const keys = new Set();
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'images/',
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) keys.add(obj.Key);
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

// ========== 画像ファイル列挙 ==========
function collectImages(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectImages(full));
    } else if (SUPPORTED_EXTS.has(extname(entry).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

// ========== リサイズ & アップロード ==========
async function processImage(srcPath, existingKeys) {
  const rel      = relative(SOURCE_DIR, srcPath).replace(/\\/g, '/'); // YYYY/MM/file.jpg
  const ext      = extname(rel).toLowerCase();                         // .jpg
  const noExt    = rel.slice(0, -ext.length);                          // YYYY/MM/file
  const results  = [];

  for (const { suffix, width } of SIZES) {
    const destKey = `images/${noExt}${suffix}${ext}`;  // images/YYYY/MM/file_480w.jpg

    if (!FORCE && existingKeys.has(destKey)) {
      results.push({ key: destKey, status: 'skip' });
      continue;
    }

    if (DRY_RUN) {
      results.push({ key: destKey, status: 'dry-run' });
      continue;
    }

    try {
      // 元画像のメタデータを取得してオリジナルが生成サイズより小さければスキップ
      const meta = await sharp(srcPath).metadata();
      if (meta.width && meta.width <= width) {
        // 元画像がすでに小さい場合はそのままアップロード
        const buf = readFileSync(srcPath);
        await s3.send(new PutObjectCommand({
          Bucket:       BUCKET,
          Key:          destKey,
          Body:         buf,
          ContentType:  ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg'),
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        results.push({ key: destKey, status: 'passthrough' });
        continue;
      }

      // リサイズ
      const buf = await sharp(srcPath)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, progressive: true })
        .toBuffer();

      await s3.send(new PutObjectCommand({
        Bucket:       BUCKET,
        Key:          destKey,
        Body:         buf,
        ContentType:  'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }));

      results.push({ key: destKey, status: 'uploaded', bytes: buf.length });
    } catch (err) {
      results.push({ key: destKey, status: 'error', error: err.message });
    }
  }
  return results;
}

// ========== メイン ==========
async function main() {
  console.log(`📁 元画像ディレクトリ: ${SOURCE_DIR}`);
  if (DRY_RUN) console.log('🔍 DRY-RUN モード（実際のアップロードなし）');
  if (FORCE)   console.log('⚡ FORCE モード（既存ファイルを再生成）');

  const allImages = collectImages(SOURCE_DIR);
  console.log(`🖼  元画像: ${allImages.length} ファイル`);
  console.log(`📐 生成サイズ: ${SIZES.map(s => s.width + 'w').join(', ')}`);

  let existingKeys = new Set();
  if (!FORCE && !DRY_RUN) {
    process.stdout.write('📋 R2 既存ファイル確認中...');
    existingKeys = await listExistingKeys();
    console.log(` ${existingKeys.size} ファイル確認済み`);
  }

  const totalTasks = allImages.length * SIZES.length;
  let done = 0, uploaded = 0, skipped = 0, errors = 0;

  // 並列処理
  async function worker(queue) {
    while (queue.length > 0) {
      const srcPath = queue.shift();
      const results = await processImage(srcPath, existingKeys);
      for (const r of results) {
        done++;
        if (r.status === 'uploaded' || r.status === 'passthrough') uploaded++;
        else if (r.status === 'skip' || r.status === 'dry-run') skipped++;
        else if (r.status === 'error') {
          errors++;
          console.error(`\n❌ ${r.key}: ${r.error}`);
        }
        if (done % 50 === 0 || done === totalTasks) {
          process.stdout.write(`\r⏳ ${done}/${totalTasks}  アップロード:${uploaded}  スキップ:${skipped}  エラー:${errors}  `);
        }
      }
    }
  }

  const queue = [...allImages];
  const workers = Array.from({ length: CONCURRENT }, () => worker(queue));
  await Promise.all(workers);

  console.log(`\n\n✅ 完了  アップロード:${uploaded}  スキップ:${skipped}  エラー:${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
