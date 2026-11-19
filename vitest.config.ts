import { defineConfig } from 'vitest/config';

const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  // Always the dedicated test database, whatever the shell or .env says.
  DATABASE_URL: 'postgresql://pathora:pathora@localhost:5432/pathora_test',
  APP_URL: 'http://localhost:3000',
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0123456789',
  COOKIE_SECRET: 'test-cookie-secret-test-cookie-0123456789',
  FIELD_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
};

// globalSetup runs in the main process, which does not receive `test.env`.
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['server/test/globalSetup.ts'],
    // DB tests share one database; run files serially.
    fileParallelism: false,
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts'],
    env: testEnv,
  },
});
