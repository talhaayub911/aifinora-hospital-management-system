import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env.js';
import { seedDatabase } from '../src/seed/seedDatabase.js';

const prisma = new PrismaClient();
const reset = !process.argv.includes('--no-reset');

try {
  const summary = await seedDatabase(prisma, {
    reset,
    writeProofFiles: true,
    uploadDir: env.uploadDir,
  });
  console.log('AI Finora demonstration database seeded successfully.');
  console.table(summary);
} catch (error) {
  console.error('AI Finora database seed failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
