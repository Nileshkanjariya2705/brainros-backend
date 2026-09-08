const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const examId = '0374f9e0-f8d7-4f6f-b557-9ae98099795e';
  const languageId = '57bdaa71-e2b3-48c6-bc0d-a26c4def36ee';

  console.log('Testing getExamQuestionsAndOptions query...');
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      status: true,
      examTarget: true,
      languages: {
        include: { language: true },
        orderBy: { displayOrder: 'asc' },
      },
      sections: {
        include: {
          examQuestions: {
            include: {
              question: {
                include: {
                  options: { orderBy: { displayOrder: 'asc' } },
                  translations: true,
                },
              },
            },
          },
        },
      },
    },
  });

  console.log('Exam query succeeded! Sections:', exam.sections.length);

  // Flatten questions
  const questionMap = new Map();
  for (const section of exam.sections || []) {
    for (const eq of section.examQuestions || []) {
      if (eq.question && !questionMap.has(eq.question.id)) {
        questionMap.set(eq.question.id, eq.question);
      }
    }
  }

  const questions = Array.from(questionMap.values());
  const questionIds = questions.map((q) => q.id);
  console.log('Total questions:', questions.length);

  console.log('Testing questionTranslation.findMany query...');
  const existingQTranslations = await prisma.questionTranslation.findMany({
    where: { questionId: { in: questionIds }, languageId },
  });
  console.log('existingQTranslations query succeeded! Count:', existingQTranslations.length);
}

main().catch(err => {
  console.error('Stack trace:', err);
}).finally(() => prisma.$disconnect());
