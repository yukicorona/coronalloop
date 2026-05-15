# 画像管理ガイド

## 概要

本サイトの画像は **Cloudflare R2** (`asset.coronalloop.jp`) で管理されます。  
Markdown 内の画像パスはビルド時に自動的に R2 の公開 URL へ変換されます。

---

## 記事内での画像記述ルール

### ✅ 推奨記法

```markdown
![代替テキスト](/images/YYYY/MM/ファイル名.jpg)
```

**例:**
```markdown
![K9Xと天橋立](/images/2024/10/20240914_090656.jpg)
```

ビルド時に自動変換されます:
```
/images/2024/10/20240914_090656.jpg
→ http://asset.coronalloop.jp/images/2024/10/20240914_090656.jpg
```

### ⚠️ 非推奨（動作はするが管理が困難）

```markdown
![代替テキスト](http://asset.coronalloop.jp/images/2024/10/photo.jpg)
```
フルURLを直接書くと R2 ドメインが変わった際に全記事修正が必要になります。

---

## ファイル命名・配置ルール

| 項目 | ルール |
|---|---|
| 配置パス | `public/images/YYYY/MM/ファイル名.ext` |
| 年/月 | 撮影日または投稿日の年月 |
| ファイル名 | 英数字・アンダースコア・ハイフンのみ（日本語不可） |
| 対応形式 | `.jpg` / `.jpeg` / `.png` / `.gif` / `.webp` |
| リサイズ版 | 不要（R2 はオリジナルのみ保管） |

**例:**
```
public/images/
├── 2024/
│   ├── 04/
│   │   ├── 20240420_144808.jpg
│   │   └── 20240420_144824.jpg
│   └── 10/
│       └── 20241026_081017.jpg
└── 2025/
    └── 10/
        └── 20251026_123456.jpg
```

---

## 画像のアップロード方法

### 方法 1: Node.js スクリプト（少数ファイル・増分更新）

```bash
# .env が設定済みであること
node --env-file=.env scripts/upload-to-r2.js
```

- `public/images/` 内のファイルをスキャン
- R2 に存在しないファイルのみアップロード（スマートアップロード）
- 最大 20 並列アップロード

### 方法 2: rclone（数百MB〜数GB の一括アップロード）

```bash
# rclone のインストール
# https://rclone.org/downloads/

# rclone の設定（~/.config/rclone/rclone.conf）
[r2]
type = s3
provider = Cloudflare
access_key_id = YOUR_ACCESS_KEY_ID
secret_access_key = YOUR_SECRET_ACCESS_KEY
endpoint = https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
acl = private

# アップロード（公開ディレクトリ構造を維持）
rclone copy public/images/ r2:coronalloop/images/ --progress --transfers=20
```

### 方法 3: AWS CLI（S3 互換）

```bash
# AWS CLI のインストール
# https://aws.amazon.com/cli/

# 環境変数設定
export AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY

# 同期アップロード
aws s3 sync public/images/ s3://coronalloop/images/ \
  --endpoint-url https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com \
  --cache-control "public, max-age=31536000, immutable"
```

---

## Cloudflare Pages ビルド設定

Pages の環境変数に以下を設定すること（ダッシュボード → Settings → Environment variables）:

| 変数名 | 値 |
|---|---|
| `R2_PUBLIC_URL` | `http://asset.coronalloop.jp/` |

設定しない場合はデフォルト値 `http://asset.coronalloop.jp/` が使用されます。

---

## ビルド時間への影響

- 画像は R2 から**ビルド時には取得しない**（静的 URL 変換のみ）
- ビルド時間に影響なし
- 画像の表示はブラウザが R2 から直接取得

### astro:assets による最適化（将来対応）

現状の plain Markdown では `<img>` タグとして出力されます。  
`.mdx` ファイルに移行すれば `<Image>` コンポーネントで WebP 変換・遅延読み込みが可能です。

```mdx
---
import { Image } from 'astro:assets';
---

<Image 
  src="http://asset.coronalloop.jp/images/2024/04/photo.jpg"
  width={800} 
  height={600} 
  alt="説明"
  format="webp"
/>
```

---

## 注意事項

- `public/images/` は `.gitignore` に追加済み（git には含まれない）
- ローカル開発時も `public/images/` に画像を置けば表示可能（ビルド時は R2 URL に変換）
- R2 の認証情報は `.env` ファイルに記載し、絶対に git にコミットしないこと
