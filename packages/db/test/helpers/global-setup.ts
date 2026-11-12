import { resetAndMigrateTestDatabase } from './test-db.js';

export default async function globalSetup(): Promise<void> {
  await resetAndMigrateTestDatabase();
}
