import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit/services/audit-log.service';
import { ResultService } from '../../result/result.service';
import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

export interface CompletedExamQueryDto {
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

@Injectable()
export class CompletedExamReportsService {
  private readonly logger = new Logger(CompletedExamReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly resultService: ResultService,
    @InjectQueue('exam-report-email')
    private readonly emailReportQueue: Queue,
  ) {}

  /**
   * Determine whether an exam is an official completed LIVE exam (not a Mock Test).
   */
  private isLiveExamTitle(title: string): boolean {
    const t = (title || '').toUpperCase();
    if (t.includes('MOCK') || t.includes('PRACTICE')) {
      return false;
    }
    return true;
  }

  /**
   * Returns list of all completed Live Exams, ordered by most recently completed first.
   */
  async getCompletedLiveExams() {
    const exams = await this.prisma.exam.findMany({
      where: {
        AND: [
          {
            NOT: {
              title: {
                contains: 'Mock',
                mode: 'insensitive',
              },
            },
          },
          {
            NOT: {
              title: {
                contains: 'Practice',
                mode: 'insensitive',
              },
            },
          },
        ],
      },
      include: {
        status: true,
        examTarget: { select: { id: true, name: true } },
        schedules: {
          orderBy: { endTime: 'desc' },
          take: 1,
        },
        resultPublications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            attempts: true,
          },
        },
      },
      orderBy: [{ endTime: 'desc' }, { createdAt: 'desc' }],
    });

    const now = new Date();

    // Filter to exams that are live and whose window has ended or are completed / published
    const completedLiveExams = exams.filter((exam: any) => {
      if (!this.isLiveExamTitle(exam.title)) return false;

      const schedule = exam.schedules?.[0];
      const pub = exam.resultPublications?.[0];

      const scheduleEnded = schedule && (schedule.status === 'ENDED' || new Date(schedule.endTime) <= now);
      const examWindowEnded = exam.endTime && new Date(exam.endTime) <= now;
      const isStatusCompleted = ['COMPLETED', 'PUBLISHED', 'EVALUATED'].includes(exam.status?.name?.toUpperCase());
      const isPubCompleted = pub && ['PUBLISHED', 'READY_TO_PUBLISH'].includes(pub.status);

      return Boolean(scheduleEnded || examWindowEnded || isStatusCompleted || isPubCompleted);
    });

