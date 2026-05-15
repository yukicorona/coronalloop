import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const allEntries = await getCollection('blog', ({ data }) => !data.draft);
  const posts = allEntries
    .filter(e => e.data.type === 'post')
    .map(e => ({
      title: e.data.title,
      slug: e.slug,
      excerpt: e.data.excerpt ?? '',
      categories: e.data.categories ?? [],
      tags: e.data.tags ?? [],
    }));

  return new Response(JSON.stringify(posts), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
