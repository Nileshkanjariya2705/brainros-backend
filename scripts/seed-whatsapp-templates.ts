/**
 * WhatsApp Notification Template Seeder
 *
 * Seeds NotificationTemplate records for WhatsApp channel:
 * - EXAM_REMINDER (24H variant, version 1)
 * - EXAM_REMINDER (1H variant, version 2)
 * - EXAM_RESULT_PUBLISHED (version 1)
 *
 * These templates are used as fallback free-form text bodies in Sandbox/dev mode.
 * In production with Content Template SIDs, the variables map is used for contentVariables.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-whatsapp-templates.ts
 *
 * Or add to your existing Prisma seed runner.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[WhatsApp Template Seeder] Starting...');

  const templates = [
    {
      notificationType: 'EXAM_REMINDER' as const,
      channel: 'WHATSAPP' as const,
      languageCode: 'en',
      version: 1,
      subject: '24-Hour Exam Reminder',
      body: [
        'Hello {{studentName}},',
        '',
        'This is a reminder that your {{examName}} exam is scheduled for {{examDate}} at {{examStartTime}} (IST).',
        '',
        'Your exam starts in 24 hours. Please log in to Brainros before the scheduled start time and make sure you are in a comfortable, distraction-free environment.',
        '',
        'Good luck! – Team Brainros',
      ].join('\n'),
      variables: {
        fields: ['studentName', 'examName', 'examTarget', 'examDate', 'examStartTime'],
        description: 'Variables for 24-hour exam reminder. examDate format: "15 Sep 2026"',
      },
    },
    {
      notificationType: 'EXAM_REMINDER' as const,
      channel: 'WHATSAPP' as const,
      languageCode: 'en',
      version: 2,
      subject: '1-Hour Exam Reminder',
      body: [
        'Hello {{studentName}},',
        '',
        'Your {{examName}} exam starts in 1 hour at {{examStartTime}} (IST) today!',
        '',
        'Please log in to Brainros now and be ready before the exam begins. Ensure a stable internet connection.',
        '',
        'All the best! – Team Brainros',
      ].join('\n'),
      variables: {
        fields: ['studentName', 'examName', 'examStartTime'],
        description: 'Variables for 1-hour exam reminder.',
      },
    },
    {
      notificationType: 'EXAM_RESULT_PUBLISHED' as const,
      channel: 'WHATSAPP' as const,
      languageCode: 'en',
      version: 1,
      subject: 'Exam Result Published',
      body: [
        'Hello {{studentName}},',
        '',
        'Great news! Your {{examName}} result has been officially published.',
        '',
        'You can now view your result, score, rank, and detailed performance analysis in Brainros.',
        '',
        '{{resultLink}}',
        '',
        '– Team Brainros',
      ].join('\n'),
      variables: {
        fields: ['studentName', 'examName', 'resultLink'],
        description: 'Variables for result publication notification. resultLink is optional.',
      },
    },
  ];

  for (const template of templates) {
    // Deactivate any existing active template for this type/channel/language/version
    await prisma.notificationTemplate.updateMany({
      where: {
        notificationType: template.notificationType,
        channel: template.channel,
        languageCode: template.languageCode,
        version: template.version,
        isActive: true,
      },
      data: { isActive: false },
    });

    // Upsert the template (unique on type + channel + language + version)
    const upserted = await prisma.notificationTemplate.upsert({
      where: {
        notificationType_channel_languageCode_version: {
          notificationType: template.notificationType,
          channel: template.channel,
          languageCode: template.languageCode,
          version: template.version,
        },
      },
      update: {
        subject: template.subject,
        body: template.body,
        variables: template.variables,
        isActive: true,
      },
      create: {
        notificationType: template.notificationType,
        channel: template.channel,
        languageCode: template.languageCode,
        version: template.version,
        subject: template.subject,
        body: template.body,
        variables: template.variables,
        isActive: true,
      },
    });

    console.log(
      `[WhatsApp Template Seeder] Upserted: ${template.notificationType} v${template.version} (${template.subject}) — ID: ${upserted.id}`,
    );
  }

  console.log('[WhatsApp Template Seeder] Done. All 3 WhatsApp templates seeded.');
}

main()
  .catch((err) => {
    console.error('[WhatsApp Template Seeder] Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
