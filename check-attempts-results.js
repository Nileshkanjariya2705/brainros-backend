const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const attempts = await prisma.attempt.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      exam: {
        include: {
          schedules: true,
        },
      },
      status: true,
      result: true,
    },
  });

  for (const a of attempts) {
    console.log('Attempt ID:', a.id);
    console.log('  Exam Title:', a.exam.title);
    console.log('  Exam Schedules:', a.exam.schedules?.length);
    console.log('  Attempt Status:', a.status?.name);
    console.log('  Result Status:', a.result?.resultStatus);
    console.log('  Published At:', a.result?.publishedAt);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
