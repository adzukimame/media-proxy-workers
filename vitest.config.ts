import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', 'test/**/*.?(c|m)[jt]s?(x)'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
