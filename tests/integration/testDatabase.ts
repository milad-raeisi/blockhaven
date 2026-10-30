import 'dotenv/config';

/** Integration tests always use a separate database so they never touch real worlds. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://blockhaven:blockhaven@localhost:5434/blockhaven_test?schema=public';
