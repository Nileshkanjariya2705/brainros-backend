import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendEmailService } from '../services/resend-email.service';
import { ExamReportPdfService, ExamReportPdfData } from '../services/exam-report-pdf.service';
import { AuditLogService } from '../audit/services/audit-log.service';
import { NotificationChannel, NotificationStatus } from '@prisma/client';

export interface ExamReportEmailJobData {
  notificationId?: string;
  examId: string;
  attemptId: string;
  studentId: string;
  recipientEmail: string;
  requestedByAdminId?: string;
  reportType: string;
}

@Processor('exam-report-email', {
  concurrency: 5,
})
export class ExamReportEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamReportEmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resendEmailService: ResendEmailService,
    private readonly pdfService: ExamReportPdfService,
    private readonly auditLogService: AuditLogService,
  ) {
    super();
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`Exam report email worker connection/runtime error: ${err.message}`);
  }

  async process(job: Job<ExamReportEmailJobData>): Promise<any> {
    const { notificationId, examId, attemptId, recipientEmail, requestedByAdminId } = job.data;
    this.logger.log(`[ExamReportEmailProcessor] Processing report email job '${job.id}' for attempt '${attemptId}'`);

    // 1. Update Notification status to PROCESSING
    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      }).catch((e) => this.logger.warn(`Could not update notification state to PROCESSING: ${e.message}`));
    }

    // 2. Fetch authoritative persisted data
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        student: {
          include: {
            user: true,
          },
        },
        result: {
          include: {
            subjectResults: {
              include: {
                subject: true,
              },
            },
            chapterResults: {
              include: {
                chapter: {
                  include: {
                    subject: true,
                  },
                },
              },
            },
          },
        },
        candidateRanks: {
          where: { rankType: 'OVERALL' },
          take: 1,
        },
        timeAnalyses: { take: 1, orderBy: { createdAt: 'desc' } },
        strategyAnalyses: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!attempt) {
      throw new Error(`Attempt '${attemptId}' not found in database.`);
    }

    if (!attempt.result) {
      throw new Error(`Attempt '${attemptId}' does not have calculated results yet.`);
    }

    // Ensure recipient email comes from profile if not passed correctly
    const targetEmail = (recipientEmail || attempt.student.user?.email || '').trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      const errorMsg = `No valid destination email found for student '${attempt.student.name}'`;
      await this.recordFailure(notificationId, attemptId, errorMsg, job.attemptsMade);
      throw new Error(errorMsg);
    }

    // 3. Prepare PDF Data
    const rankData = attempt.candidateRanks[0];
    const timeAnalysis = attempt.timeAnalyses[0];
    const strategyAnalysis = attempt.strategyAnalyses[0];

    const pdfData: ExamReportPdfData = {
      student: {
        name: attempt.student.name,
        studentCode: attempt.student.studentCode || attempt.student.studentId,
        email: targetEmail,
      },
      exam: {
        title: attempt.exam.title,
        examDate: attempt.exam.examDate || attempt.startedAt || attempt.createdAt,
        totalMarks: attempt.exam.totalMarks,
        durationMinutes: attempt.exam.durationMinutes,
      },
      attempt: {
        id: attempt.id,
        submittedAt: attempt.submittedAt || attempt.updatedAt,
        score: attempt.result.totalScore,
        maxScore: attempt.result.maxScore,
        percentage: attempt.result.percentage,
        accuracy: attempt.result.accuracy,
        totalQuestions: attempt.result.totalQuestions,
        correctAnswers: attempt.result.correctAnswers,
        wrongAnswers: attempt.result.wrongAnswers,
        unattempted: attempt.result.unattempted,
        timeUsedSeconds: attempt.result.timeUsedSeconds ?? undefined,
        averageTimePerQuestion: attempt.result.averageTimePerQuestion ?? undefined,
      },
      rank: rankData
        ? {
            rank: rankData.rank,
            totalCandidates: rankData.totalCandidates,
            percentile: rankData.percentile ? Number(rankData.percentile) : undefined,
          }
        : undefined,
      subjects: attempt.result.subjectResults?.map((sr) => ({
        name: sr.subject?.name || 'Subject',
        score: sr.score,
        maxScore: sr.maxScore,
        accuracy: sr.accuracy,
        correct: sr.correctAnswers,
        wrong: sr.wrongAnswers,
        unattempted: sr.unattempted,
        performanceStatus: sr.performanceStatus || undefined,
      })),
      chapters: attempt.result.chapterResults?.map((cr) => ({
        name: cr.chapter?.name || 'Chapter',
        subjectName: cr.chapter?.subject?.name,
        accuracy: cr.accuracy,
        performanceStatus: cr.performanceStatus || undefined,
      })),
      timeAnalysis: timeAnalysis
        ? {
            averageTimePerQuestionSeconds: (timeAnalysis.data as any)?.avgTimePerQuestion || (timeAnalysis.data as any)?.averageTimePerQuestion,
            fastestQuestionSeconds: (timeAnalysis.data as any)?.fastestQuestionTimeSeconds,
            slowestQuestionSeconds: (timeAnalysis.data as any)?.slowestQuestionTimeSeconds,
          }
        : undefined,
      strategy: strategyAnalysis
        ? {
            overAttemptingScore: (strategyAnalysis.data as any)?.overAttemptCount || 0,
            avoidableLossMarks: strategyAnalysis.avoidableNegativeMarks,
            riskCategory: strategyAnalysis.primaryClassification,
            recommendations: Array.isArray(strategyAnalysis.recommendations)
              ? (strategyAnalysis.recommendations as any[]).map((r: any) => typeof r === 'string' ? r : r.title || r.description || JSON.stringify(r))
              : [],
          }
        : undefined,
    };

    // 4. Generate PDF buffer
    this.logger.log(`[ExamReportEmailProcessor] Generating PDF report for ${attempt.student.name}...`);
    const pdfBuffer = await this.pdfService.generateReportPdf(pdfData);

    // 5. Build dynamic email content
    const examDateStr = pdfData.exam.examDate
      ? new Date(pdfData.exam.examDate).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : 'Recently';

    const rankText = pdfData.rank?.rank ? `#${pdfData.rank.rank.toLocaleString()}` : 'N/A';
    const emailSubject = `Brainros Exam Report - ${attempt.exam.title}`;
    const htmlBody = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <div style="background-color: #0f172a; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">BRAINROS</h1>
          <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 13px;">Official Live Exam Performance Report</p>
        </div>
        
        <div style="background-color: #ffffff; padding: 28px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #0f172a; margin-top: 0;">Hello ${attempt.student.name},</h2>
          <p>Your performance analysis report for <strong>${attempt.exam.title}</strong> conducted on <strong>${examDateStr}</strong> is ready and attached to this email as a PDF.</p>
          
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #4f46e5; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Performance Summary</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Total Score:</td>
                <td style="padding: 6px 0; font-weight: bold; color: #0f172a; text-align: right;">${attempt.result.totalScore} / ${attempt.result.maxScore} (${Number(attempt.result.percentage).toFixed(1)}%)</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Accuracy:</td>
                <td style="padding: 6px 0; font-weight: bold; color: #10b981; text-align: right;">${Number(attempt.result.accuracy).toFixed(1)}%</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Overall Rank:</td>
                <td style="padding: 6px 0; font-weight: bold; color: #4f46e5; text-align: right;">${rankText}</td>
              </tr>
            </table>
          </div>

          <p style="font-size: 13px; color: #64748b;">Please review the attached PDF for a detailed breakdown of subject scores, chapter accuracy, time management, and personalized recommendations.</p>
          
          <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 18px; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0;">Best regards,</p>
            <p style="margin: 4px 0 0 0; font-weight: bold; color: #0f172a;">Brainros Assessment Team</p>
          </div>
        </div>
      </div>
    `;

    // 6. Sanitize PDF Filename
    const safeExam = attempt.exam.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const safeName = attempt.student.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const attachmentFilename = `Brainros_${safeExam}_${safeName}_Report.pdf`;

    // 7. Dispatch via Resend
    const sendResult = await this.resendEmailService.sendEmail({
      to: targetEmail,
      subject: emailSubject,
      html: htmlBody,
      attachments: [
        {
          filename: attachmentFilename,
          content: pdfBuffer,
        },
      ],
    });

    if (!sendResult.success) {
      await this.recordFailure(notificationId, attemptId, sendResult.error || 'Resend dispatch failed', job.attemptsMade);
      if (sendResult.isRetryable) {
        throw new Error(`Resend temporary error: ${sendResult.error}`);
      }
      return { success: false, error: sendResult.error };
    }

    // 8. Update DB on Success
    const now = new Date();
    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.SENT,
          sentAt: now,
          lastError: null,
        },
      });

      await this.prisma.notificationLog.create({
        data: {
          notificationId,
          channel: NotificationChannel.EMAIL,
          provider: 'Resend',
          providerMessageId: sendResult.messageId,
          attemptNumber: job.attemptsMade + 1,
          status: NotificationStatus.SENT,
          responseTime: now,
        },
      });
    }

    // Audit Log
    await this.auditLogService.logAction({
      actorUserId: requestedByAdminId || null,
      action: 'EXAM_REPORT_EMAIL_SENT',
      entityType: 'Attempt',
      entityId: attemptId,
      metadata: {
        examId,
        studentId: attempt.studentId,
        recipientEmail: targetEmail,
        messageId: sendResult.messageId,
      },
    });

    this.logger.log(`[ExamReportEmailProcessor] Successfully delivered report email to ${targetEmail} (MessageId: ${sendResult.messageId})`);

    return {
      success: true,
      messageId: sendResult.messageId,
      recipient: targetEmail,
    };
  }

  private async recordFailure(notificationId: string | undefined, attemptId: string, errorMsg: string, attemptsMade: number) {
    if (notificationId) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.FAILED,
          lastError: errorMsg,
        },
      }).catch(() => {});

      await this.prisma.notificationLog.create({
        data: {
          notificationId,
          channel: NotificationChannel.EMAIL,
          provider: 'Resend',
          attemptNumber: attemptsMade + 1,
          status: NotificationStatus.FAILED,
          errorCode: 'RESEND_DISPATCH_FAILED',
          errorMessage: errorMsg,
          responseTime: new Date(),
        },
      }).catch(() => {});
    }

    await this.auditLogService.logAction({
      action: 'EXAM_REPORT_EMAIL_FAILED',
      entityType: 'Attempt',
      entityId: attemptId,
      metadata: {
        error: errorMsg,
      },
    }).catch(() => {});
  }
}
