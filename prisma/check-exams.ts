import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const exams = await prisma.exam.findMany({
    include: {
      status: true,
      examTarget: true,
      schedules: {
        include: {
          examVersion: true,
        },
      },
      _count: {
        select: {
          examQuestions: true,
          attempts: true,
        },
      },
    },
  });

  console.log(`Found ${exams.length} exams in DB:`);
  for (const e of exams) {
    console.log(`\nExam: "${e.title}" (ID: ${e.id})`);
    console.log(`- Target: ${e.examTarget?.name} (Target ID: ${e.examTargetId})`);
    console.log(`- Status: ${e.status.name} (Status ID: ${e.statusId})`);
    console.log(`- Total Questions: ${e._count.examQuestions}`);
    console.log(`- Duration: ${e.durationMinutes} mins`);
    console.log(`- Schedules count: ${e.schedules.length}`);
    for (const s of e.schedules) {
      console.log(`  * Schedule ID: ${s.id}, status: ${s.status}, start: ${s.startTime.toISOString()}, end: ${s.endTime.toISOString()}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
