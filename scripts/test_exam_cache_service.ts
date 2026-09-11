import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ExamCacheService } from '../src/modules/exam-cache/services/exam-cache.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';

async function main() {
  console.log('--- Initializing NestJS App Context to test ExamCacheService DI ---');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const examCacheService = app.get(ExamCacheService);
    const prisma = app.get(PrismaService);

    console.log('Successfully resolved ExamCacheService and PrismaService via NestJS DI!');

    // 1. Pick an exam with version and questions
    const exam = await prisma.exam.findFirst({
      where: {
        versions: { some: {} },
        examQuestions: { some: {} },
      },
      include: {
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });

    if (!exam || !exam.versions[0]) {
      throw new Error('No valid exam found');
    }

    const version = exam.versions[0];
    console.log(`Testing Exam: "${exam.title}" (${exam.id}), Version: ${version.id}`);

    // 2. Prepare Exam Cache
    console.log('Step 1: Calling prepareExamCache...');
    const prepResult = await examCacheService.prepareExamCache({
      examId: exam.id,
      examVersionId: version.id,
    });
    console.log('✅ Cache Prepared:', {
      success: prepResult.success,
      questionsCount: prepResult.snapshot.totalQuestions,
      ttlSeconds: prepResult.snapshot.ttlSeconds,
    });

    // 3. Verify Cache Readiness
    console.log('Step 2: Checking isExamCacheReady...');
    const isReady = await examCacheService.isExamCacheReady(exam.id, version.id);
    console.log('✅ isExamCacheReady:', isReady);
    if (!isReady) throw new Error('isExamCacheReady returned false after preparation');

    // 4. Verify Cache Content
    console.log('Step 3: Calling verifyExamCache...');
    const verifyResult = await examCacheService.verifyExamCache(exam.id, version.id);
    console.log('✅ verifyExamCache:', verifyResult);
    if (!verifyResult.isValid) throw new Error(`verifyExamCache failed: ${verifyResult.errors?.join(', ')}`);

    // 5. Get Snapshot
    console.log('Step 4: Calling getExamSnapshot...');
    const snapshot = await examCacheService.getExamSnapshot(exam.id, version.id);
    if (!snapshot) throw new Error('getExamSnapshot returned null');
    console.log('✅ getExamSnapshot retrieved snapshot with questions:', snapshot.questions.length);

    // 6. Update TTL (Simulate reschedule)
    console.log('Step 5: Calling updateExamCacheTTL...');
    const newEndTime = new Date(Date.now() + 4 * 3600 * 1000); // 4 hours from now
    await examCacheService.updateExamCacheTTL(exam.id, version.id, newEndTime);
    console.log('✅ updateExamCacheTTL succeeded');

    // 7. Invalidate Cache
    console.log('Step 6: Calling invalidateExamCache...');
    await examCacheService.invalidateExamCache(exam.id);
    const readyAfterInvalidate = await examCacheService.isExamCacheReady(exam.id, version.id);
    console.log('✅ isExamCacheReady after invalidation:', readyAfterInvalidate);
    if (readyAfterInvalidate) throw new Error('Cache still ready after invalidation');

    // 8. Test Safe Rebuild
    console.log('Step 7: Testing rebuildExamCache...');
    const rebuiltSnapshot = await examCacheService.rebuildExamCache(exam.id, version.id);
    console.log('✅ rebuildExamCache succeeded, new snapshot question count:', rebuiltSnapshot.totalQuestions);

    console.log('\n🎉 ALL ExamCacheService NESTJS DI INTEGRATION TESTS PASSED!');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
