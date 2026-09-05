/**
 * Standalone startup-seed script.
 *
 * Replaces the old onModuleInit() auto-seeding that caused
 * "PANIC: timer has gone away" crash loops on Hostinger.
 *
 * Run ONCE after deployment (or via `npx prisma db seed`):
 *   npx ts-node prisma/seed-startup.ts
 *
 * Safe to re-run — every seeder is idempotent (upsert / skip-if-exists).
 */

import { PrismaClient, ExamSecurityLevel, SecurityActionType, NotificationChannel, NotificationType } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

// ─── Regional Languages ────────────────────────────────────────────
const REGIONAL_LANGUAGES = [
  { code: 'en', name: 'English',   nativeName: 'English',   description: 'Universal default language',                          displayOrder: 1 },
  { code: 'kn', name: 'Kannada',   nativeName: 'ಕನ್ನಡ',      description: 'Regional language of Karnataka',                      displayOrder: 2 },
  { code: 'hi', name: 'Hindi',     nativeName: 'हिन्दी',      description: 'National language (Devanagari)',                      displayOrder: 3 },
  { code: 'ta', name: 'Tamil',     nativeName: 'தமிழ்',       description: 'Regional language of Tamil Nadu',                     displayOrder: 4 },
  { code: 'te', name: 'Telugu',    nativeName: 'తెలుగు',      description: 'Regional language of Andhra Pradesh & Telangana',     displayOrder: 5 },
  { code: 'mr', name: 'Marathi',   nativeName: 'मराठी',       description: 'Regional language of Maharashtra',                    displayOrder: 6 },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം',      description: 'Regional language of Kerala',                        displayOrder: 7 },
  { code: 'bn', name: 'Bengali',   nativeName: 'বাংলা',       description: 'Regional language of West Bengal',                    displayOrder: 8 },
  { code: 'gu', name: 'Gujarati',  nativeName: 'ગુજરાતી',     description: 'Regional language of Gujarat',                       displayOrder: 9 },
];

async function seedRegionalLanguages() {
  console.log('[1/3] Seeding regional languages...');
  for (const lang of REGIONAL_LANGUAGES) {
    try {
      const existing = await prisma.preferredLanguage.findFirst({
        where: { OR: [{ code: lang.code }, { name: lang.name }] },
      });

      if (!existing) {
        await prisma.preferredLanguage.create({
          data: {
            code: lang.code,
            name: lang.name,
            nativeName: lang.nativeName,
            description: lang.description,
            displayOrder: lang.displayOrder,
            isActive: true,
          },
        });
        console.log(`  ✓ Created: ${lang.name} (${lang.code})`);
      } else if (!existing.code || !existing.nativeName) {
        await prisma.preferredLanguage.update({
          where: { id: existing.id },
          data: {
            code: lang.code,
            nativeName: lang.nativeName,
            description: existing.description || lang.description,
            displayOrder: existing.displayOrder || lang.displayOrder,
          },
        });
        console.log(`  ↻ Updated: ${lang.name} (${lang.code})`);
      } else {
        console.log(`  – Skipped: ${lang.name} (already exists)`);
      }
    } catch (err: any) {
      console.warn(`  ⚠ Failed seeding language ${lang.name}: ${err.message}`);
    }
  }
}

