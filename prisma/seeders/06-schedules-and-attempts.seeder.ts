import { SeedContext, SeederResult } from './types';
import {
  ExamScheduleStatus,
  ExamLifecycleAction,
} from '@prisma/client';

export async function seedSchedulesAndAttempts(ctx: SeedContext): Promise<SeederResult> {
  const start = Date.now();
  const created: Record<string, number> = {};
  const reused: Record<string, number> = {};

  const inc = (type: string, isNew: boolean) => {
    if (isNew) created[type] = (created[type] || 0) + 1;
    else reused[type] = (reused[type] || 0) + 1;
  };

  const { prisma } = ctx;
  const adminUser = ctx.users.get('admin.neet@brainros.test') || ctx.users.get('superadmin@brainros.test')!;
  const attemptStatusEvaluated = ctx.attemptStatuses.get('EVALUATED')!;
  const defaultLang = ctx.languages.get('en')!;

  const studentsList = Array.from(ctx.students.values());

  // 1. Create Exam Schedules for our exams
  const examMock01 = ctx.exams.get('EXAM_NEET_MOCK_01')!;
  const examMock01Version = ctx.examVersions.get('EXAM_NEET_MOCK_01:1')!;

  let schedule01 = await prisma.examSchedule.findFirst({
    where: { examId: examMock01.id, examVersionId: examMock01Version.id },
  });

  if (!schedule01) {
    schedule01 = await prisma.examSchedule.create({
      data: {
        examId: examMock01.id,
        examVersionId: examMock01Version.id,
        startTime: new Date('2026-04-10T10:00:00Z'),
        endTime: new Date('2026-04-10T11:00:00Z'),
        timezone: 'Asia/Kolkata',
        status: ExamScheduleStatus.ENDED,
        scheduledById: adminUser.id,
        activatedById: adminUser.id,
        activatedAt: new Date('2026-04-10T09:55:00Z'),
      },
    });
    inc('exam_schedules', true);
  } else {
    inc('exam_schedules', false);
  }
  ctx.examSchedules.set('EXAM_NEET_MOCK_01:SCHEDULE_01', schedule01);

  // Lifecycle History
  const existingLifecycle = await prisma.examLifecycleHistory.findFirst({
    where: { examId: examMock01.id, scheduleId: schedule01.id },
  });
  if (!existingLifecycle) {
    await prisma.examLifecycleHistory.create({
      data: {
        examId: examMock01.id,
        examVersionId: examMock01Version.id,
        scheduleId: schedule01.id,
        action: ExamLifecycleAction.COMPLETE,
        fromStatus: 'ACTIVE',
        toStatus: 'COMPLETED',
        performedById: adminUser.id,
        comment: 'Exam completed and evaluated successfully.',
      },
    });
    inc('exam_lifecycle_histories', true);
  }

  // 2. Create Realistic Attempts & Answers for EXAM_NEET_MOCK_01
  const examQuestions = ctx.examQuestions.get(examMock01.id) || [];

  for (let sIdx = 0; sIdx < studentsList.length; sIdx++) {
    const student = studentsList[sIdx];
    const attemptStartTime = new Date('2026-04-10T10:00:00Z');
    const attemptEndTime = new Date('2026-04-10T10:52:00Z');

    const proficiency = Math.max(0.3, 0.95 - (sIdx / studentsList.length) * 0.5);

    let attempt = await prisma.attempt.findUnique({
      where: { studentId_examId: { studentId: student.id, examId: examMock01.id } },
    });

    if (!attempt) {
      attempt = await prisma.attempt.create({
        data: {
          studentId: student.id,
          examId: examMock01.id,
          statusId: attemptStatusEvaluated.id,
          languageId: defaultLang.id,
          examVersionId: examMock01Version.id,
          scheduleId: schedule01.id,
          startedAt: attemptStartTime,
          submittedAt: attemptEndTime,
          serverStartTime: attemptStartTime,
          serverEndTime: attemptEndTime,
          ipAddress: `192.168.1.${10 + (sIdx % 200)}`,
        },
      });
      inc('attempts', true);

      // Create Answers & TimeLogs
      let currentTime = new Date(attemptStartTime.getTime());

      for (let qIdx = 0; qIdx < examQuestions.length; qIdx++) {
        const eq = examQuestions[qIdx];
        const origOptions = ctx.questionOptions.get(eq.questionId) || [];
        const correctOption = origOptions.find((o) => o.isCorrect);
        const wrongOptions = origOptions.filter((o) => !o.isCorrect);

        const timeSpentOnQ = 60 + Math.floor(Math.random() * 45);
        const qStart = new Date(currentTime.getTime());
        const qEnd = new Date(currentTime.getTime() + timeSpentOnQ * 1000);
        currentTime = qEnd;

        const rand = Math.random();
        let selectedOptId: string | null = null;

        if (rand < proficiency && correctOption) {
          selectedOptId = correctOption.id;
        } else if (rand < proficiency + (1 - proficiency) * 0.7 && wrongOptions.length > 0) {
          selectedOptId = wrongOptions[Math.floor(Math.random() * wrongOptions.length)].id;
        } else {
          selectedOptId = null;
        }

        await prisma.answer.create({
          data: {
            attemptId: attempt.id,
            examQuestionId: eq.id,
            selectedOptionId: selectedOptId,
            isMarkedForReview: qIdx % 7 === 0,
            answeredAt: selectedOptId ? qEnd : null,
          },
        });
        inc('answers', true);

        await prisma.questionTimeLog.create({
          data: {
            attemptId: attempt.id,
            examQuestionId: eq.id,
            startTime: qStart,
            endTime: qEnd,
            timeSpentSeconds: timeSpentOnQ,
            visitNumber: 1,
            source: 'CLIENT_EVENT',
          },
        });
        inc('question_time_logs', true);
      }
    } else {
      inc('attempts', false);
    }
    ctx.attempts.set(`${student.id}:${examMock01.id}`, attempt);
  }

  return {
    seederName: 'SchedulesAndAttemptsSeeder',
    createdCounts: created,
    reusedCounts: reused,
    timeMs: Date.now() - start,
  };
}
