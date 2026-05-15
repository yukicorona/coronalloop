#!/usr/bin/env node
/**
 * upload-to-r2.js
 * public/images/ の画像ファイルを Cloudflare R2 に同期アップロードする。
 * すでに R2 に存在するファイルはスキップ（スマートアップロード）。
 *
 * 使用方法:
 *   node --env-file=.env scripts/upload-to-r2.js
 */

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(__dirname, '..', '..', 'content', 'images');

// MIME type マッピング
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const CONCURRENT_UPLOADS = 20;

// 必須環境変数チェック
const required = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_BUCKET_NAME'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Error: 環境変数 ${key} が未設定です。.env ファイルを確認してください。`);
    process.exit(1);
  }
}

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

/** R2 の images/ プレフィックス以下の全オブジェクトキーを取得 */
async function listR2Objects() {
  const keys = new Set();
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'images/',
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) {
      keys.add(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

/** ディレクトリ以下の全ファイルを再帰的に列挙 */
function getAllFiles(dir, base = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(full, base));
    } else {
      files.push(full);
    }
  }
  return files;
}

/** 配列を chunk サイズに分割 */
function chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

async function main() {
  console.log('=== Cloudflare R2 スマートアップロード ===');
  console.log(`バケット: ${BUCKET}`);
  console.log(`ソース: ${IMAGES_DIR}`);

  // ローカルファイル一覧
  let localFiles;
  try {
    localFiles = getAllFiles(IMAGES_DIR);
  } catch {
    console.error(`Error: ${IMAGES_DIR} が見つかりません。`);
    process.exit(1);
  }
  console.log(`ローカルファイル: ${localFiles.length} 件`);

  // R2 既存オブジェクト取得
  console.log('R2 の既存オブジェクトを確認中...');
  const existingKeys = await listR2Objects();
  console.log(`R2 既存: ${existingKeys.size} 件`);

  // アップロード対象の絞り込み
  const toUpload = localFiles.filter(file => {
    const rel = relative(IMAGES_DIR, file).replace(/\\/g, '/');
    const key = `images/${rel}`;
    return !existingKeys.has(key);
  });

  const skipped = localFiles.length - toUpload.length;
  console.log(`スキップ（既存）: ${skipped} 件`);
  console.log(`アップロード対象: ${toUpload.length} 件`);

  if (toUpload.length === 0) {
    console.log('✅ アップロード不要。全ファイルは既に R2 に存在します。');
    return;
  }

  // バッチアップロード
  let uploaded = 0;
  let failed = 0;
  const batches = chunk(toUpload, CONCURRENT_UPLOADS);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    await Promise.all(batch.map(async (file) => {
      const rel = relative(IMAGES_DIR, file).replace(/\\/g, '/');
      const key = `images/${rel}`;
      const ext = extname(file).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      try {
        await client.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: readFileSync(file),
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }));
        uploaded++;
      } catch (err) {
        console.error(`  ✗ ${key}: ${err.message}`);
        failed++;
      }
    }));

    const progress = Math.round(((i + 1) / batches.length) * 100);
    process.stdout.write(`\r進捗: ${progress}% (${uploaded} 完了 / ${failed} 失敗)`);
  }

  console.log(`\n\n=== 完了 ===`);
  console.log(`アップロード: ${uploaded} 件`);
  console.log(`スキップ: ${skipped} 件`);
  if (failed > 0) console.log(`失敗: ${failed} 件`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