// ─── Security Profiles ─────────────────────────────────────────────
async function seedSecurityProfiles() {
  console.log('[2/3] Seeding exam security profiles...');
  const defaults = [
    {
      code: 'STANDARD', name: 'Standard Security Profile', level: ExamSecurityLevel.STANDARD,
      description: 'Basic monitoring with tab visibility, focus tracking, and offline support.',
      fullscreenRequired: false, preventCopyPaste: false, preventContextMenu: false, preventTextSelection: false,
      detectTabSwitch: true, detectWindowBlur: true, detectFullscreenExit: false, detectMultipleSessions: true,
      allowNetworkOffline: true, singleSessionRequired: false, singleDeviceRequired: false,
      maxTabSwitches: 5, maxFullscreenExits: 5, warningThreshold: 3, autoTerminateThreshold: 20, heartbeatIntervalSeconds: 30,
      rules: [
        { ruleCode: 'TAB_SWITCH_COUNT', eventType: 'TAB_HIDDEN', threshold: 3, weight: 3, action: SecurityActionType.WARN },
        { ruleCode: 'LONG_TAB_HIDDEN', eventType: 'TAB_HIDDEN', threshold: 1, weight: 5, action: SecurityActionType.FLAG },
        { ruleCode: 'DEVTOOLS_SHORTCUT', eventType: 'DEVTOOLS_SHORTCUT_DETECTED', threshold: 1, weight: 8, action: SecurityActionType.WARN },
        { ruleCode: 'MULTIPLE_SESSION', eventType: 'MULTIPLE_SESSION_DETECTED', threshold: 1, weight: 15, action: SecurityActionType.FLAG },
      ],
    },
    {
      code: 'STRICT', name: 'Strict Security Profile', level: ExamSecurityLevel.STRICT,
      description: 'Fullscreen required, copy/paste and right-click blocked.',
      fullscreenRequired: true, preventCopyPaste: true, preventContextMenu: true, preventTextSelection: true,
      detectTabSwitch: true, detectWindowBlur: true, detectFullscreenExit: true, detectMultipleSessions: true,
      allowNetworkOffline: true, singleSessionRequired: true, singleDeviceRequired: false,
      maxTabSwitches: 3, maxFullscreenExits: 2, warningThreshold: 2, autoTerminateThreshold: 10, heartbeatIntervalSeconds: 25,
      rules: [
        { ruleCode: 'TAB_SWITCH_COUNT', eventType: 'TAB_HIDDEN', threshold: 2, weight: 5, action: SecurityActionType.WARN },
        { ruleCode: 'FULLSCREEN_EXIT_COUNT', eventType: 'FULLSCREEN_EXITED', threshold: 2, weight: 6, action: SecurityActionType.WARN },
        { ruleCode: 'COPY_PASTE_ATTEMPT', eventType: 'COPY_BLOCKED', threshold: 2, weight: 4, action: SecurityActionType.WARN },
        { ruleCode: 'DEVTOOLS_SHORTCUT', eventType: 'DEVTOOLS_SHORTCUT_DETECTED', threshold: 1, weight: 10, action: SecurityActionType.FLAG },
        { ruleCode: 'MULTIPLE_SESSION', eventType: 'MULTIPLE_SESSION_DETECTED', threshold: 1, weight: 20, action: SecurityActionType.REQUIRE_REAUTH },
      ],
    },
    {
      code: 'HIGH_STAKES', name: 'High-Stakes Security Profile', level: ExamSecurityLevel.HIGH_STAKES,
      description: 'Single active session strictly enforced, zero tolerance.',
      fullscreenRequired: true, preventCopyPaste: true, preventContextMenu: true, preventTextSelection: true,
      detectTabSwitch: true, detectWindowBlur: true, detectFullscreenExit: true, detectMultipleSessions: true,
      allowNetworkOffline: true, singleSessionRequired: true, singleDeviceRequired: true,
      maxTabSwitches: 2, maxFullscreenExits: 1, warningThreshold: 1, autoTerminateThreshold: 5, heartbeatIntervalSeconds: 20,
      rules: [
        { ruleCode: 'TAB_SWITCH_COUNT', eventType: 'TAB_HIDDEN', threshold: 1, weight: 8, action: SecurityActionType.WARN },
        { ruleCode: 'FULLSCREEN_EXIT_COUNT', eventType: 'FULLSCREEN_EXITED', threshold: 1, weight: 8, action: SecurityActionType.WARN },
        { ruleCode: 'DEVTOOLS_SHORTCUT', eventType: 'DEVTOOLS_SHORTCUT_DETECTED', threshold: 1, weight: 15, action: SecurityActionType.FLAG },
        { ruleCode: 'MULTIPLE_SESSION', eventType: 'MULTIPLE_SESSION_DETECTED', threshold: 1, weight: 30, action: SecurityActionType.LOCK },
      ],
    },
    {
      code: 'LOCKDOWN', name: 'Dedicated Lockdown Client Profile', level: ExamSecurityLevel.LOCKDOWN,
      description: 'Engineered for secure native test clients.',
      fullscreenRequired: true, preventCopyPaste: true, preventContextMenu: true, preventTextSelection: true,
      detectTabSwitch: true, detectWindowBlur: true, detectFullscreenExit: true, detectMultipleSessions: true,
      allowNetworkOffline: false, singleSessionRequired: true, singleDeviceRequired: true,
      maxTabSwitches: 0, maxFullscreenExits: 0, warningThreshold: 1, autoTerminateThreshold: 3, heartbeatIntervalSeconds: 15,
      rules: [
        { ruleCode: 'CLIENT_VIOLATION', eventType: 'SECURITY_POLICY_VIOLATION', threshold: 1, weight: 25, action: SecurityActionType.LOCK },
      ],
    },
  ];

  for (const def of defaults) {
    try {
      const existing = await prisma.examSecurityProfile.findUnique({
        where: { code: def.code },
      });
      if (!existing) {
        const { rules, ...profileData } = def;
        const created = await prisma.examSecurityProfile.create({ data: profileData });
        if (rules && rules.length > 0) {
          await prisma.examSecurityRule.createMany({
            data: rules.map((r) => ({ ...r, profileId: created.id })),
          });
        }
        console.log(`  ✓ Created: ${def.name}`);
      } else {
        console.log(`  – Skipped: ${def.name} (already exists)`);
      }
    } catch (err: any) {
      console.warn(`  ⚠ Failed seeding profile ${def.code}: ${err.message}`);
    }
  }
}

