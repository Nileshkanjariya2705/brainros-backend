import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamSecurityLevel, SecurityActionType } from '@prisma/client';
import { CreateSecurityProfileDto } from '../dto/security.dto';

@Injectable()
export class ExamSecurityProfileService {
  private readonly logger = new Logger(ExamSecurityProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seed default 4 tier profiles if missing
   */
  async seedDefaultProfiles() {
    const defaults = [
      {
        code: 'STANDARD',
        name: 'Standard Security Profile',
        description:
          'Basic monitoring with tab visibility, focus tracking, and offline support. Fullscreen is optional.',
        level: ExamSecurityLevel.STANDARD,
        fullscreenRequired: false,
        preventCopyPaste: false,
        preventContextMenu: false,
        preventTextSelection: false,
        detectTabSwitch: true,
        detectWindowBlur: true,
        detectFullscreenExit: false,
        detectMultipleSessions: true,
        allowNetworkOffline: true,
        singleSessionRequired: false,
        singleDeviceRequired: false,
        maxTabSwitches: 5,
        maxFullscreenExits: 5,
        warningThreshold: 3,
        autoTerminateThreshold: 20,
        heartbeatIntervalSeconds: 30,
        rules: [
          { ruleCode: 'TAB_SWITCH_COUNT', eventType: 'TAB_HIDDEN', threshold: 3, weight: 3, action: SecurityActionType.WARN },
          { ruleCode: 'LONG_TAB_HIDDEN', eventType: 'TAB_HIDDEN', threshold: 1, weight: 5, action: SecurityActionType.FLAG },
          { ruleCode: 'DEVTOOLS_SHORTCUT', eventType: 'DEVTOOLS_SHORTCUT_DETECTED', threshold: 1, weight: 8, action: SecurityActionType.WARN },
          { ruleCode: 'MULTIPLE_SESSION', eventType: 'MULTIPLE_SESSION_DETECTED', threshold: 1, weight: 15, action: SecurityActionType.FLAG },
        ],
      },
      {
        code: 'STRICT',
        name: 'Strict Security Profile',
        description:
          'Fullscreen required, copy/paste and right-click blocked, active tab and shortcut monitoring.',
        level: ExamSecurityLevel.STRICT,
        fullscreenRequired: true,
        preventCopyPaste: true,
        preventContextMenu: true,
        preventTextSelection: true,
        detectTabSwitch: true,
        detectWindowBlur: true,
        detectFullscreenExit: true,
        detectMultipleSessions: true,
        allowNetworkOffline: true,
        singleSessionRequired: true,
        singleDeviceRequired: false,
        maxTabSwitches: 3,
        maxFullscreenExits: 2,
        warningThreshold: 2,
        autoTerminateThreshold: 10,
        heartbeatIntervalSeconds: 25,
        rules: [
          { ruleCode: 'TAB_SWITCH_COUNT', eventType: 'TAB_HIDDEN', threshold: 2, weight: 5, action: SecurityActionType.WARN },
          { ruleCode: 'FULLSCREEN_EXIT_COUNT', eventType: 'FULLSCREEN_EXITED', threshold: 2, weight: 6, action: SecurityActionType.WARN },
          { ruleCode: 'COPY_PASTE_ATTEMPT', eventType: 'COPY_BLOCKED', threshold: 2, weight: 4, action: SecurityActionType.WARN },
          { ruleCode: 'DEVTOOLS_SHORTCUT', eventType: 'DEVTOOLS_SHORTCUT_DETECTED', threshold: 1, weight: 10, action: SecurityActionType.FLAG },
          { ruleCode: 'MULTIPLE_SESSION', eventType: 'MULTIPLE_SESSION_DETECTED', threshold: 1, weight: 20, action: SecurityActionType.REQUIRE_REAUTH },
        ],
      },
      {
        code: 'HIGH_STAKES',
        name: 'High-Stakes Security Profile',
        description:
          'Single active session strictly enforced, zero tolerance for multiple sessions, low violation thresholds.',
        level: ExamSecurityLevel.HIGH_STAKES,
        fullscreenRequired: true,
        preventCopyPaste: true,
        preventContextMenu: true,
        preventTextSelection: true,
        detectTabSwitch: true,
        detectWindowBlur: true,
        detectFullscreenExit: true,
        detectMultipleSessions: true,
        allowNetworkOffline: true,
        singleSessionRequired: true,
        singleDeviceRequired: true,
        maxTabSwitches: 2,
        maxFullscreenExits: 1,
        warningThreshold: 1,
        autoTerminateThreshold: 5,
        heartbeatIntervalSeconds: 20,
        rules: [
          { ruleCode: 'TAB_SWITCH_COUNT', eventType: 'TAB_HIDDEN', threshold: 1, weight: 8, action: SecurityActionType.WARN },
          { ruleCode: 'FULLSCREEN_EXIT_COUNT', eventType: 'FULLSCREEN_EXITED', threshold: 1, weight: 8, action: SecurityActionType.WARN },
          { ruleCode: 'DEVTOOLS_SHORTCUT', eventType: 'DEVTOOLS_SHORTCUT_DETECTED', threshold: 1, weight: 15, action: SecurityActionType.FLAG },
          { ruleCode: 'MULTIPLE_SESSION', eventType: 'MULTIPLE_SESSION_DETECTED', threshold: 1, weight: 30, action: SecurityActionType.LOCK },
        ],
      },
      {
        code: 'LOCKDOWN',
        name: 'Dedicated Lockdown Client Profile',
        description:
          'Engineered for secure native test clients and managed lockdown devices.',
        level: ExamSecurityLevel.LOCKDOWN,
        fullscreenRequired: true,
        preventCopyPaste: true,
        preventContextMenu: true,
        preventTextSelection: true,
        detectTabSwitch: true,
        detectWindowBlur: true,
        detectFullscreenExit: true,
        detectMultipleSessions: true,
        allowNetworkOffline: false,
        singleSessionRequired: true,
        singleDeviceRequired: true,
        maxTabSwitches: 0,
        maxFullscreenExits: 0,
        warningThreshold: 1,
        autoTerminateThreshold: 3,
        heartbeatIntervalSeconds: 15,
        rules: [
          { ruleCode: 'CLIENT_VIOLATION', eventType: 'SECURITY_POLICY_VIOLATION', threshold: 1, weight: 25, action: SecurityActionType.LOCK },
        ],
      },
    ];

    try {
      for (const def of defaults) {
        const existing = await this.prisma.examSecurityProfile.findUnique({
          where: { code: def.code },
        });
        if (!existing) {
          const { rules, ...profileData } = def;
          const created = await this.prisma.examSecurityProfile.create({
            data: profileData,
          });

          if (rules && rules.length > 0) {
            await this.prisma.examSecurityRule.createMany({
              data: rules.map((r) => ({
                ...r,
                profileId: created.id,
              })),
            });
          }
        }
      }
    } catch (err) {
      this.logger.warn('Could not seed default security profiles: ' + (err?.message || err));
    }
  }

  /**
   * Get all security profiles
   */
  async getAllProfiles() {
    return this.prisma.examSecurityProfile.findMany({
      include: {
        rules: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get security profile for an exam, falling back to STANDARD
   */
  async getExamSecurityProfile(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        securityProfile: {
          include: { rules: true },
        },
      },
    });

    if (exam?.securityProfile) {
      return exam.securityProfile;
    }

    // Default to STANDARD profile
    let standard = await this.prisma.examSecurityProfile.findUnique({
      where: { code: 'STANDARD' },
      include: { rules: true },
    });

    if (!standard) {
      await this.seedDefaultProfiles();
      standard = await this.prisma.examSecurityProfile.findUnique({
        where: { code: 'STANDARD' },
        include: { rules: true },
      });
    }

    return standard;
  }

  /**
   * Get preflight check requirements for student
   */
  async getPreflightInfo(examId: string) {
    const profile = await this.getExamSecurityProfile(examId);
    return {
      examId,
      profile: {
        id: profile?.id,
        name: profile?.name,
        code: profile?.code,
        level: profile?.level,
        version: profile?.version,
        fullscreenRequired: profile?.fullscreenRequired,
        preventCopyPaste: profile?.preventCopyPaste,
        preventContextMenu: profile?.preventContextMenu,
        preventTextSelection: profile?.preventTextSelection,
        allowNetworkOffline: profile?.allowNetworkOffline,
        heartbeatIntervalSeconds: profile?.heartbeatIntervalSeconds,
      },
      instructions: [
        profile?.fullscreenRequired
          ? 'Exam must be taken in Fullscreen Mode throughout the duration.'
          : 'Stay on the exam window throughout your test.',
        'Do not switch tabs, minimize windows, or use background shortcuts.',
        profile?.preventCopyPaste
          ? 'Copying, cutting, or pasting question content is strictly restricted.'
          : 'Answer questions directly in the test interface.',
        'Only one active examination session is permitted per student.',
        'Ensure unauthorized physical devices (phones, smartwatches) are kept away.',
      ],
    };
  }

  /**
   * Record student acceptance of security policy
   */
  async acceptSecurityPolicy(
    attemptId: string,
    profileId: string,
    policyVersion: number = 1,
    ipAddress?: string,
    userAgent?: string,
  ) {
    return this.prisma.attemptSecurityAcceptance.upsert({
      where: {
        attemptId_securityProfileId_policyVersion: {
          attemptId,
          securityProfileId: profileId,
          policyVersion,
        },
      },
      update: {
        acceptedAt: new Date(),
        ipAddress,
        userAgent,
      },
      create: {
        attemptId,
        securityProfileId: profileId,
        policyVersion,
        acceptedAt: new Date(),
        ipAddress,
        userAgent,
      },
    });
  }
}
