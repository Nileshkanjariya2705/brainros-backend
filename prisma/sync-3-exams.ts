import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Syncing Database to Focus Exams: NEET, JEE ---');

  // 1. Upsert Exam Targets: NEET, JEE
  const targetDefs = [
    {
      name: 'NEET',
      description: 'National Eligibility cum Entrance Test (UG Medical)',
    },
    {
      name: 'JEE',
      description: 'Joint Entrance Examination (Engineering)',
    },
  ];

  const targetMap = new Map<string, any>();

  for (const t of targetDefs) {
    const existing = await prisma.examTarget.findFirst({
      where: { name: t.name },
    });
    if (existing) {
      const updated = await prisma.examTarget.update({
        where: { id: existing.id },
        data: { description: t.description },
      });
      targetMap.set(t.name, updated);
      console.log(`Updated ExamTarget: ${t.name} (${updated.id})`);
    } else {
      const created = await prisma.examTarget.create({
        data: t,
      });
      targetMap.set(t.name, created);
      console.log(`Created ExamTarget: ${t.name} (${created.id})`);
    }
  }

  // 2. Re-assign any orphaned / old targets (CAT, JEE_MAIN, etc) to JEE or NEET
  const oldTargets = await prisma.examTarget.findMany({
    where: {
      name: { notIn: ['NEET', 'JEE'] },
    },
    include: {
      subjects: true,
      exams: true,
      students: true,
      institutionBatches: true,
    },
  });

  const neet = targetMap.get('NEET');
  const jee = targetMap.get('JEE');

  for (const oldT of oldTargets) {
    console.log(`Migrating data from old target: ${oldT.name}...`);
    const newTargetId = oldT.name.includes('JEE') || oldT.name.includes('BITSAT') ? jee.id : neet.id;

    // Migrate Exams
    await prisma.exam.updateMany({
      where: { examTargetId: oldT.id },
      data: { examTargetId: newTargetId },
    });

    // Migrate Students
    await prisma.student.updateMany({
      where: { examTargetId: oldT.id },
      data: { examTargetId: newTargetId },
    });

    // Migrate InstitutionBatches
    await prisma.institutionBatch.updateMany({
      where: { examTargetId: oldT.id },
      data: { examTargetId: newTargetId },
    });

    // Migrate Subjects
    for (const sub of oldT.subjects) {
      const existingInNew = await prisma.subject.findFirst({
        where: { examTargetId: newTargetId, name: sub.name },
      });
      if (!existingInNew) {
        await prisma.subject.update({
          where: { id: sub.id },
          data: { examTargetId: newTargetId },
        });
      }
    }

    // Delete old unused target
    try {
      await prisma.examTarget.delete({ where: { id: oldT.id } });
      console.log(`Deleted obsolete target: ${oldT.name}`);
    } catch (err: any) {
      console.warn(`Could not delete target ${oldT.name}: ${err.message}`);
    }
  }

  // 3. Ensure Standard Subjects for NEET and JEE
  const neetSubjects = [
    { name: 'Physics (NEET)', code: 'NEET_PHY', displayOrder: 1 },
    { name: 'Chemistry (NEET)', code: 'NEET_CHEM', displayOrder: 2 },
    { name: 'Biology', code: 'NEET_BIO', displayOrder: 3 },
    { name: 'Botany', code: 'NEET_BOT', displayOrder: 4 },
    { name: 'Zoology', code: 'NEET_ZOO', displayOrder: 5 },
  ];

  const jeeSubjects = [
    { name: 'Physics (JEE)', code: 'JEE_PHY', displayOrder: 1 },
    { name: 'Chemistry (JEE)', code: 'JEE_CHEM', displayOrder: 2 },
    { name: 'Mathematics', code: 'JEE_MATH', displayOrder: 3 },
  ];

  const ensureSubjects = async (targetId: string, subjects: any[]) => {
    for (const sub of subjects) {
      const existing = await prisma.subject.findFirst({
        where: {
          examTargetId: targetId,
          OR: [{ name: sub.name }, { code: sub.code }],
        },
      });
      if (existing) {
        await prisma.subject.update({
          where: { id: existing.id },
          data: { name: sub.name, code: sub.code, displayOrder: sub.displayOrder, isActive: true },
        });
      } else {
        await prisma.subject.create({
          data: {
            examTargetId: targetId,
            name: sub.name,
            code: sub.code,
            displayOrder: sub.displayOrder,
            isActive: true,
          },
        });
      }
    }
  };

  await ensureSubjects(neet.id, neetSubjects);
  await ensureSubjects(jee.id, jeeSubjects);

  console.log('--- Successfully configured Focus Exams (NEET, JEE) & Subjects ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
