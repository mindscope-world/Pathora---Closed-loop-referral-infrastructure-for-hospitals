import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'server/db/schema.prisma',
  migrations: {
    path: 'server/db/migrations',
    seed: 'tsx server/db/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
