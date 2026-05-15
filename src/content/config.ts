import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    excerpt: z.string().optional().default(''),
    type: z.string().optional().default('post'),
    draft: z.boolean().optional().default(false),
    featured_image: z.string().optional(),
  }),
});

export const collections = { blog };
