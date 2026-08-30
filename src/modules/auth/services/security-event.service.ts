import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SecurityEventType } from '@prisma/client';

export interface SecurityEventContext {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger(SecurityEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log a security event. Never log secrets (OTP, password, tokens).
   */
  async log(
    eventType: SecurityEventType,
    context: SecurityEventContext,
  ): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          userId: context.userId || null,
          eventType,
          ipAddress: context.ipAddress || null,
          userAgent: context.userAgent
            ? context.userAgent.substring(0, 500)
            : null,
          metadata: context.metadata ? (context.metadata as any) : null,
        },
      });
    } catch (error) {
      // Security event logging must never break the main flow
      this.logger.error(
        `Failed to log security event ${eventType}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extract request context for security logging
   */
  static extractRequestContext(
    req: any,
  ): Pick<SecurityEventContext, 'ipAddress' | 'userAgent'> {
    return {
      ipAddress: req?.ip || req?.connection?.remoteAddress || null,
      userAgent: req?.headers?.['user-agent'] || null,
    };
  }
}
