import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://j0nes-l.github.io',
  base: '/snapspace-viewer',
  output: 'static',
  vite: {
    server: {
      proxy: {
        '/api-proxy': {
          target: 'https://api.00224466.xyz',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-proxy/, '/snapspace'),
        },
      },
    },
  },
});
