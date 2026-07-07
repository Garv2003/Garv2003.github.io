import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.string(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    ogImage: z.string().default('/og-default.png'),
  }),
});

export const collections = { blog };
