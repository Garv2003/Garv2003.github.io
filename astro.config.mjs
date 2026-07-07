import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build
export default defineConfig({
  site: 'https://garv2003.github.io',
  integrations: [react()],
});
