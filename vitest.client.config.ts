import { defineConfig } from 'vitest/config';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin({ ssr: false })],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.client.test.tsx'],
  },
});
