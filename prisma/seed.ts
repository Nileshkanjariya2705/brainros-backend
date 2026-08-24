import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // ─── Roles ────────────────────────────────────────────────────
  console.log('Seeding roles...');
  const roles = [
    'SUPER_ADMIN',
    'ADMIN',
    'STUDENT',
    'PARENT',
    'INSTITUTION',
    'SALES_AGENT',
    'ACCOUNTANT',
  ];

  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }

  // ─── Exam Targets ────────────────────────────────────────────
  console.log('Seeding exam targets...');
  const examTargets = [
    { name: 'NEET', description: 'National Eligibility cum Entrance Test' },
    { name: 'JEE', description: 'Joint Entrance Examination' },
    { name: 'CET', description: 'Common Entrance Test' },
  ];

  for (const exam of examTargets) {
    await prisma.examTarget.upsert({
      where: { name: exam.name },
      update: { description: exam.description },
      create: exam,
    });
  }

  // ─── Student Classes ─────────────────────────────────────────
  console.log('Seeding student classes...');
  const classes = [
    { name: 'CLASS_11', description: '11th Standard / 1st PUC' },
    { name: 'CLASS_12', description: '12th Standard / 2nd PUC' },
    { name: 'DROPPER', description: 'Repeater / Dropper' },
  ];

  for (const cls of classes) {
    await prisma.studentClass.upsert({
      where: { name: cls.name },
      update: { description: cls.description },
      create: cls,
    });
  }

  // ─── Preferred Languages ─────────────────────────────────────
  console.log('Seeding preferred languages...');
  const languages = [
    { name: 'ENGLISH' },
    { name: 'KANNADA' },
    { name: 'HINDI' },
    { name: 'TAMIL' },
    { name: 'TELUGU' },
    { name: 'MARATHI' },
    { name: 'MALAYALAM' },
    { name: 'BENGALI' },
    { name: 'GUJARATI' },
  ];

  for (const lang of languages) {
    await prisma.preferredLanguage.upsert({
      where: { name: lang.name },
      update: {},
      create: lang,
    });
  }

  // ─── OTP Purposes ────────────────────────────────────────────
  console.log('Seeding OTP purposes...');
  const purposes = [
    { name: 'LOGIN', description: 'OTP authentication for logging in' },
    { name: 'REGISTRATION', description: 'OTP verification during new student signup' },
    { name: 'CHANGE_PHONE', description: 'OTP verification for updating mobile number' },
  ];

  for (const purp of purposes) {
    await prisma.otpPurpose.upsert({
      where: { name: purp.name },
      update: { description: purp.description },
      create: purp,
    });
  }

  // ─── Difficulty Levels ───────────────────────────────────────
  console.log('Seeding difficulty levels...');
  const difficultyLevels = [
    { name: 'EASY', displayOrder: 1 },
    { name: 'MEDIUM', displayOrder: 2 },
    { name: 'HARD', displayOrder: 3 },
    { name: 'VERY_HARD', displayOrder: 4 },
  ];

  for (const dl of difficultyLevels) {
    await prisma.difficultyLevel.upsert({
      where: { name: dl.name },
      update: { displayOrder: dl.displayOrder },
      create: dl,
    });
  }

  // ─── Question Types ──────────────────────────────────────────
  console.log('Seeding question types...');
  const questionTypes = [
    { name: 'Single Correct MCQ', code: 'SCQ' },
    { name: 'Multiple Correct MCQ', code: 'MCQ' },
    { name: 'Numerical', code: 'NUM' },
    { name: 'True/False', code: 'TF' },
    { name: 'Assertion & Reasoning', code: 'AR' },
  ];

  for (const qt of questionTypes) {
    await prisma.questionType.upsert({
      where: { code: qt.code },
      update: { name: qt.name },
      create: qt,
    });
  }

  // ─── Exam Statuses ───────────────────────────────────────────
  console.log('Seeding exam statuses...');
  const examStatuses = [
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'ACTIVE',
    'COMPLETED',
    'CANCELLED',
  ];

  for (const statusName of examStatuses) {
    await prisma.examStatus.upsert({
      where: { name: statusName },
      update: {},
      create: { name: statusName },
    });
  }

  // ─── Attempt Statuses ────────────────────────────────────────
  console.log('Seeding attempt statuses...');
  const attemptStatuses = [
    'NOT_STARTED',
    'IN_PROGRESS',
    'SUBMITTED',
    'AUTO_SUBMITTED',
    'EXPIRED',
    'INTERRUPTED',
    'RECOVERED',
  ];

  for (const statusName of attemptStatuses) {
    await prisma.attemptStatus.upsert({
      where: { name: statusName },
      update: {},
      create: { name: statusName },
    });
  }

  console.log('\n🌱 Seeding complete! ✅');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
