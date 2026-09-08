const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

const examId = '0374f9e0-f8d7-4f6f-b557-9ae98099795e';
const hindiLangId = '8074293d-ee68-4b74-8d9f-b77e53624035';
const gujaratiLangId = '57bdaa71-e2b3-48c6-bc0d-a26c4def36ee';

const questionsData = [
  // Q1 - Q5 (Physics Mechanics)
  {
    ids: [
      'cc96a433-2600-41f9-a097-580d10e07b7e',
      'e1d68618-5b57-429e-869d-9256dbfe942b',
      '745c0ed1-fc49-4424-9408-d9b744102d8c',
      '465964b4-48de-4963-86b3-9aa08a01d7c3',
      '1e06f512-689e-40bc-b19f-550dcdaadcdf'
    ],
    hi: {
      questionTextPrefix: '2 kg द्रव्यमान का एक ब्लॉक 0.4 स्थैतिक घर्षण गुणांक वाले एक खुरदरे क्षैतिज समतल पर रखा गया है। ब्लॉक को खिसकाने के लिए न्यूनतम कितने बल की आवश्यकता होगी? (g = 9.8 m/s² लीजिए)',
      options: { a: '7.84 N', b: '9.8 N', c: '19.6 N', d: '3.92 N' },
      explanation: 'सीमांत घर्षण बल f_max = mu_s * N = 0.4 * (2 * 9.8) = 7.84 N.'
    },
    gu: {
      questionTextPrefix: '2 kg દ્રવ્યમાનનો એક બ્લોક 0.4 ના સ્થૈતિક ઘર્ષણાંક ધરાવતી ખરબચડી ક્ષિતિજ સપાટી પર મૂકેલો છે. બ્લોકને ખસેડવા માટે કેટલા ન્યૂનતમ બળની જરૂર પડશે? (g = 9.8 m/s² લો)',
      options: { a: '7.84 N', b: '9.8 N', c: '19.6 N', d: '3.92 N' },
      explanation: 'સીમાંત ઘર્ષણ બળ f_max = mu_s * N = 0.4 * (2 * 9.8) = 7.84 N.'
    }
  },
  // Q6 - Q10 (Physics Electrostatics Numerical)
  {
    ids: [
      '3a8ca89e-cfd2-4083-aae8-d92d98647133',
      'a26f2756-03a5-413f-8be6-3d041fea20e9',
      'a7a3528a-eaff-48fc-ba82-666e38599c2b',
      '51b278a2-5f30-472a-b6a5-cedf6efdda0e',
      'dd86a981-4ea2-4058-a081-6c9ad5b237c8'
    ],
    hi: {
      questionTextPrefix: '+2 माइक्रोकुलम्ब और +8 माइक्रोकुलम्ब के दो बिंदु आवेश 6 सेमी की दूरी पर स्थित हैं। +2 माइक्रोकुलम्ब के आवेश से वह दूरी (सेमी में) ज्ञात कीजिए जहाँ विद्युत क्षेत्र शून्य हो जाता है।',
      options: {},
      explanation: 'दूरी x = d / (sqrt(q2/q1) + 1) = 6 / (sqrt(8/2) + 1) = 6 / (2 + 1) = 2.0 सेमी.'
    },
    gu: {
      questionTextPrefix: '+2 માઇક્રોકૂલોમ અને +8 માઇક્રોકૂલોમના બે બિંદુવત વિદ્યુતભારો એકબીજાથી 6 સેમી ના અંતરે રહેલા છે. +2 માઇક્રોકૂલોમ વિદ્યુતભારથી તે અંતર (સેમી માં) શોધો જ્યાં વિદ્યુતક્ષેત્ર શૂન્ય થાય છે.',
      options: {},
      explanation: 'અંતર x = d / (sqrt(q2/q1) + 1) = 6 / (sqrt(8/2) + 1) = 6 / (2 + 1) = 2.0 સેમી.'
    }
  },
  // Q11 - Q15 (Mathematics Limits)
  {
    ids: [
      'b5177e9e-8f85-4269-b551-df35938f4795',
      '071dfc76-52ef-47fe-a390-bf100146c4e3',
      'dd15b15d-8b2e-404a-9a75-1aec0d8355e1',
      '74bae15c-f956-411e-b7d7-35ed353ec730',
      'a705cc96-74b0-424c-9b33-a21219e6b3ef'
    ],
    hi: {
      questionTextPrefix: 'lim (x -> 0) [sin(5x) / tan(2x)] का मान किसके बराबर है:',
      options: { a: '5/2', b: '2/5', c: '1', d: '0' },
      explanation: 'lim (sin 5x / 5x) * 5 / ((tan 2x / 2x) * 2) = 1 * 5 / (1 * 2) = 5/2.'
    },
    gu: {
      questionTextPrefix: 'lim (x -> 0) [sin(5x) / tan(2x)] નું મૂલ્ય કોના બરાબર થાય:',
      options: { a: '5/2', b: '2/5', c: '1', d: '0' },
      explanation: 'lim (sin 5x / 5x) * 5 / ((tan 2x / 2x) * 2) = 1 * 5 / (1 * 2) = 5/2.'
    }
  }
];

