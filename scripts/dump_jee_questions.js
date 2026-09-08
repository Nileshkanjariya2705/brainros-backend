const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const examId = '0374f9e0-f8d7-4f6f-b557-9ae98099795e';
  const questions = await prisma.question.findMany({
    where: {
      examQuestions: {
        some: { examId }
      }
    },
    include: {
      options: { orderBy: { optionKey: 'asc' } },
      translations: {
        include: { language: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Found ${questions.length} questions for exam ${examId}`);
  questions.forEach((q, idx) => {
    console.log(`\n--- Q${idx + 1} [ID: ${q.id}] ---`);
    console.log('Q Keys:', Object.keys(q));
    console.log('Translations:', JSON.stringify(q.translations, null, 2));
    console.log('Options:', q.options.map(o => `[${o.optionKey}] ${o.optionText}`).join(' | '));
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
