import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActiveAttemptGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true;

    const studentId = user.studentProfile?.id || user.studentId;
    const userId = user.userId || user.id || user.sub;

    const now = new Date();
    const activeAttempt = await this.prisma.attempt.findFirst({
      where: {
        OR: [
          studentId ? { studentId } : undefined,
          userId ? { student: { userId } } : undefined,
        ].filter(Boolean) as any,
        status: { name: 'IN_PROGRESS' },
        serverEndTime: { gt: now },
      },
      include: { exam: { select: { id: true, title: true } } },
    });

    if (activeAttempt) {
      // If the incoming request is interacting with the student's current active attempt, permit it
      const targetAttemptId = request.params?.attemptId || request.params?.id;
      if (targetAttemptId === activeAttempt.id) {
        return true;
      }

      // If starting another exam attempt or accessing conflicting endpoints, reject
      const targetExamId = request.body?.examId || request.params?.examId;
      if (targetExamId && targetExamId === activeAttempt.exam.id) {
        return true; // Resuming existing exam attempt is permitted
      }

      throw new ConflictException({
        statusCode: 409,
        error: 'ActiveExamConflict',
        message: `You currently have an examination in progress: "${activeAttempt.exam.title}". You must finish or submit your active examination before starting another one.`,
        activeAttemptId: activeAttempt.id,
        examId: activeAttempt.exam.id,
      });
    }

    return true;
  }
}