function escapeCsvField(val) {
  if (val === undefined || val === null) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

async function main() {
  const headers = [
    'question_id',
    'language_code',
    'question_text',
    'passage_text',
    'assertion_text',
    'reason_text',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'option_e',
    'option_f',
    'explanation'
  ];

  const hindiRows = [headers.join(',')];
  const gujaratiRows = [headers.join(',')];

  for (const group of questionsData) {
    group.ids.forEach((qId, vIdx) => {
      const vTag = vIdx > 0 ? `[Variant ${vIdx + 1}] ` : '';

      // Hindi
      const hiText = vTag + group.hi.questionTextPrefix;
      const hiRow = [
        escapeCsvField(qId),
        escapeCsvField('hi'),
        escapeCsvField(hiText),
        escapeCsvField(''),
        escapeCsvField(''),
        escapeCsvField(''),
        escapeCsvField(group.hi.options.a || ''),
        escapeCsvField(group.hi.options.b || ''),
        escapeCsvField(group.hi.options.c || ''),
        escapeCsvField(group.hi.options.d || ''),
        escapeCsvField(''),
        escapeCsvField(''),
        escapeCsvField(group.hi.explanation)
      ].join(',');
      hindiRows.push(hiRow);

      // Gujarati
      const guText = vTag + group.gu.questionTextPrefix;
      const guRow = [
        escapeCsvField(qId),
        escapeCsvField('gu'),
        escapeCsvField(guText),
        escapeCsvField(''),
        escapeCsvField(''),
        escapeCsvField(''),
        escapeCsvField(group.gu.options.a || ''),
        escapeCsvField(group.gu.options.b || ''),
        escapeCsvField(group.gu.options.c || ''),
        escapeCsvField(group.gu.options.d || ''),
        escapeCsvField(''),
        escapeCsvField(''),
        escapeCsvField(group.gu.explanation)
      ].join(',');
      gujaratiRows.push(guRow);
    });
  }

  const hindiCsvContent = hindiRows.join('\n');
  const gujaratiCsvContent = gujaratiRows.join('\n');

  // Paths
  const targetDir = 'd:/exam mangment/';
  const artifactDir = 'C:/Users/niles/.gemini/antigravity-ide/brain/945fae79-0339-42fe-91c6-83958a10611f/';

  const hindiFileName = 'brainros_jee_main_test_01_hindi_translations.csv';
  const gujaratiFileName = 'brainros_jee_main_test_01_gujarati_translations.csv';

  fs.writeFileSync(path.join(targetDir, hindiFileName), '\ufeff' + hindiCsvContent, 'utf-8');
  fs.writeFileSync(path.join(targetDir, gujaratiFileName), '\ufeff' + gujaratiCsvContent, 'utf-8');

  fs.writeFileSync(path.join(artifactDir, hindiFileName), '\ufeff' + hindiCsvContent, 'utf-8');
  fs.writeFileSync(path.join(artifactDir, gujaratiFileName), '\ufeff' + gujaratiCsvContent, 'utf-8');

  console.log('Saved CSV files to project workspace & artifact directory.');

  // Now upsert database translations so status is 100% complete
  let qTransCount = 0;
  let optTransCount = 0;

  for (const group of questionsData) {
    for (let vIdx = 0; vIdx < group.ids.length; vIdx++) {
      const qId = group.ids[vIdx];
      const vTag = vIdx > 0 ? `[Variant ${vIdx + 1}] ` : '';

      // Fetch options for this question
      const options = await prisma.questionOption.findMany({
        where: { questionId: qId }
      });

      // Upsert Hindi
      await prisma.questionTranslation.upsert({
        where: { questionId_languageId: { questionId: qId, languageId: hindiLangId } },
        create: {
          questionId: qId,
          languageId: hindiLangId,
          questionText: vTag + group.hi.questionTextPrefix,
          explanation: group.hi.explanation
        },
        update: {
          questionText: vTag + group.hi.questionTextPrefix,
          explanation: group.hi.explanation
        }
      });
      qTransCount++;

      for (const opt of options) {
        const k = opt.optionKey.toLowerCase();
        if (group.hi.options[k]) {
          await prisma.questionOptionTranslation.upsert({
            where: { optionId_languageId: { optionId: opt.id, languageId: hindiLangId } },
            create: { optionId: opt.id, languageId: hindiLangId, optionText: group.hi.options[k] },
            update: { optionText: group.hi.options[k] }
          });
          optTransCount++;
        }
      }

      // Upsert Gujarati
      await prisma.questionTranslation.upsert({
        where: { questionId_languageId: { questionId: qId, languageId: gujaratiLangId } },
        create: {
          questionId: qId,
          languageId: gujaratiLangId,
          questionText: vTag + group.gu.questionTextPrefix,
          explanation: group.gu.explanation
        },
        update: {
          questionText: vTag + group.gu.questionTextPrefix,
          explanation: group.gu.explanation
        }
      });
      qTransCount++;

      for (const opt of options) {
        const k = opt.optionKey.toLowerCase();
        if (group.gu.options[k]) {
          await prisma.questionOptionTranslation.upsert({
            where: { optionId_languageId: { optionId: opt.id, languageId: gujaratiLangId } },
            create: { optionId: opt.id, languageId: gujaratiLangId, optionText: group.gu.options[k] },
            update: { optionText: group.gu.options[k] }
          });
          optTransCount++;
        }
      }

      // Ensure examLanguage records exist
      for (const lId of [hindiLangId, gujaratiLangId]) {
        const el = await prisma.examLanguage.findUnique({
          where: { examId_languageId: { examId, languageId: lId } }
        });
        if (!el) {
          await prisma.examLanguage.create({
            data: { examId, languageId: lId, isDefault: false, displayOrder: 2 }
          });
        }
      }
    }
  }

  console.log(`Database updated! Upserted ${qTransCount} question translations and ${optTransCount} option translations.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
