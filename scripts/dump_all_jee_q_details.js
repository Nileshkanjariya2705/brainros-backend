const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
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
        where: { language: { code: 'en' } }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  const parsed = questions.map((q, i) => {
    const enTr = q.translations[0] || {};
    return {
      index: i + 1,
      question_id: q.id,
      question_text: enTr.questionText || '',
      passage_text: enTr.passageText || '',
      assertion_text: enTr.assertionText || '',
      reason_text: enTr.reasonText || '',
      options: q.options.reduce((acc, opt) => {
        acc[opt.optionKey.toLowerCase()] = opt.optionText || '';
        return acc;
      }, {}),
      explanation: enTr.explanation || ''
    };
  });

  fs.writeFileSync('scripts/jee_test_questions.json', JSON.stringify(parsed, null, 2));
  console.log('Saved 15 questions to scripts/jee_test_questions.json');
}

main().catch(console.error).finally(() => prisma.$disconnect());