// ─── Notification Templates ────────────────────────────────────────
async function seedNotificationTemplates() {
  console.log('[3/3] Seeding notification templates...');
  try {
    const count = await prisma.notificationTemplate.count();
    if (count > 0) {
      console.log('  – Skipped: templates already exist');
      return;
    }

    const defaults = [
      { notificationType: NotificationType.OTP, channel: NotificationChannel.SMS, languageCode: 'en',
        body: 'Your Brainros security verification code is {{otp}}. Valid for {{validMinutes}} minutes. Do not share this code.' },
      { notificationType: NotificationType.REGISTRATION_CONFIRMATION, channel: NotificationChannel.EMAIL, languageCode: 'en',
        subject: 'Welcome to Brainros Exam Management Platform',
        body: 'Hello {{name}},\n\nYour account has been successfully created. Welcome aboard!' },
      { notificationType: NotificationType.EXAM_SCHEDULED, channel: NotificationChannel.EMAIL, languageCode: 'en',
        subject: 'Exam Scheduled: {{examTitle}}',
        body: 'Hello {{studentName}},\n\n{{examTitle}} is scheduled for {{plannedDate}} at {{startTime}} ({{timezone}}).' },
      { notificationType: NotificationType.EXAM_REMINDER, channel: NotificationChannel.PUSH, languageCode: 'en',
        body: 'Reminder: {{examTitle}} starts in {{startsIn}}! Make sure you are ready.' },
      { notificationType: NotificationType.RESULT_AVAILABLE, channel: NotificationChannel.EMAIL, languageCode: 'en',
        subject: 'Your Exam Result is Ready: {{examTitle}}',
        body: 'Hello {{studentName}},\n\nYour evaluation and analytics for {{examTitle}} are now live in your student portal.' },
      { notificationType: NotificationType.REPORT_READY, channel: NotificationChannel.EMAIL, languageCode: 'en',
        subject: 'Your Downloadable Report is Ready',
        body: 'Hello {{name}},\n\nYour requested report {{fileName}} is ready for download in your institution portal.' },
    ];

    for (const t of defaults) {
      await prisma.notificationTemplate.create({
        data: {
          notificationType: t.notificationType,
          channel: t.channel,
          languageCode: t.languageCode,
          subject: (t as any).subject || null,
          body: t.body,
          version: 1,
          isActive: true,
        },
      });
    }
    console.log('  ✓ Seeded default notification templates');
  } catch (err: any) {
    console.warn(`  ⚠ Failed seeding notification templates: ${err.message}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🔧 BRAINROS — ONE-TIME STARTUP SEED (post-deploy)');
  console.log('════════════════════════════════════════════════════════════════\n');

  // Run sequentially to avoid overwhelming the Prisma engine on shared hosting
  await seedRegionalLanguages();
  await seedSecurityProfiles();
  await seedNotificationTemplates();

  console.log('\n✅ Startup seed completed successfully.\n');
}

main()
  .catch((e) => {
    console.error('❌ Startup seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
