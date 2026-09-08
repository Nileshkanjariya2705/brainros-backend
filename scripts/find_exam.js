const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const exams = await prisma.exam.findMany({
    select: { id: true, title: true, status: true, createdAt: true }
  });
  console.log('Exams in DB:', JSON.stringify(exams, null, 2));

  // Let's also check questions if any
  const questionsCount = await prisma.question.count();
  console.log('Total Questions in DB:', questionsCount);
}

main().catch(console.error).finally(() => prisma.$disconnect());
