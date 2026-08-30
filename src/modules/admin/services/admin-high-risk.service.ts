import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit/services/audit-log.service';
import { ExamLifecycleService } from '../../exam-scheduling/services/exam-lifecycle.service';

@Injectable()
export class AdminHighRiskService {
  private readonly logger = new Logger(AdminHighRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditLogService,
    private readonly lifecycleService: ExamLifecycleService,
  ) {}

  /**
   * Activate an exam for live student test-taking.
   * High-risk operation requiring Super Admin authority.
   */
  async activateExam(
    examId: string,
    actorUserId: string,
    idempotencyKey?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: { status: true, versions: true },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${examId}' not found.`);
    }

    if (exam.status.name === 'ACTIVE') {
      // Idempotent success if already active
      return {
        examId: exam.id,
        status: 'ACTIVE',
        message: 'Exam is already active.',
      };
    }

    if (!['APPROVED', 'SCHEDULED'].includes(exam.status.name)) {
      throw new BadRequestException(
        `Cannot activate exam with status '${exam.status.name}'. Exam must be APPROVED or SCHEDULED before activation.`,
      );
    }

    const beforeState = { status: exam.status.name, title: exam.title };

    return this.prisma.$transaction(async (tx) => {
      // Call domain lifecycle service
      const activatedExam = await this.lifecycleService.activateExam(
        examId,
        actorUserId,
        tx,
      );

      await this.auditService.logAction({
        actorUserId,
        action: 'ACTIVATE_EXAM',
        entityType: 'EXAM',
        entityId: examId,
        beforeState,
        afterState: { status: 'ACTIVE', activatedAt: new Date() },
        reason: 'Super Admin activated exam for live testing',
        metadata: { idempotencyKey },
        ipAddress,
        userAgent,
        tx,
      });

      return {
        examId: activatedExam.id,
        status: 'ACTIVE',
        activatedAt: new Date(),
      };
    });
  }

  /**
   * Deactivate/cancel an active exam.
   * High-risk operation requiring mandatory reason.
   */
  async deactivateExam(
    examId: string,
    actorUserId: string,
    reason: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException(
        'Deactivation reason is mandatory for high-risk operations.',
      );
    }

    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: { status: true },
    });

    if (!exam) {
      throw new NotFoundException(`Exam '${examId}' not found.`);
    }

    if (exam.status.name !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot deactivate exam with status '${exam.status.name}'. Only ACTIVE exams can be deactivated.`,
      );
    }

    const beforeState = { status: exam.status.name, title: exam.title };

    return this.prisma.$transaction(async (tx) => {
      let endedStatus = await tx.examStatus.findUnique({
        where: { name: 'ENDED' },
      });
      if (!endedStatus) {
        endedStatus = await tx.examStatus.create({ data: { name: 'ENDED' } });
      }

      const updated = await tx.exam.update({
        where: { id: examId },
        data: { statusId: endedStatus.id },
      });

      await tx.examLifecycleHistory.create({
        data: {
          examId,
          action: 'END',
          fromStatus: 'ACTIVE',
          toStatus: 'ENDED',
          performedById: actorUserId,
          comment: reason,
        },
      });

      await this.auditService.logAction({
        actorUserId,
        action: 'DEACTIVATE_EXAM',
        entityType: 'EXAM',
        entityId: examId,
        beforeState,
        afterState: { status: 'ENDED' },
        reason,
        ipAddress,
        userAgent,
        tx,
      });

      return {
        examId: updated.id,
        status: 'ENDED',
        reason,
      };
    });
  }

  /**
   * Bulk activate multiple exams with independent per-item validation and auditing.
   */
  async bulkActivateExams(
    examIds: string[],
    actorUserId: string,
    idempotencyKey?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const results: Array<{
      examId: string;
      status: 'ACTIVATED' | 'FAILED';
      reason?: string;
    }> = [];

    for (const id of examIds) {
      try {
        await this.activateExam(
          id,
          actorUserId,
          idempotencyKey,
          ipAddress,
          userAgent,
        );
        results.push({ examId: id, status: 'ACTIVATED' });
      } catch (err: any) {
        results.push({ examId: id, status: 'FAILED', reason: err.message });
      }
    }

    return {
      total: examIds.length,
      activatedCount: results.filter((r) => r.status === 'ACTIVATED').length,
      failedCount: results.filter((r) => r.status === 'FAILED').length,
      results,
    };
  }
}
