import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ResultService } from '../../result/result.service';
import { SecurityReviewStatus, AttemptRiskLevel } from '@prisma/client';
import { ReviewSecurityAttemptDto, TerminateAttemptDto } from '../dto/security.dto';

@Injectable()
export class SecurityReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resultService: ResultService,
  ) {}

  /**
   * Get aggregated exam security summary for admin dashboard
   */
  async getExamSecuritySummary(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        securityProfile: true,
      },
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const attempts = await this.prisma.attempt.findMany({
      where: { examId },
      select: {
        id: true,
        riskScore: true,
        riskLevel: true,
        isFlagged: true,
        disqualifiedAt: true,
        status: { select: { name: true } },
      },
    });

    let lowCount = 0;
    let mediumCount = 0;
    let highCount = 0;
    let criticalCount = 0;
    let flaggedCount = 0;
    let disqualifiedCount = 0;

    for (const a of attempts) {
      if (a.riskLevel === AttemptRiskLevel.LOW) lowCount++;
      else if (a.riskLevel === AttemptRiskLevel.MEDIUM) mediumCount++;
      else if (a.riskLevel === AttemptRiskLevel.HIGH) highCount++;
      else if (a.riskLevel === AttemptRiskLevel.CRITICAL) criticalCount++;

      if (a.isFlagged) flaggedCount++;
      if (a.disqualifiedAt) disqualifiedCount++;
    }

    const flaggedAttempts = await this.prisma.attempt.findMany({
      where: {
        examId,
        OR: [{ isFlagged: true }, { riskLevel: { in: [AttemptRiskLevel.HIGH, AttemptRiskLevel.CRITICAL] } }],
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            studentCode: true,
          },
        },
        status: { select: { name: true } },
        securityReviews: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { attemptEvents: true },
        },
      },
      orderBy: { riskScore: 'desc' },
      take: 50,
    });

    return {
      examId,
      examTitle: exam.title,
      securityProfile: exam.securityProfile,
      totalAttempts: attempts.length,
      riskDistribution: {
        low: lowCount,
        medium: mediumCount,
        high: highCount,
        critical: criticalCount,
      },
      flaggedCount,
      disqualifiedCount,
      flaggedAttempts: flaggedAttempts.map((fa) => ({
        attemptId: fa.id,
        studentName: fa.student?.name,
        studentCode: fa.student?.studentCode,
        status: fa.status.name,
        riskScore: fa.riskScore,
        riskLevel: fa.riskLevel,
        isFlagged: fa.isFlagged,
        disqualifiedAt: fa.disqualifiedAt,
        eventsCount: fa._count.attemptEvents,
        latestReview: fa.securityReviews[0] || null,
      })),
    };
  }

  /**
   * Get detailed attempt security view for individual audit
   */
  async getAttemptSecurityDetails(attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        student: { select: { id: true, name: true, studentCode: true, userId: true } },
        exam: { select: { id: true, title: true } },
        status: { select: { name: true } },
        securityProfile: { include: { rules: true } },
        securityAcceptances: true,
        examSessions: { orderBy: { startedAt: 'desc' } },
        securityReviews: {
          include: { reviewedBy: { select: { id: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        },
        attemptEvents: {
          orderBy: { serverTimestamp: 'asc' },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    return attempt;
  }

  /**
   * Submit manual admin review for a flagged attempt
   */
  async reviewAttempt(
    attemptId: string,
    dto: ReviewSecurityAttemptDto,
    adminUserId: string,
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    const review = await this.prisma.attemptSecurityReview.create({
      data: {
        attemptId,
        status: dto.status as SecurityReviewStatus,
        reviewedById: adminUserId,
        reason: dto.reason,
        notes: dto.notes,
        reviewedAt: new Date(),
      },
    });

    if (dto.status === SecurityReviewStatus.DISQUALIFIED) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: {
          isFlagged: true,
          disqualifiedAt: new Date(),
          disqualificationReason: dto.reason || 'Disqualified by security administrator review.',
        },
      });
    } else if (dto.status === SecurityReviewStatus.CLEARED) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: {
          isFlagged: false,
          disqualifiedAt: null,
          disqualificationReason: null,
        },
      });
    }

    return {
      message: 'Attempt security review recorded successfully',
      review,
    };
  }

  /**
   * Authoritatively terminate an attempt due to confirmed security violation
   */
  async terminateAttempt(
    attemptId: string,
    dto: TerminateAttemptDto,
    adminUserId: string,
  ) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { status: true },
    });

    if (!attempt) {
      throw new NotFoundException('Attempt not found');
    }

    let terminatedStatus = await this.prisma.attemptStatus.findUnique({
      where: { name: 'TERMINATED' },
    });
    if (!terminatedStatus) {
      terminatedStatus = await this.prisma.attemptStatus.findUnique({
        where: { name: 'AUTO_SUBMITTED' },
      });
    }
    if (!terminatedStatus) {
      terminatedStatus = await this.prisma.attemptStatus.findFirst({
        where: { name: 'SUBMITTED' },
      });
    }

    const now = new Date();
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        statusId: terminatedStatus!.id,
        submittedAt: now,
        isFlagged: true,
        disqualifiedAt: now,
        disqualificationReason: dto.reason,
      },
    });

    // Invalidate active sessions
    await this.prisma.examSession.updateMany({
      where: { attemptId, status: 'ACTIVE' },
      data: { status: 'TERMINATED' },
    });

    // Record review log
    await this.prisma.attemptSecurityReview.create({
      data: {
        attemptId,
        status: SecurityReviewStatus.DISQUALIFIED,
        reviewedById: adminUserId,
        reason: dto.reason,
        notes: `Attempt authoritatively terminated by admin (${adminUserId}).`,
        reviewedAt: now,
      },
    });

    // Calculate partial result for record keeping
    try {
      await this.resultService.calculateResult(attemptId);
    } catch {
      // Non-blocking
    }

    return {
      message: 'Attempt successfully terminated due to security violation',
      attemptId,
      terminatedAt: now.toISOString(),
    };
  }
}
