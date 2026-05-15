/** カテゴリ/タグ名を URL-safe なスラッグに変換する */
export function toSlug(name: string): string {
  return name
    .replace(/[/\\]/g, '-')   // スラッシュ・バックスラッシュ → ハイフン（IT/ICT話 対策）
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