    return completedLiveExams.map((exam: any) => {
      const pub = exam.resultPublications?.[0];
      return {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        examDate: exam.examDate || exam.schedules?.[0]?.startTime || exam.startTime,
        startTime: exam.startTime || exam.schedules?.[0]?.startTime,
        endTime: exam.endTime || exam.schedules?.[0]?.endTime,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
        totalQuestions: exam.totalQuestions,
        examTarget: exam.examTarget,
        status: exam.status?.name,
        publicationStatus: pub?.status || (exam._count?.attempts > 0 ? 'READY_TO_PUBLISH' : 'NOT_READY'),
        totalAttempts: exam._count?.attempts || 0,
      };
    });
  }

  /**
   * Returns the most recently completed Live Exam.
   */
  async getLatestCompletedLiveExam() {
    const list = await this.getCompletedLiveExams();
    if (list.length === 0) {
      return null;
    }
    return list[0];
  }

  /**
   * Computes aggregate summary metrics for the selected Live Exam.
   */
  async getLiveExamSummary(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        status: true,
        examTarget: true,
        schedules: { take: 1, orderBy: { endTime: 'desc' } },
        resultPublications: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found.`);
    }

    if (!this.isLiveExamTitle(exam.title)) {
      throw new BadRequestException('The requested exam is a Mock Test, which is not permitted in this dashboard.');
    }

    // 1. Registered Count: Students with exam target or enrollments
    const registeredCount = await this.prisma.student.count({
      where: {
        examTargetId: exam.examTargetId,
        status: 'ACTIVE',
      },
    });

    // 2. Attended Attempts: Attempts that actually started
    const attendedAttempts = await this.prisma.attempt.findMany({
      where: {
        examId,
        OR: [
          { startedAt: { not: null } },
          { status: { name: { in: ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'EVALUATED'] } } },
        ],
      },
      include: {
        status: true,
        result: true,
      },
    });

    const totalAttended = attendedAttempts.length;
    const submittedCount = attendedAttempts.filter((a) => a.status.name === 'SUBMITTED').length;
    const autoSubmittedCount = attendedAttempts.filter((a) => a.status.name === 'AUTO_SUBMITTED').length;
    const evaluatedCount = attendedAttempts.filter((a) => a.result !== null).length;
    const failedCount = attendedAttempts.filter((a) => a.result?.resultStatus === 'FAILED').length;

    // 3. Averages from persisted Results
    const resultAggregates = await this.prisma.result.aggregate({
      where: {
        attempt: {
          examId,
        },
      },
      _avg: {
        totalScore: true,
        accuracy: true,
        percentage: true,
      },
      _max: {
        totalScore: true,
      },
      _min: {
        totalScore: true,
      },
    });

    const pub = exam.resultPublications[0];

    return {
      examId: exam.id,
      examTitle: exam.title,
      examDate: exam.examDate || exam.schedules[0]?.startTime || exam.startTime,
      durationMinutes: exam.durationMinutes,
      totalMarks: exam.totalMarks,
      totalQuestions: exam.totalQuestions,
      metrics: {
        registered: Math.max(registeredCount, totalAttended),
        attended: totalAttended,
        submitted: submittedCount,
        autoSubmitted: autoSubmittedCount,
        evaluated: evaluatedCount,
        failed: failedCount,
        averageScore: Number(resultAggregates._avg.totalScore || 0).toFixed(1),
        averageAccuracy: Number(resultAggregates._avg.accuracy || 0).toFixed(1),
        averagePercentage: Number(resultAggregates._avg.percentage || 0).toFixed(1),
        highestScore: resultAggregates._max.totalScore || 0,
        lowestScore: resultAggregates._min.totalScore || 0,
      },
      publication: {
        status: pub?.status || (evaluatedCount > 0 ? 'READY_TO_PUBLISH' : 'NOT_READY'),
        publishedAt: pub?.publishedAt || null,
        evaluatedAttempts: pub?.evaluatedAttempts || evaluatedCount,
        totalEligibleAttempts: pub?.totalEligibleAttempts || totalAttended,
      },
    };
  }

  /**
   * Paginated, searchable, filterable list of student attendees for the selected Live Exam.
   */
  async getLiveExamAttendees(examId: string, query: CompletedExamQueryDto) {
    const {
      search = '',
      status = '',
      sortBy = 'submittedAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = query;

    const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
    const take = Math.min(100, Math.max(1, limit));

    // Base WHERE condition: only actual attendees for this exam
    const whereCondition: any = {
      examId,
      OR: [
        { startedAt: { not: null } },
        { status: { name: { in: ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'EVALUATED'] } } },
      ],
    };

    if (search.trim()) {
      const q = search.trim();
      whereCondition.AND = [
        {
          OR: [
            { student: { name: { contains: q, mode: 'insensitive' } } },
            { student: { studentId: { contains: q, mode: 'insensitive' } } },
            { student: { studentCode: { contains: q, mode: 'insensitive' } } },
            { student: { user: { email: { contains: q, mode: 'insensitive' } } } },
            { student: { user: { phone: { contains: q, mode: 'insensitive' } } } },
          ],
        },
      ];
    }

    if (status.trim() && status.toUpperCase() !== 'ALL') {
      const s = status.toUpperCase();
      if (['SUBMITTED', 'AUTO_SUBMITTED', 'IN_PROGRESS', 'EVALUATED'].includes(s)) {
        whereCondition.status = { name: s };
      } else if (['PUBLISHED', 'READY_TO_PUBLISH', 'FAILED'].includes(s)) {
        whereCondition.result = { resultStatus: s };
      }
    }

    // Determine sorting
    let orderBy: any = { submittedAt: sortOrder };
    if (sortBy === 'studentName') {
      orderBy = { student: { name: sortOrder } };
    } else if (sortBy === 'score') {
      orderBy = { result: { totalScore: sortOrder } };
    } else if (sortBy === 'accuracy') {
      orderBy = { result: { accuracy: sortOrder } };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: sortOrder };
    }

    const [total, attempts] = await Promise.all([
      this.prisma.attempt.count({ where: whereCondition }),
      this.prisma.attempt.findMany({
        where: whereCondition,
        include: {
          status: true,
          student: {
            include: {
              user: { select: { id: true, email: true, phone: true } },
              preferredLanguage: { select: { name: true, code: true } },
            },
          },
          result: true,
          candidateRanks: {
            where: { rankType: 'OVERALL' },
            take: 1,
          },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    // Fetch latest email notification statuses for these attempts
    const attemptIds = attempts.map((a) => a.id);
    const notifications = await this.prisma.notification.findMany({
      where: {
        type: NotificationType.REPORT_READY,
        correlationId: { in: attemptIds },
      },
      orderBy: { createdAt: 'desc' },
    });

    const notificationMap = new Map<string, any>();
    notifications.forEach((n) => {
      if (n.correlationId && !notificationMap.has(n.correlationId)) {
        notificationMap.set(n.correlationId, n);
      }
    });

    const items = attempts.map((att) => {
      const rankData = att.candidateRanks[0];
      const notif = notificationMap.get(att.id);

      let emailStatus: 'NONE' | 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' = 'NONE';
      if (notif) {
        if (notif.status === NotificationStatus.SENT) emailStatus = 'SENT';
        else if (notif.status === NotificationStatus.FAILED) emailStatus = 'FAILED';
        else if (notif.status === NotificationStatus.PROCESSING) emailStatus = 'PROCESSING';
        else if (notif.status === NotificationStatus.PENDING) emailStatus = 'QUEUED';
      }

      return {
        attemptId: att.id,
        examId: att.examId,
        studentId: att.studentId,
        studentName: att.student.name,
        studentCode: att.student.studentCode || att.student.studentId,
        email: att.student.user.email,
        phone: att.student.user.phone,
        attemptStatus: att.status.name,
        startedAt: att.startedAt,
        submittedAt: att.submittedAt,
        score: att.result?.totalScore ?? null,
        maxScore: att.result?.maxScore ?? null,
        percentage: att.result?.percentage ?? null,
        accuracy: att.result?.accuracy ?? null,
        rank: rankData?.rank ?? null,
        percentile: rankData?.percentile ?? null,
        totalCandidates: rankData?.totalCandidates ?? null,
        resultStatus: att.result ? att.result.resultStatus || 'EVALUATED' : 'EVALUATING',
        emailStatus,
        lastEmailSentAt: notif?.sentAt || null,
      };
    });

    return {
      items,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / take),
      },
    };
  }

  /**
   * Pure Read-Only Student Analysis & Question Review
   * Uses existing persisted Result + Analytics + Answers snapshot without recalculation.
   */
  async getStudentAttemptAnalysis(examId: string, attemptId: string, user: any) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        student: {
          include: {
            user: { select: { id: true, email: true, phone: true } },
          },
        },
        candidateRanks: {
          where: { rankType: 'OVERALL' },
          take: 1,
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt with ID '${attemptId}' not found.`);
    }

    if (attempt.examId !== examId) {
      throw new BadRequestException('The requested attempt does not belong to the specified exam.');
    }

    // 1. Fetch full persisted analysis using ResultService (pure read-only)
    const fullAnalysis = await this.resultService.getFullAnalysis(attemptId, user);

    // 2. Fetch question-by-question answer review (immutable snapshot)
    const review = await this.resultService.getAnswerReview(attemptId, user);

    // 3. Email delivery status check
    const emailStatus = await this.getReportEmailStatus(examId, attemptId);

    return {
      attemptId: attempt.id,
      examId: attempt.examId,
      examTitle: attempt.exam.title,
      student: {
        id: attempt.student.id,
        name: attempt.student.name,
        studentCode: attempt.student.studentCode || attempt.student.studentId,
        email: attempt.student.user.email,
        phone: attempt.student.user.phone,
      },
      submittedAt: attempt.submittedAt,
      rank: attempt.candidateRanks[0]
        ? {
            rank: attempt.candidateRanks[0].rank,
            percentile: attempt.candidateRanks[0].percentile,
            totalCandidates: attempt.candidateRanks[0].totalCandidates,
          }
        : null,
      analysis: fullAnalysis,
      questionsReview: review,
      emailStatus,
    };
  }

  /**
   * Enqueues a BullMQ job to asynchronously generate PDF and deliver via Resend.
   */
  async queueReportEmail(examId: string, attemptId: string, adminUser: any) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: {
          include: {
            resultPublications: { take: 1, orderBy: { createdAt: 'desc' } },
          },
        },
        student: {
          include: {
            user: { select: { id: true, email: true, phone: true } },
          },
        },
        result: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt with ID '${attemptId}' not found.`);
    }

    if (attempt.examId !== examId) {
      throw new BadRequestException('The requested attempt does not belong to the specified exam.');
    }

    if (!attempt.result) {
      throw new BadRequestException('Cannot send report email: Result has not been evaluated yet.');
    }

    const recipientEmail = attempt.student.user?.email;
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new BadRequestException(`Student '${attempt.student.name}' does not have a valid registered email address.`);
    }

    // Idempotency: create or update Notification record
    const idempotencyKey = `report-email:${examId}:${attemptId}:${Date.now()}`;
    const notification = await this.prisma.notification.create({
      data: {
        userId: attempt.student.userId,
        recipientUserId: attempt.student.userId,
        recipientAddress: recipientEmail,
        channel: NotificationChannel.EMAIL,
        type: NotificationType.REPORT_READY,
        title: `Brainros Exam Report - ${attempt.exam.title}`,
        message: `Your performance report for ${attempt.exam.title} is attached.`,
        status: NotificationStatus.PENDING,
        correlationId: attemptId,
        idempotencyKey,
        data: {
          examId,
          attemptId,
          studentId: attempt.studentId,
          requestedByAdminId: adminUser.userId || adminUser.id,
        },
      },
    });

    // Add BullMQ Job
    const job = await this.emailReportQueue.add(
      'send-student-report-email',
      {
        notificationId: notification.id,
        examId,
        attemptId,
        studentId: attempt.studentId,
        recipientEmail,
        requestedByAdminId: adminUser.userId || adminUser.id,
        reportType: 'EXAM_ANALYSIS',
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    // Audit Log
    await this.auditLogService.logAction({
      actorUserId: adminUser.userId || adminUser.id,
      action: 'EXAM_REPORT_EMAIL_REQUESTED',
      entityType: 'Attempt',
      entityId: attemptId,
      metadata: {
        examId,
        studentId: attempt.studentId,
        recipientEmail,
        jobId: job.id,
      },
    });

    this.logger.log(
      `[CompletedExamReportsService] Queued report email job '${job.id}' for student '${recipientEmail}' on attempt '${attemptId}'`,
    );

    return {
      success: true,
      message: 'Report queued for email delivery.',
      status: 'QUEUED',
      jobId: job.id,
      recipientEmail,
    };
  }

  /**
   * Returns the latest email delivery status for an attempt.
   */
  async getReportEmailStatus(examId: string, attemptId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        type: NotificationType.REPORT_READY,
        correlationId: attemptId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!notification) {
      return {
        status: 'NONE',
        sentAt: null,
        messageId: null,
        error: null,
      };
    }

    const latestLog = notification.logs[0];

    return {
      notificationId: notification.id,
      status: notification.status,
      sentAt: notification.sentAt,
      messageId: latestLog?.providerMessageId || null,
      error: notification.lastError || latestLog?.errorMessage || null,
      recipient: notification.recipientAddress,
    };
  }
}
