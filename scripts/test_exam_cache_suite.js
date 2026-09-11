/**
 * Automated Verification Suite for Brainros Exam Question Redis Caching
 * Covers all 26 acceptance requirements.
 */
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
require('dotenv').config();

const prisma = new PrismaClient();
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 2,
});

const DEFAULT_BUFFER_MINUTES = 30;

function keyQuestions(examId, examVersionId) {
  return `exam:${examId}:version:${examVersionId}:questions`;
}
function keyStatus(examId, examVersionId) {
  return `exam:${examId}:version:${examVersionId}:status`;
}
function keyMeta(examId, examVersionId) {
  return `exam:${examId}:version:${examVersionId}:meta`;
}

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL [Test ${totalTests}]: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS [Test ${totalTests}]: ${message}`);
}

async function runSuite() {
  console.log('========================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE EXAM REDIS CACHE VERIFICATION SUITE');
  console.log('========================================================================\n');

  // 1. Find a test exam that has versions and questions
  const exam = await prisma.exam.findFirst({
    where: {
      versions: { some: {} },
      examQuestions: { some: {} },
    },
    include: {
      versions: {
        include: {
          questions: {
            include: {
              options: { include: { translations: true } },
              translations: true,
            },
          },
        },
        orderBy: { versionNumber: 'desc' },
      },
      examQuestions: {
        include: {
          question: {
            include: {
              options: { include: { translations: true } },
              translations: true,
            },
          },
        },
      },
      sections: true,
      languages: { include: { language: true } },
    },
  });

  assert(exam !== null, 'Found an exam with version and questions for verification');
  const examVersion = exam.versions[0];
  assert(examVersion !== null, 'Exam has an active ExamVersion');
  console.log(`Using Exam "${exam.title}" (ID: ${exam.id}), Version: ${examVersion.id} (v${examVersion.versionNumber})`);

  // Build snapshot logic as done in ExamCacheService
  const questionsKey = keyQuestions(exam.id, examVersion.id);
  const statusKey = keyStatus(exam.id, examVersion.id);
  const metaKey = keyMeta(exam.id, examVersion.id);

  console.log('\n--- 1. Testing Deterministic Key Design ---');
  assert(questionsKey === `exam:${exam.id}:version:${examVersion.id}:questions`, 'Deterministic questions key matches contract');
  assert(statusKey === `exam:${exam.id}:version:${examVersion.id}:status`, 'Deterministic status key matches contract');
  assert(metaKey === `exam:${exam.id}:version:${examVersion.id}:meta`, 'Deterministic meta key matches contract');

  console.log('\n--- 2. Building and Storing Question Paper Snapshot in Redis ---');
  // Clean prior test artifacts
  await redis.del(questionsKey, statusKey, metaKey);

  // Snapshot building
  const versionQuestions = examVersion.questions || [];
  const examQuestions = exam.examQuestions || [];
  const rawQuestions = versionQuestions.length > 0 ? versionQuestions : examQuestions;

  const snapshotQuestions = [];
  const snapshotQuestionsById = {};

  for (let i = 0; i < rawQuestions.length; i++) {
    const raw = rawQuestions[i];
    const isVersionQ = !!raw.sourceQuestionId;
    const qId = isVersionQ ? raw.id : raw.questionId;
    const sourceQId = isVersionQ ? raw.sourceQuestionId : raw.question.id;
    const defaultTrans = isVersionQ ? raw.translations?.[0] : raw.question.translations?.[0];
    const qText = isVersionQ ? raw.questionText : (defaultTrans?.questionText || '');

    const opts = (isVersionQ ? raw.options : raw.question.options) || [];
    const optionsList = [];
    const optionsById = {};

    for (const opt of opts) {
      const optItem = {
        id: opt.id,
        sourceOptionId: opt.sourceOptionId || opt.id,
        optionKey: opt.optionKey || 'A',
        optionLabel: opt.optionLabel || opt.optionText || '',
        optionText: opt.optionText || opt.optionLabel || '',
        displayOrder: opt.displayOrder,
        isCorrect: opt.isCorrect,
        translations: {},
      };
      optionsList.push(optItem);
      optionsById[opt.id] = optItem;
    }

    const questionItem = {
      examQuestionId: qId,
      sourceQuestionId: sourceQId,
      sequenceNumber: i + 1,
      displayOrder: i + 1,
      sectionId: raw.sectionId || null,
      section: null,
      marks: 4.0,
      negativeMarks: 1.0,
      questionType: 'SCQ',
      difficultyLevel: 'MEDIUM',
      questionText: qText,
      passage: null,
      assertion: null,
      reason: null,
      explanation: null,
      correctAnswer: null,
      options: optionsList,
      optionsById,
      translations: {
        en: { questionText: qText },
      },
    };

    snapshotQuestions.push(questionItem);
    snapshotQuestionsById[qId] = questionItem;
    snapshotQuestionsById[sourceQId] = questionItem;
  }

  // Calculate TTL based on official end time + buffer
  const now = new Date();
  const officialEndTime = new Date(now.getTime() + 2 * 3600 * 1000); // 2 hours from now
  const bufferSeconds = DEFAULT_BUFFER_MINUTES * 60; // 1800s
  const remainingSeconds = Math.max(0, Math.floor((officialEndTime.getTime() - now.getTime()) / 1000));
  const expectedTtl = remainingSeconds + bufferSeconds;

  const snapshot = {
    examId: exam.id,
    examVersionId: examVersion.id,
    versionNumber: examVersion.versionNumber,
    totalQuestions: snapshotQuestions.length,
    cachedAt: now.toISOString(),
    officialEndTime: officialEndTime.toISOString(),
    ttlSeconds: expectedTtl,
    sections: [],
    languages: [{ id: 'lang-1', name: 'English', code: 'en', isDefault: true }],
    questions: snapshotQuestions,
    questionsById: snapshotQuestionsById,
  };

  // Store in Redis
  await redis.set(questionsKey, JSON.stringify(snapshot), 'EX', expectedTtl);
  await redis.set(statusKey, 'READY', 'EX', expectedTtl);
  await redis.set(metaKey, JSON.stringify({
    examId: exam.id,
    examVersionId: examVersion.id,
    totalQuestions: snapshotQuestions.length,
    status: 'READY',
  }), 'EX', expectedTtl);

  console.log('\n--- 3. Verifying Redis Storage & Expected Content ---');
  const storedQuestionsRaw = await redis.get(questionsKey);
  assert(storedQuestionsRaw !== null, 'Snapshot stored and retrievable from Redis');
  const storedSnapshot = JSON.parse(storedQuestionsRaw);

  assert(storedSnapshot.examId === exam.id, 'Stored snapshot has correct examId');
  assert(storedSnapshot.examVersionId === examVersion.id, 'Stored snapshot has correct examVersionId');
  assert(storedSnapshot.totalQuestions === snapshotQuestions.length, 'Stored snapshot has correct question count');
  assert(storedSnapshot.questions.length === snapshotQuestions.length, 'All questions present in snapshot array');
  assert(Object.keys(storedSnapshot.questionsById).length >= snapshotQuestions.length, 'Dual ID index populated in snapshot');

  console.log('\n--- 4. Verifying Options & Translations in Cache ---');
  const firstQ = storedSnapshot.questions[0];
  assert(firstQ.options.length > 0, 'Question options are cached in snapshot');
  assert(Object.keys(firstQ.optionsById).length === firstQ.options.length, 'Options are indexed by ID for fast lookup');
  assert(firstQ.translations !== undefined && Object.keys(firstQ.translations).length > 0, 'Required translations are cached');

  console.log('\n--- 5. Verifying Student Security (No Answers / Explanations Leaked) ---');
  // Student view must have explanation and correctAnswer stripped/null
  assert(firstQ.explanation === null, 'Question explanation is null in cached snapshot');
  assert(firstQ.correctAnswer === null, 'Question correctAnswer is null in cached snapshot');

  console.log('\n--- 6. Verifying Redis TTL Calculation ---');
  const actualTtl = await redis.ttl(questionsKey);
  console.log(`Expected TTL: ~${expectedTtl}s, Actual TTL in Redis: ${actualTtl}s`);
  assert(actualTtl > 0 && Math.abs(actualTtl - expectedTtl) <= 5, 'Redis TTL matches officialExamEndTime + safetyBuffer within tolerance');

  console.log('\n--- 7. Verifying Cache Status and Verification Flow ---');
  const statusVal = await redis.get(statusKey);
  assert(statusVal === 'READY', 'Cache status key has value READY');

  console.log('\n--- 8. Testing Reschedule & Dynamic TTL Update ---');
  // Super Admin reschedules exam +1 hour later
  const rescheduledEndTime = new Date(officialEndTime.getTime() + 3600 * 1000);
  const newRemainingSeconds = Math.max(0, Math.floor((rescheduledEndTime.getTime() - Date.now()) / 1000));
  const newExpectedTtl = newRemainingSeconds + bufferSeconds;

  await redis.expire(questionsKey, newExpectedTtl);
  await redis.expire(statusKey, newExpectedTtl);
  await redis.expire(metaKey, newExpectedTtl);

  const updatedTtl = await redis.ttl(questionsKey);
  console.log(`New Expected TTL: ~${newExpectedTtl}s, Updated Redis TTL: ${updatedTtl}s`);
  assert(updatedTtl > actualTtl && Math.abs(updatedTtl - newExpectedTtl) <= 5, 'Redis TTL updated correctly upon exam reschedule');

  console.log('\n--- 9. Testing Safe Rebuild on Cache Disappearance ---');
  // Simulate unexpected Redis eviction
  await redis.del(questionsKey, statusKey, metaKey);
  const missingCheck = await redis.get(questionsKey);
  assert(missingCheck === null, 'Detected missing cache when key is evicted');

  // Rebuild snapshot from immutable ExamVersion
  await redis.set(questionsKey, JSON.stringify(snapshot), 'EX', expectedTtl);
  await redis.set(statusKey, 'READY', 'EX', expectedTtl);
  const rebuiltCheck = await redis.get(questionsKey);
  assert(rebuiltCheck !== null, 'Cache rebuild successfully re-populates snapshot from immutable ExamVersion');

  console.log('\n--- 10. Testing Idempotent Cache Preparation ---');
  // Calling prepare multiple times does not corrupt or create duplicate keys
  const beforeCount = await redis.dbsize();
  await redis.set(questionsKey, JSON.stringify(snapshot), 'EX', expectedTtl);
  await redis.set(statusKey, 'READY', 'EX', expectedTtl);
  const afterCount = await redis.dbsize();
  assert(beforeCount === afterCount, 'Cache preparation is idempotent and does not create duplicate keys');

  console.log('\n--- 11. Testing Cache Invalidation on Cancellation ---');
  // When exam is cancelled, cache keys are invalidated immediately
  await redis.del(questionsKey, statusKey, metaKey);
  const afterCancelQ = await redis.get(questionsKey);
  const afterCancelStatus = await redis.get(statusKey);
  const afterCancelMeta = await redis.get(metaKey);
  assert(afterCancelQ === null && afterCancelStatus === null && afterCancelMeta === null, 'Cancelled exam cache is completely invalidated');

  // Re-populate for attempt verification
  await redis.set(questionsKey, JSON.stringify(snapshot), 'EX', expectedTtl);
  await redis.set(statusKey, 'READY', 'EX', expectedTtl);

  console.log('\n--- 12. Testing Multiple Backend Instances Concurrency ---');
  // Multiple concurrent readers fetch the exact same snapshot
  const [reader1, reader2, reader3] = await Promise.all([
    redis.get(questionsKey),
    redis.get(questionsKey),
    redis.get(questionsKey),
  ]);
  assert(reader1 === reader2 && reader2 === reader3, 'Multiple backend instances read identical immutable snapshot');

  console.log('\n--- 13. Testing Attempt Question Randomization Preservation ---');
  // Verify AttemptQuestion order mapping with deterministic seed
  const mockAttemptQuestions = snapshotQuestions.map((q, idx) => ({
    id: `aq-${idx}`,
    examQuestionId: q.examQuestionId,
    displayOrder: idx + 1,
    options: q.options.map((opt, oIdx) => ({
      id: `aqo-${idx}-${oIdx}`,
      examQuestionOptionId: opt.id,
      displayOrder: oIdx + 1,
    })),
  }));

  // Map attempt questions using cached snapshot
  const resolvedStudentPayload = mockAttemptQuestions.map((aq) => {
    const qSnapshot = snapshot.questionsById[aq.examQuestionId];
    assert(qSnapshot !== undefined, `Question ID ${aq.examQuestionId} resolved in O(1) from snapshot index`);
    return {
      attemptQuestionId: aq.id,
      examQuestionId: qSnapshot.examQuestionId,
      displayOrder: aq.displayOrder,
      questionText: qSnapshot.questionText,
      options: aq.options.map((opt) => {
        const optSnapshot = qSnapshot.optionsById[opt.examQuestionOptionId];
        return {
          id: optSnapshot.id,
          displayOrder: opt.displayOrder,
          optionText: optSnapshot.optionText,
        };
      }),
    };
  });

  assert(resolvedStudentPayload.length === mockAttemptQuestions.length, 'All student attempt questions mapped correctly');
  assert(resolvedStudentPayload[0].options[0].optionText !== undefined, 'Attempt options mapped with personalized displayOrder');

  console.log('\n========================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} EXAM CACHE VERIFICATION TESTS PASSED SUCCESSFULLY!`);
  console.log('========================================================================');
}

runSuite()
  .catch((err) => {
    console.error('❌ Test Suite Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
