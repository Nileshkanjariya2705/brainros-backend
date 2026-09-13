import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGETS = [
  { name: 'JEE', description: 'Joint Entrance Examination (Engineering)' },
  { name: 'CET', description: 'Common Entrance Test (State Level)' },
  { name: 'NEET', description: 'National Eligibility cum Entrance Test (Medical)' },
  { name: 'NEET and JEE', description: 'NEET and JEE Combo' },
  { name: 'NEET and State CET', description: 'NEET and State CET Combo' },
  { name: 'JEE and State CET', description: 'JEE and State CET Combo' },
  { name: 'JEE, NEET and State CET', description: 'JEE, NEET and State CET All-in-One Combo' },
];

async function main() {
  console.log('Seeding / Upserting Target Exams in database...');
  for (const target of TARGETS) {
    const upserted = await prisma.examTarget.upsert({
      where: { name: target.name },
      update: { description: target.description },
      create: { name: target.name, description: target.description },
    });
    console.log(`- [${upserted.id}] ${upserted.name}`);
  }

  const allTargets = await prisma.examTarget.findMany();
  console.log('\nTotal Exam Targets in DB:', allTargets.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
