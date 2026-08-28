import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Syncing Database to 3 Focus Exams: NEET, JEE, CAT ---');

  // 1. Upsert 3 Exam Targets: NEET, JEE, CAT
  const targetDefs = [
    {
      name: 'NEET',
      description: 'National Eligibility cum Entrance Test (UG Medical)',
    },
    {
      name: 'JEE',
      description: 'Joint Entrance Examination (Engineering)',
    },
    {
      name: 'CAT',
      description: 'Common Admission & Entrance Test',
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

  // 2. Re-assign any orphaned / old targets (JEE_MAIN, JEE_ADVANCED, BITSAT, CET) to JEE or CAT
  const oldTargets = await prisma.examTarget.findMany({
    where: {
      name: { notIn: ['NEET', 'JEE', 'CAT'] },
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
  const cat = targetMap.get('CAT');

  for (const oldT of oldTargets) {
    console.log(`Migrating data from old target: ${oldT.name}...`);
    const newTargetId = oldT.name.includes('JEE') || oldT.name.includes('BITSAT') ? jee.id : cat.id;

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
      // Check if subject with same name already exists in target
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

  // 3. Ensure Standard Subjects for each of the 3 Targets
  // NEET -> Physics, Chemistry, Biology (Botany & Zoology)
  const neetSubjects = [
    { name: 'Physics (NEET)', code: 'NEET_PHY', displayOrder: 1 },
    { name: 'Chemistry (NEET)', code: 'NEET_CHEM', displayOrder: 2 },
    { name: 'Biology', code: 'NEET_BIO', displayOrder: 3 },
    { name: 'Botany', code: 'NEET_BOT', displayOrder: 4 },
    { name: 'Zoology', code: 'NEET_ZOO', displayOrder: 5 },
  ];

  // JEE -> Physics, Chemistry, Mathematics
  const jeeSubjects = [
    { name: 'Physics (JEE)', code: 'JEE_PHY', displayOrder: 1 },
    { name: 'Chemistry (JEE)', code: 'JEE_CHEM', displayOrder: 2 },
    { name: 'Mathematics', code: 'JEE_MATH', displayOrder: 3 },
  ];

  // CAT -> Physics, Chemistry, Mathematics, Biology
  const catSubjects = [
    { name: 'Physics (CAT)', code: 'CAT_PHY', displayOrder: 1 },
    { name: 'Chemistry (CAT)', code: 'CAT_CHEM', displayOrder: 2 },
    { name: 'Mathematics (CAT)', code: 'CAT_MATH', displayOrder: 3 },
    { name: 'Biology (CAT)', code: 'CAT_BIO', displayOrder: 4 },
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
  await ensureSubjects(cat.id, catSubjects);

  console.log('--- Successfully configured 3 Focus Exams (NEET, JEE, CAT) & Subjects ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
