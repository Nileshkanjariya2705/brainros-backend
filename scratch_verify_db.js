const path = require('path');
const { PrismaClient } = require(path.join(process.cwd(), 'node_modules/@prisma/client'));
const prisma = new PrismaClient();

async function main() {
  console.log('--- Inspecting Database Post-Upload State ---');
  const scheduleId = '7bb2d288-93a0-446c-b57e-b2381bafe36f';
  const examId = '0374f9e0-f8d7-4f6f-b557-9ae98099795e';

  const schedule = await prisma.examSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, status: true, hasAnswerKey: true, answerKeyUploadedAt: true }
  });
  console.log('Schedule:', JSON.stringify(schedule, null, 2));

  const publication = await prisma.examResultPublication.findUnique({
    where: { examId: examId },
    select: { id: true, status: true, totalStudents: true, evaluatedStudents: true }
  });
  console.log('Result Publication:', JSON.stringify(publication, null, 2));

  const attempts = await prisma.examAttempt.findMany({
    where: { examId: examId },
    select: { id: true, status: true, totalScore: true }
  });
  console.log('Exam Attempts Count:', attempts.length);
  attempts.forEach((a, i) => {
    console.log(`  Attempt ${i + 1}: ID=${a.id} Status=${a.status} Score=${a.totalScore}`);
  });

  const results = await prisma.result.findMany({
    where: { examId: examId },
    select: { id: true, totalScore: true, rank: true, percentile: true }
  });
  console.log('Persisted Results Count:', results.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
