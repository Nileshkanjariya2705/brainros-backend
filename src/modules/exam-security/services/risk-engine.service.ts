import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AttemptRiskLevel, SecurityActionType } from '@prisma/client';

export interface RiskEvaluationResult {
  riskScore: number;
  riskLevel: AttemptRiskLevel;
  isFlagged: boolean;
  action: SecurityActionType;
  warningMessage?: string;
  violationsCount: number;
}

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Calculate risk score delta for an event
   */
  calculateEventWeight(eventType: string, durationSeconds?: number): number {
    switch (eventType) {
      case 'TAB_HIDDEN':
        if (!durationSeconds || durationSeconds <= 3) return 1;
        if (durationSeconds <= 15) return 3;
        return 8;

      case 'WINDOW_BLUR':
        return 1;

      case 'FULLSCREEN_EXITED':
        return 4;

      case 'DEVTOOLS_SHORTCUT_DETECTED':
        return 10;

      case 'SOURCE_VIEW_SHORTCUT_DETECTED':
        return 8;

      case 'COPY_BLOCKED':
        return 3;

      case 'PASTE_BLOCKED':
        return 4;

      case 'CUT_BLOCKED':
        return 3;

      case 'CONTEXT_MENU_BLOCKED':
        return 1;

      case 'MULTIPLE_SESSION_DETECTED':
        return 20;

      case 'API_TAMPERING_DETECTED':
        return 25;

      case 'WINDOW_RESIZE':
        return 1;

      case 'LANGUAGE_CHANGED':
      case 'NETWORK_OFFLINE':
      case 'NETWORK_ONLINE':
      case 'PAGE_REFRESH':
      case 'HEARTBEAT_RECOVERED':
      case 'FULLSCREEN_ENTERED':
      case 'TAB_VISIBLE':
      case 'WINDOW_FOCUS':
        return 0; // Benign operational signals

      default:
        return 1;
    }
  }

  /**
   * Determine risk level from accumulated score
   */
  resolveRiskLevel(score: number): AttemptRiskLevel {
    if (score < 10) return AttemptRiskLevel.LOW;
    if (score < 20) return AttemptRiskLevel.MEDIUM;
    if (score < 40) return AttemptRiskLevel.HIGH;
    return AttemptRiskLevel.CRITICAL;
  }

  /**
   * Evaluate security status for an attempt after new events are ingested
   */
  async evaluateAttemptSecurity(
    attemptId: string,
  ): Promise<RiskEvaluationResult> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        securityProfile: {
          include: { rules: true },
        },
      },
    });

    if (!attempt) {
      return {
        riskScore: 0,
        riskLevel: AttemptRiskLevel.LOW,
        isFlagged: false,
        action: SecurityActionType.ALLOW,
        violationsCount: 0,
      };
    }

    const profile = attempt.securityProfile;

    // Fetch all events for this attempt
    const events = await this.prisma.attemptEvent.findMany({
      where: { attemptId },
      select: {
        eventType: true,
        duration: true,
      },
    });

    let totalScore = 0;
    let tabSwitchCount = 0;
    let fullscreenExitCount = 0;
    let devtoolsCount = 0;
    let multipleSessionCount = 0;

    for (const ev of events) {
      totalScore += this.calculateEventWeight(ev.eventType, ev.duration || 0);

      if (ev.eventType === 'TAB_HIDDEN') tabSwitchCount++;
      if (ev.eventType === 'FULLSCREEN_EXITED') fullscreenExitCount++;
      if (ev.eventType === 'DEVTOOLS_SHORTCUT_DETECTED') devtoolsCount++;
      if (ev.eventType === 'MULTIPLE_SESSION_DETECTED') multipleSessionCount++;
    }

    const riskLevel = this.resolveRiskLevel(totalScore);
    let isFlagged = attempt.isFlagged || riskLevel === AttemptRiskLevel.HIGH || riskLevel === AttemptRiskLevel.CRITICAL;
    let action: SecurityActionType = SecurityActionType.ALLOW;
    let warningMessage: string | undefined;

    // Evaluate against profile rules
    if (profile) {
      const maxTabSwitches = profile.maxTabSwitches ?? 3;
      const maxFullscreenExits = profile.maxFullscreenExits ?? 2;
      const warningThreshold = profile.warningThreshold ?? 2;

      if (profile.detectTabSwitch && tabSwitchCount >= maxTabSwitches) {
        action = SecurityActionType.WARN;
        warningMessage = `You have switched tabs ${tabSwitchCount} times. Please remain on the exam screen.`;
        if (tabSwitchCount > maxTabSwitches + 2) {
          isFlagged = true;
          action = SecurityActionType.FLAG;
        }
      }

      if (profile.fullscreenRequired && fullscreenExitCount >= maxFullscreenExits) {
        action = SecurityActionType.WARN;
        warningMessage = `Fullscreen was exited ${fullscreenExitCount} times. Fullscreen mode is required.`;
        if (fullscreenExitCount > maxFullscreenExits + 2) {
          isFlagged = true;
          action = SecurityActionType.FLAG;
        }
      }

      if (multipleSessionCount > 0 && profile.singleSessionRequired) {
        isFlagged = true;
        action = SecurityActionType.FLAG;
        warningMessage = 'Multiple active examination sessions were detected.';
      }

      if (devtoolsCount > 0) {
        isFlagged = true;
        action = SecurityActionType.FLAG;
      }
    }

    // Persist calculated risk score and level
    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        riskScore: totalScore,
        riskLevel,
        isFlagged,
      },
    });

    // Update Redis risk state
    try {
      await this.redisService.set(
        `exam:attempt:${attemptId}:risk`,
        JSON.stringify({
          riskScore: totalScore,
          riskLevel,
          isFlagged,
          tabSwitchCount,
          fullscreenExitCount,
        }),
        86400,
      );
    } catch {
      // Non-blocking Redis fallback
    }

    return {
      riskScore: totalScore,
      riskLevel,
      isFlagged,
      action,
      warningMessage,
      violationsCount: tabSwitchCount + fullscreenExitCount + devtoolsCount,
    };
  }
}
