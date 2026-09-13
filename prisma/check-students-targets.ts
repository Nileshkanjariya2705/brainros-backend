import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== All Exam Targets in Database ===');
  const targets = await prisma.examTarget.findMany({ orderBy: { name: 'asc' } });
  for (const t of targets) {
    const studentCount = await prisma.student.count({ where: { examTargetId: t.id } });
    console.log(`- [${t.id}] ${t.name}: ${studentCount} students`);
  }

  console.log('\n=== Total Students ===');
  const totalStudents = await prisma.student.count();
  console.log('Total students:', totalStudents);

  const sampleStudents = await prisma.student.findMany({
    take: 10,
    include: { examTarget: true },
  });
  console.log('\nSample students:');
  for (const s of sampleStudents) {
    console.log(`- ${s.name} (${s.studentCode}): Target = ${s.examTarget?.name || 'NONE'}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
