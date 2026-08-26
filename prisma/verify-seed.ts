import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🔍 BRAINROS DATABASE INTEGRITY & CONSTRAINT VERIFICATION');
  console.log('════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  const test = (name: string, condition: boolean, detail?: string) => {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  };

  console.log('--- 1. MASTER DATA & REFERENCE INTEGRITY ---');
  const roleCount = await prisma.role.count();
  test('Roles seeded', roleCount >= 6, `Count: ${roleCount}`);

  const langCount = await prisma.preferredLanguage.count();
  test('Preferred Languages seeded', langCount >= 4, `Count: ${langCount}`);

  const targetCount = await prisma.examTarget.count();
  test('Exam Targets seeded', targetCount >= 3, `Count: ${targetCount}`);

  const stateCount = await prisma.state.count();
  test('States seeded', stateCount >= 5, `Count: ${stateCount}`);

  const districtCount = await prisma.district.count();
  test('Districts seeded with State FKs', districtCount >= 20, `Count: ${districtCount}`);

  console.log('\n--- 2. USERS, ROLES & STUDENT PROFILES ---');
  const userCount = await prisma.user.count();
  test('User accounts created', userCount >= 30, `Count: ${userCount}`);

  const superAdmin = await prisma.user.findUnique({
    where: { email: 'superadmin@brainros.test' },
    include: { userRoles: { include: { role: true } } },
  });
  test('Super Admin exists and is active', Boolean(superAdmin && superAdmin.isActive));
  test(
    'Super Admin has SUPER_ADMIN role',
    Boolean(superAdmin?.userRoles.some((r) => r.role.name === 'SUPER_ADMIN')),
  );

  const studentCount = await prisma.student.count();
  test('Student profiles created', studentCount >= 25, `Count: ${studentCount}`);

  const allStudents = await prisma.student.findMany({ include: { user: true } });
  const orphanedStudents = allStudents.filter((s) => !s.user);
  test('Zero orphaned student profiles without User records', orphanedStudents.length === 0);

  const parentLinks = await prisma.parentStudentLink.count();
  test('Parent-Student links populated', parentLinks >= 5, `Count: ${parentLinks}`);

  console.log('\n--- 3. INSTITUTIONS & B2B STRUCTURE ---');
  const instCount = await prisma.institution.count();
  test('Institutions populated', instCount >= 4, `Count: ${instCount}`);

  const batchCount = await prisma.institutionBatch.count();
  test('Institution Batches created', batchCount >= 6, `Count: ${batchCount}`);

  const batchStudents = await prisma.batchStudent.count();
  test('Students mapped to Batches', batchStudents >= 15, `Count: ${batchStudents}`);

  console.log('\n--- 4. QUESTION BANK & TRANSLATIONS ---');
  const questionCount = await prisma.question.count();
  test('Questions in Question Bank', questionCount >= 25, `Count: ${questionCount}`);

  const optionCount = await prisma.questionOption.count();
  test('Question Options populated', optionCount >= 80, `Count: ${optionCount}`);

  const translationCount = await prisma.questionTranslation.count();
  test('Question Translations (Multi-lingual)', translationCount >= 30, `Count: ${translationCount}`);

  const answerCount = await prisma.questionAnswer.count();
  test('Question Answers configured for all questions', answerCount === questionCount);

  console.log('\n--- 5. EXAMS, BLUEPRINTS & SNAPSHOTS ---');
  const examCount = await prisma.exam.count();
  test('Exams created', examCount >= 3, `Count: ${examCount}`);

  const examQuestionCount = await prisma.examQuestion.count();
  test('Exam Questions linked to sections', examQuestionCount >= 30, `Count: ${examQuestionCount}`);

  const versionCount = await prisma.examVersion.count();
  test('Exam Version Snapshots created', versionCount >= 3, `Count: ${versionCount}`);

  const versionQuestionCount = await prisma.examVersionQuestion.count();
  test('Exam Version Questions snapshotted', versionQuestionCount >= 30, `Count: ${versionQuestionCount}`);

  console.log('\n--- 6. STUDENT ATTEMPTS & ANSWER EVALUATIONS ---');
  const attemptCount = await prisma.attempt.count();
  test('Student Exam Attempts populated', attemptCount >= 25, `Count: ${attemptCount}`);

  const attemptAnswers = await prisma.answer.count();
  test('Attempt Answers recorded', attemptAnswers >= 300, `Count: ${attemptAnswers}`);

  const timeLogsCount = await prisma.questionTimeLog.count();
  test('Question Time Logs recorded', timeLogsCount >= 300, `Count: ${timeLogsCount}`);

  console.log('\n--- 7. EVALUATION RESULTS & RANKINGS SANITY ---');
  const resultsCount = await prisma.result.count();
  test('Evaluation Results generated', resultsCount >= 25, `Count: ${resultsCount}`);

  // Sanity check: verify correct + wrong + unattempted = totalQuestions for all results
  const results = await prisma.result.findMany();
  let resultMathValid = true;
  for (const r of results) {
    if (r.correctAnswers + r.wrongAnswers + r.unattempted !== r.totalQuestions) {
      resultMathValid = false;
      break;
    }
  }
  test('Result counts sum accurately (correct + wrong + unattempted == totalQuestions)', resultMathValid);

  const timeAnalysesCount = await prisma.timeAnalysis.count();
  test('Time Analyses populated', timeAnalysesCount >= 25, `Count: ${timeAnalysesCount}`);

  const strategyAnalysesCount = await prisma.strategyAnalysis.count();
  test('Strategy Analyses populated', strategyAnalysesCount >= 25, `Count: ${strategyAnalysesCount}`);

  const rankSnapshotCount = await prisma.rankSnapshot.count();
  test('Rank Snapshots generated', rankSnapshotCount >= 1, `Count: ${rankSnapshotCount}`);

  const candidateRanksCount = await prisma.candidateRank.count();
  test('Candidate Ranks populated across scopes', candidateRanksCount >= 50, `Count: ${candidateRanksCount}`);

  // Monotonic rank verification
  const overallRanks = await prisma.candidateRank.findMany({
    where: { rankType: 'OVERALL' },
    orderBy: { rank: 'asc' },
  });

  let ranksMonotonic = true;
  for (let i = 0; i < overallRanks.length - 1; i++) {
    if (overallRanks[i].score < overallRanks[i + 1].score) {
      ranksMonotonic = false;
      break;
    }
  }
  test('Candidate Ranks are monotonically consistent with scores', ranksMonotonic);

  const predictionsCount = await prisma.predictionResult.count();
  test('Predicted Ranks populated', predictionsCount >= 25, `Count: ${predictionsCount}`);

  console.log('\n--- 8. NOTIFICATIONS, AUDIT & REPORTS ---');
  const notifCount = await prisma.notification.count();
  test('Notifications recorded', notifCount >= 10, `Count: ${notifCount}`);

  const reportJobsCount = await prisma.reportJob.count();
  test('Report Jobs generated', reportJobsCount >= 4, `Count: ${reportJobsCount}`);

  const auditLogCount = await prisma.auditLog.count();
  test('Audit Logs recorded', auditLogCount >= 4, `Count: ${auditLogCount}`);

  const featureGates = await prisma.featureActivation.count();
  test('Feature Activation Gates enabled', featureGates >= 6, `Count: ${featureGates}`);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('════════════════════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL DATABASE CONSTRAINTS & BUSINESS RULES ARE SATISFIED! ✅\n');
  }
}

main()
  .catch((e) => {
    console.error('Verification failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
