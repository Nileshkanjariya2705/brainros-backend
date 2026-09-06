import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export const config = { seed: 'ts-node prisma/seed.ts' };

export default defineConfig({
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
