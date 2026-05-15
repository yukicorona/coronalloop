import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

/**
 * Remark プラグイン: Markdown 内の /images/... パスを R2 公開 URL に変換する。
 * ビルド時に process.env.R2_PUBLIC_URL を参照する。
 * Cloudflare Pages では環境変数に R2_PUBLIC_URL を設定すること。
 */
function remarkR2Images() {
  const r2Base = (process.env.R2_PUBLIC_URL ?? 'https://asset.coronalloop.jp/').replace(/\/$/, '');

  function walk(node) {
    if (node.type === 'image' && typeof node.url === 'string' && node.url.startsWith('/images/')) {
      node.url = r2Base + node.url;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }

  return (tree) => walk(tree);
}

/**
 * Rehype プラグイン: R2 画像に srcset / sizes / data-original / lazy を付与する。
 *
 *   通常表示: _480w (mobile) / _1024w (PC) のリサイズ版
 *   ライトボックス: data-original に元画像フルURL を保持
 */
function rehypeResponsiveImages() {
  const r2Base = (process.env.R2_PUBLIC_URL ?? 'https://asset.coronalloop.jp/').replace(/\/$/, '');
  const R2_PREFIX = r2Base + '/images/';

  function makeResizedUrl(src, suffix) {
    const dotIdx = src.lastIndexOf('.');
    if (dotIdx === -1) return src + suffix + '.jpg';
    return src.slice(0, dotIdx) + suffix + src.slice(dotIdx);
  }

  function walk(node) {
    if (node.type === 'element' && node.tagName === 'img') {
      const src = node.properties.src;
      if (typeof src === 'string' && src.startsWith(R2_PREFIX)) {
        const url480  = makeResizedUrl(src, '_480w');
        const url960  = makeResizedUrl(src, '_960w');
        const url1024 = makeResizedUrl(src, '_1024w');

        node.properties['data-original'] = src;
        node.properties.srcset  = `${url480} 480w, ${url960} 960w, ${url1024} 1024w`;
        node.properties.sizes   = '(max-width: 768px) calc(100vw - 3rem), 800px';
        node.properties.src     = url1024;   // フォールバック & デフォルト表示
      }
      node.properties.loading  = node.properties.loading  || 'lazy';
      node.properties.decoding = node.properties.decoding || 'async';
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  return (tree) => walk(tree);
}

/**
 * Rehype プラグイン: <p> 内の <img> + 直後テキストを <figure>/<figcaption> に変換する。
 *
 * 単一画像: <figure class="entry-figure"><img><figcaption>...</figcaption></figure>
 * 複数画像: <div class="image-gallery"><figure>...</figure><figure>...</figure></div>
 * テキストは alt 属性にも設定し、ライトボックスのキャプション表示を有効にする。
 */
function rehypeImageCaption() {
  function buildReplacement(pChildren) {
    const segments = [];
    let current = null;

    for (const child of pChildren) {
      if (child.type === 'element' && child.tagName === 'img') {
        if (current) segments.push(current);
        current = { img: child, after: [] };
      } else if (current) {
        current.after.push(child);
      }
    }
    if (current) segments.push(current);
    if (segments.length === 0) return null;

    const figures = segments.map(({ img, after }) => {
      const captionText = after
        .map(n => (n.type === 'text' ? n.value : ''))
        .join('')
        .trim();

      if (captionText && !img.properties.alt) {
        img.properties.alt = captionText;
      }

      const figChildren = [img];
      if (captionText) {
        figChildren.push({
          type: 'element',
          tagName: 'figcaption',
          properties: {},
          children: [{ type: 'text', value: captionText }],
        });
      }

      return {
        type: 'element',
        tagName: 'figure',
        properties: { className: ['entry-figure'] },
        children: figChildren,
      };
    });

    if (figures.length === 1) return figures[0];
    return {
      type: 'element',
      tagName: 'div',
      properties: { className: ['image-gallery'] },
      children: figures,
    };
  }

  function walk(node) {
    if (!Array.isArray(node.children)) return;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (
        child.type === 'element' &&
        child.tagName === 'p' &&
        child.children?.some(c => c.type === 'element' && c.tagName === 'img')
      ) {
        const replacement = buildReplacement(child.children);
        if (replacement) {
          node.children[i] = replacement;
          continue;
        }
      }
      walk(child);
    }
  }

  return (tree) => walk(tree);
}

export default defineConfig({
  site: 'https://coronalloop.jp',
  output: 'static',

  integrations: [tailwind()],

  markdown: {
    remarkPlugins: [remarkR2Images],
    rehypePlugins: [rehypeResponsiveImages, rehypeImageCaption],
  },

  image: {
    // R2 カスタムドメインからのリモート画像を astro:assets で最適化可能にする
    remotePatterns: [
      { protocol: 'https', hostname: 'asset.coronalloop.jp' },
    ],
  },
});
