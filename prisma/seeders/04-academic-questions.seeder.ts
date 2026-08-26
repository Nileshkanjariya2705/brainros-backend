import { SeedContext, SeederResult } from './types';
import {
  QuestionDifficultyEnum,
  QuestionTypeEnum,
  QuestionStatus,
  Question,
  QuestionOption,
} from '@prisma/client';

export async function seedAcademicQuestions(ctx: SeedContext): Promise<SeederResult> {
  const start = Date.now();
  const created: Record<string, number> = {};
  const reused: Record<string, number> = {};

  const inc = (type: string, isNew: boolean) => {
    if (isNew) created[type] = (created[type] || 0) + 1;
    else reused[type] = (reused[type] || 0) + 1;
  };

  const { prisma } = ctx;
  const adminUser = ctx.users.get('admin.neet@brainros.test') || ctx.users.get('superadmin@brainros.test')!;
  const defaultLang = ctx.languages.get('en')!;
  const hindiLang = ctx.languages.get('hi');
  const kannadaLang = ctx.languages.get('kn');

  const neetTarget = ctx.examTargets.get('NEET')!;
  const jeeTarget = ctx.examTargets.get('JEE_MAIN')!;

  // 1. Subjects Setup
  const subjectsData = [
    // NEET Subjects
    { target: neetTarget, name: 'Physics (NEET)', code: 'NEET_PHY', displayOrder: 1 },
    { target: neetTarget, name: 'Chemistry (NEET)', code: 'NEET_CHEM', displayOrder: 2 },
    { target: neetTarget, name: 'Botany', code: 'NEET_BOT', displayOrder: 3 },
    { target: neetTarget, name: 'Zoology', code: 'NEET_ZOO', displayOrder: 4 },
    // JEE Subjects
    { target: jeeTarget, name: 'Physics (JEE)', code: 'JEE_PHY', displayOrder: 1 },
    { target: jeeTarget, name: 'Chemistry (JEE)', code: 'JEE_CHEM', displayOrder: 2 },
    { target: jeeTarget, name: 'Mathematics', code: 'JEE_MATH', displayOrder: 3 },
  ];

  for (const sData of subjectsData) {
    let subject = await prisma.subject.findUnique({
      where: {
        examTargetId_name: { examTargetId: sData.target.id, name: sData.name },
      },
    });
    if (!subject) {
      subject = await prisma.subject.create({
        data: {
          examTargetId: sData.target.id,
          name: sData.name,
          code: sData.code,
          displayOrder: sData.displayOrder,
          isActive: true,
        },
      });
      inc('subjects', true);
    } else {
      inc('subjects', false);
    }
    ctx.subjects.set(`${sData.target.name}:${sData.name}`, subject);
    ctx.subjects.set(sData.name, subject);
  }

  // 2. Chapters, Topics, SubTopics Setup
  const curriculum = [
    {
      subjectName: 'Physics (NEET)',
      chapters: [
        {
          name: 'Laws of Motion & Mechanics',
          topics: [
            { name: 'Newton Laws of Motion', subTopics: ['Inertia and Force', 'Friction and Drag'] },
            { name: 'Work Energy and Power', subTopics: ['Kinetic Energy Theorem', 'Conservative Forces'] },
          ],
        },
        {
          name: 'Electrostatics & Current Electricity',
          topics: [
            { name: 'Coulombs Law & Electric Field', subTopics: ['Electric Dipole', 'Gauss Theorem'] },
            { name: 'Ohm Law and Circuits', subTopics: ['Kirchhoff Laws', 'Wheatstone Bridge'] },
          ],
        },
      ],
    },
    {
      subjectName: 'Chemistry (NEET)',
      chapters: [
        {
          name: 'Chemical Bonding & Molecular Structure',
          topics: [
            { name: 'VSEPR Theory & Hybridization', subTopics: ['sp3 and sp2 Geometry', 'Dipole Moments'] },
            { name: 'Molecular Orbital Theory', subTopics: ['Bond Order Calculation', 'Paramagnetism'] },
          ],
        },
        {
          name: 'Organic Chemistry - Hydrocarbons & Functional Groups',
          topics: [
            { name: 'Alkanes and Alkenes', subTopics: ['Markovnikov Rule', 'Ozonolysis'] },
            { name: 'Aldehydes and Ketones', subTopics: ['Aldol Condensation', 'Cannizzaro Reaction'] },
          ],
        },
      ],
    },
    {
      subjectName: 'Botany',
      chapters: [
        {
          name: 'Plant Physiology & Photosynthesis',
          topics: [
            { name: 'Light Reaction & Z-Scheme', subTopics: ['Photosystem I and II', 'Photophosphorylation'] },
            { name: 'Calvin Cycle (C3 & C4)', subTopics: ['RuBisCO Enzyme', 'Kranz Anatomy'] },
          ],
        },
        {
          name: 'Genetics and Plant Reproduction',
          topics: [
            { name: 'Mendelian Genetics', subTopics: ['Monohybrid Cross', 'Incomplete Dominance'] },
            { name: 'Sexual Reproduction in Plants', subTopics: ['Double Fertilization', 'Pollen Grain Structure'] },
          ],
        },
      ],
    },
    {
      subjectName: 'Zoology',
      chapters: [
        {
          name: 'Human Physiology - Circulation & Excretion',
          topics: [
            { name: 'Human Circulatory System', subTopics: ['Cardiac Cycle', 'ECG Waves'] },
            { name: 'Excretory Products & Elimination', subTopics: ['Nephron Filtration', 'Counter Current Mechanism'] },
          ],
        },
      ],
    },
    {
      subjectName: 'Mathematics',
      chapters: [
        {
          name: 'Differential & Integral Calculus',
          topics: [
            { name: 'Limits and Continuity', subTopics: ['L Hospital Rule', 'Differentiability'] },
            { name: 'Definite Integration', subTopics: ['Properties of Definite Integrals', 'Area Under Curves'] },
          ],
        },
      ],
    },
  ];

  for (const curr of curriculum) {
    const subject = ctx.subjects.get(curr.subjectName)!;

    for (const cData of curr.chapters) {
      let chapter = await prisma.chapter.findUnique({
        where: {
          subjectId_name: { subjectId: subject.id, name: cData.name },
        },
      });
      if (!chapter) {
        chapter = await prisma.chapter.create({
          data: { subjectId: subject.id, name: cData.name, isActive: true },
        });
        inc('chapters', true);
      } else {
        inc('chapters', false);
      }
      ctx.chapters.set(`${curr.subjectName}:${cData.name}`, chapter);
      ctx.chapters.set(cData.name, chapter);

      for (const tData of cData.topics) {
        let topic = await prisma.topic.findUnique({
          where: {
            chapterId_name: { chapterId: chapter.id, name: tData.name },
          },
        });
        if (!topic) {
          topic = await prisma.topic.create({
            data: { chapterId: chapter.id, name: tData.name, isActive: true },
          });
          inc('topics', true);
        } else {
          inc('topics', false);
        }
        ctx.topics.set(`${cData.name}:${tData.name}`, topic);
        ctx.topics.set(tData.name, topic);

        for (const stName of tData.subTopics) {
          let subTopic = await prisma.subTopic.findUnique({
            where: {
              topicId_name: { topicId: topic.id, name: stName },
            },
          });
          if (!subTopic) {
            subTopic = await prisma.subTopic.create({
              data: { topicId: topic.id, name: stName, isActive: true },
            });
            inc('sub_topics', true);
          } else {
            inc('sub_topics', false);
          }
          ctx.subTopics.set(`${tData.name}:${stName}`, subTopic);
        }
      }
    }
  }

  // 3. Generate Questions across subjects
  const diffEasy = ctx.difficulties.get('EASY');
  const diffMed = ctx.difficulties.get('MEDIUM');
  const diffHard = ctx.difficulties.get('HARD');

  const qTypeSingle = ctx.questionTypes.get('SINGLE_CORRECT');
  const qTypeMulti = ctx.questionTypes.get('MULTIPLE_CORRECT');
  const qTypeNumerical = ctx.questionTypes.get('NUMERICAL');
  const qTypeAssertion = ctx.questionTypes.get('ASSERTION_REASON');

  const sampleQuestions = [
    // 1. Physics Single Choice
    {
      subjectName: 'Physics (NEET)',
      chapterName: 'Laws of Motion & Mechanics',
      type: QuestionTypeEnum.SINGLE_CORRECT,
      difficulty: QuestionDifficultyEnum.MEDIUM,
      diffId: diffMed?.id,
      qTypeId: qTypeSingle?.id,
      text: 'A block of mass 2 kg is placed on a rough horizontal surface with coefficient of static friction 0.4. What minimum force is required to move the block? (Take g = 9.8 m/s²)',
      textHi: '2 किग्रा द्रव्यमान का एक गुटका 0.4 स्थैतिक घर्षण गुणांक वाली खुरदरी क्षैतिज सतह पर रखा है। गुटके को खिसकाने के लिए आवश्यक न्यूनतम बल कितना होगा? (g = 9.8 m/s²)',
      textKn: 'ಸ್ಥಿರ ಘರ್ಷಣೆಯ ಗುಣಾಂಕ 0.4 ಇರುವ ಒರಟಾದ ಸಮತಲದ ಮೇಲೆ 2 kg ದ್ರವ್ಯರಾಶಿಯ ಬ್ಲಾಕ್ ಇರಿಸಲಾಗಿದೆ. ಬ್ಲಾಕ್ ಚಲಿಸಲು ಬೇಕಾದ ಕನಿಷ್ಠ ಬಲ ಎಷ್ಟು?',
      options: [
        { key: 'A', text: '7.84 N', isCorrect: true },
        { key: 'B', text: '9.8 N', isCorrect: false },
        { key: 'C', text: '19.6 N', isCorrect: false },
        { key: 'D', text: '3.92 N', isCorrect: false },
      ],
      explanation: 'Limiting friction f_max = mu_s * N = 0.4 * (2 * 9.8) = 7.84 N.',
      marks: 4,
      negMarks: 1,
    },
    // 2. Physics Numerical
    {
      subjectName: 'Physics (NEET)',
      chapterName: 'Electrostatics & Current Electricity',
      type: QuestionTypeEnum.NUMERICAL,
      difficulty: QuestionDifficultyEnum.EASY,
      diffId: diffEasy?.id,
      qTypeId: qTypeNumerical?.id,
      text: 'Two point charges of +2 microcoulomb and +8 microcoulomb are separated by a distance of 6 cm. Find the distance (in cm) from the +2 microcoulomb charge where the electric field is zero.',
      textHi: '+2 माइक्रोकुलाम और +8 माइक्रोकुलाम के दो बिंदु आवेश 6 सेमी की दूरी पर स्थित हैं। +2 माइक्रोकुलाम आवेश से वह दूरी (सेमी में) ज्ञात कीजिए जहाँ विद्युत क्षेत्र शून्य हो।',
      textKn: '+2 ಮೈಕ್ರೋಕೂಲಂಬ್ ಮತ್ತು +8 ಮೈಕ್ರೋಕೂಲಂಬ್‌ನ ಎರಡು ಬಿಂದು ಆವೇಶಗಳು 6 cm ಅಂತರದಲ್ಲಿವೆ. ವಿದ್ಯುತ್ ಕ್ಷೇತ್ರ ಶೂನ್ಯವಾಗುವ ದೂರವನ್ನು (cm ನಲ್ಲಿ) ಕಂಡುಹಿಡಿಯಿರಿ.',
      options: [],
      numericalAnswer: 2.0,
      numericalTolerance: 0.05,
      explanation: 'Distance x = d / (sqrt(q2/q1) + 1) = 6 / (sqrt(8/2) + 1) = 6 / (2 + 1) = 2.0 cm.',
      marks: 4,
      negMarks: 0,
    },
    // 3. Chemistry Assertion-Reason
    {
      subjectName: 'Chemistry (NEET)',
      chapterName: 'Chemical Bonding & Molecular Structure',
      type: QuestionTypeEnum.ASSERTION_REASON,
      difficulty: QuestionDifficultyEnum.HARD,
      diffId: diffHard?.id,
      qTypeId: qTypeAssertion?.id,
      assertion: 'Assertion (A): The bond angle in NH3 is less than the tetrahedral angle of 109.5°.',
      reason: 'Reason (R): The lone pair - bond pair repulsion in NH3 is greater than the bond pair - bond pair repulsion.',
      text: 'Read the Assertion (A) and Reason (R) statements carefully and select the correct alternative.',
      options: [
        { key: 'A', text: 'Both (A) and (R) are true and (R) is the correct explanation of (A).', isCorrect: true },
        { key: 'B', text: 'Both (A) and (R) are true but (R) is NOT the correct explanation of (A).', isCorrect: false },
        { key: 'C', text: '(A) is true but (R) is false.', isCorrect: false },
        { key: 'D', text: 'Both (A) and (R) are false.', isCorrect: false },
      ],
      explanation: 'According to VSEPR theory, lone pair-bond pair repulsion compresses the H-N-H bond angle to 107°.',
      marks: 4,
      negMarks: 1,
    },
    // 4. Botany Single Choice
    {
      subjectName: 'Botany',
      chapterName: 'Plant Physiology & Photosynthesis',
      type: QuestionTypeEnum.SINGLE_CORRECT,
      difficulty: QuestionDifficultyEnum.EASY,
      diffId: diffEasy?.id,
      qTypeId: qTypeSingle?.id,
      text: 'In C4 plants, the primary carbon dioxide acceptor is:',
      textHi: 'C4 पौधों में प्राथमिक कार्बन डाइऑक्साइड स्वीकर्ता कौन सा है?',
      textKn: 'C4 ಸಸ್ಯಗಳಲ್ಲಿ ಪ್ರಾಥಮಿಕ ಇಂಗಾಲದ ಡೈಆಕ್ಸೈಡ್ ಗ್ರಾಹಕ ಯಾವುದು?',
      options: [
        { key: 'A', text: 'Phosphoenolpyruvate (PEP)', isCorrect: true },
        { key: 'B', text: 'Ribulose 1,5-bisphosphate (RuBP)', isCorrect: false },
        { key: 'C', text: 'Oxaloacetic acid (OAA)', isCorrect: false },
        { key: 'D', text: 'Phosphoglyceric acid (PGA)', isCorrect: false },
      ],
      explanation: 'In C4 plants, PEP (3-carbon molecule) is the primary CO2 acceptor catalyzed by PEP carboxylase.',
      marks: 4,
      negMarks: 1,
    },
    // 5. Zoology Single Choice
    {
      subjectName: 'Zoology',
      chapterName: 'Human Physiology - Circulation & Excretion',
      type: QuestionTypeEnum.SINGLE_CORRECT,
      difficulty: QuestionDifficultyEnum.MEDIUM,
      diffId: diffMed?.id,
      qTypeId: qTypeSingle?.id,
      text: 'During a cardiac cycle, the duration of ventricular systole in a healthy human is approximately:',
      textHi: 'एक स्वस्थ मनुष्य में हृदय चक्र के दौरान निलय प्रकुंचन (वेंट्रिकुलर सिस्टोल) की अवधि लगभग कितनी होती है?',
      textKn: 'ಆರೋಗ್ಯವಂತ ಮನುಷ್ಯನಲ್ಲಿ ಹೃದಯ ಚಕ್ರದ ಸಮಯದಲ್ಲಿ ವೆಂಟ್ರಿಕ್ಯುಲರ್ ಸಂಕೋಚನದ ಅವಧಿ ಸರಿಸುಮಾರು ಎಷ್ಟು?',
      options: [
        { key: 'A', text: '0.3 seconds', isCorrect: true },
        { key: 'B', text: '0.1 seconds', isCorrect: false },
        { key: 'C', text: '0.5 seconds', isCorrect: false },
        { key: 'D', text: '0.8 seconds', isCorrect: false },
      ],
      explanation: 'In a 0.8s cardiac cycle: Auricular systole = 0.1s, Ventricular systole = 0.3s, Joint diastole = 0.4s.',
      marks: 4,
      negMarks: 1,
    },
    // 6. Mathematics Calculus
    {
      subjectName: 'Mathematics',
      chapterName: 'Differential & Integral Calculus',
      type: QuestionTypeEnum.SINGLE_CORRECT,
      difficulty: QuestionDifficultyEnum.MEDIUM,
      diffId: diffMed?.id,
      qTypeId: qTypeSingle?.id,
      text: 'The value of lim (x -> 0) [sin(5x) / tan(2x)] is equal to:',
      options: [
        { key: 'A', text: '5/2', isCorrect: true },
        { key: 'B', text: '2/5', isCorrect: false },
        { key: 'C', text: '1', isCorrect: false },
        { key: 'D', text: '0', isCorrect: false },
      ],
      explanation: 'lim (sin 5x / 5x) * 5 / ((tan 2x / 2x) * 2) = 1 * 5 / (1 * 2) = 5/2.',
      marks: 4,
      negMarks: 1,
    },
  ];

  // We will generate 30 high quality questions by cycling/multiplying subjects
  let qSequence = 1;

  for (const sq of sampleQuestions) {
    const subject = ctx.subjects.get(sq.subjectName)!;
    const chapter = ctx.chapters.get(sq.chapterName)!;

    // Create 5 variants of each core question across topics to provide a rich question bank
    for (let variant = 1; variant <= 5; variant++) {
      const qCode = `Q_${sq.subjectName.replace(/[^A-Z]/g, '')}_${qSequence++}`;
      const qText = variant === 1 ? sq.text : `[Variant ${variant}] ${sq.text}`;

      const question = await prisma.question.create({
        data: {
          subjectId: subject.id,
          chapterId: chapter.id,
          difficultyId: sq.diffId,
          difficultyLevel: sq.difficulty,
          questionTypeId: sq.qTypeId,
          type: sq.type,
          status: QuestionStatus.APPROVED,
          version: 1,
          defaultLanguageId: defaultLang.id,
          marks: sq.marks,
          negativeMarks: sq.negMarks,
          assertion: sq.assertion,
          reason: sq.reason,
          createdById: adminUser.id,
          submittedById: adminUser.id,
          submittedAt: new Date('2026-03-01'),
          reviewedById: adminUser.id,
          reviewedAt: new Date('2026-03-02'),
          approvedById: adminUser.id,
          approvedAt: new Date('2026-03-03'),
          isActive: true,
        },
      });
      inc('questions', true);
      ctx.questions.set(qCode, question);

      // 1. Default Translation (English)
      await prisma.questionTranslation.create({
        data: {
          questionId: question.id,
          languageId: defaultLang.id,
          questionText: qText,
          assertionText: sq.assertion,
          reasonText: sq.reason,
          explanation: sq.explanation,
        },
      });
      inc('question_translations', true);

      // 2. Hindi Translation
      if (hindiLang && sq.textHi) {
        await prisma.questionTranslation.create({
          data: {
            questionId: question.id,
            languageId: hindiLang.id,
            questionText: variant === 1 ? sq.textHi : `[रूपांतर ${variant}] ${sq.textHi}`,
            explanation: sq.explanation,
          },
        });
        inc('question_translations', true);
      }

      // 3. Kannada Translation
      if (kannadaLang && sq.textKn) {
        await prisma.questionTranslation.create({
          data: {
            questionId: question.id,
            languageId: kannadaLang.id,
            questionText: variant === 1 ? sq.textKn : `[ರೂಪಾಂತರ ${variant}] ${sq.textKn}`,
            explanation: sq.explanation,
          },
        });
        inc('question_translations', true);
      }

      // 4. Options
      const createdOptions: QuestionOption[] = [];
      let correctOptionId: string | null = null;

      for (let oIdx = 0; oIdx < sq.options.length; oIdx++) {
        const opt = sq.options[oIdx];
        const option = await prisma.questionOption.create({
          data: {
            questionId: question.id,
            optionKey: opt.key,
            optionText: opt.text,
            isCorrect: opt.isCorrect,
            displayOrder: oIdx + 1,
          },
        });
        inc('question_options', true);
        createdOptions.push(option);
        if (opt.isCorrect) correctOptionId = option.id;
      }
      ctx.questionOptions.set(question.id, createdOptions);

      // 5. Answer Entity
      await prisma.questionAnswer.create({
        data: {
          questionId: question.id,
          answerType: sq.type,
          correctOptionIds: correctOptionId ? [correctOptionId] : undefined,
          numericalAnswer: sq.numericalAnswer ?? null,
          numericalTolerance: sq.numericalTolerance ?? 0,
        },
      });
      inc('question_answers', true);

      // 6. Explanation
      await prisma.questionExplanation.create({
        data: {
          questionId: question.id,
          explanation: sq.explanation,
        },
      });
      inc('question_explanations', true);
    }
  }

  return {
    seederName: 'AcademicQuestionsSeeder',
    createdCounts: created,
    reusedCounts: reused,
    timeMs: Date.now() - start,
  };
}
