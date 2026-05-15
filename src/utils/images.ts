const R2_BASE = 'https://asset.coronalloop.jp';

export function r2Url(path: string): string {
  return R2_BASE + path;
}

export function r2ThumbUrl(path: string): string {
  const full = R2_BASE + path;
  const dot = full.lastIndexOf('.');
  if (dot === -1) return full;
  return `${full.slice(0, dot)}_480w${full.slice(dot)}`;
}
