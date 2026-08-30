import { PrismaClient } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function generateSampleFiles() {
  const subjects = await prisma.subject.findMany({
    include: { chapters: { include: { topics: true } } },
  });

  const physicsSub =
    subjects.find((s) => s.name.includes('Physics')) || subjects[0];
  const physicsCh =
    physicsSub.chapters.find((c) => c.name.includes('Electrostatics') || c.name.includes('Motion')) ||
    physicsSub.chapters[0];
  const physicsTopic = physicsCh?.topics[0]?.name || '';

  const chemistrySub =
    subjects.find((s) => s.name.includes('Chemistry')) || subjects[1] || subjects[0];
  const chemistryCh = chemistrySub.chapters[0];

  const mathSub =
    subjects.find((s) => s.name.includes('Math')) || subjects[2] || subjects[0];
  const mathCh = mathSub.chapters[0];

  const biologySub =
    subjects.find((s) => s.name.includes('Botany') || s.name.includes('Zoology') || s.name.includes('Biology (NEET)')) ||
    subjects.find((s) => s.chapters.length > 0) ||
    subjects[0];
  const biologyCh = biologySub.chapters[0] || physicsCh;

  console.log(`Physics Subject: "${physicsSub.name}", Chapter: "${physicsCh?.name}"`);
  console.log(`Chemistry Subject: "${chemistrySub.name}", Chapter: "${chemistryCh?.name}"`);
  console.log(`Math Subject: "${mathSub.name}", Chapter: "${mathCh?.name}"`);
  console.log(`Biology Subject: "${biologySub.name}", Chapter: "${biologyCh?.name}"`);

  // 1. Headers
  const csvHeaders = [
    'question_id',
    'subject',
    'chapter',
    'topic',
    'question_type',
    'difficulty',
    'marks',
    'negative_marks',
    'question_text',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'correct_answer',
    'numerical_answer',
    'numerical_tolerance',
    'assertion',
    'reason',
    'passage',
    'explanation',
  ];

  // 2. Data Rows
  const rowsData = [
    {
      question_id: '',
      subject: physicsSub.name,
      chapter: physicsCh.name,
      topic: physicsTopic,
      question_type: 'SINGLE_CORRECT',
      difficulty: 'MEDIUM',
      marks: 4,
      negative_marks: 1,
      question_text: 'What is the SI unit of electric flux through a Gaussian surface in electrostatics?',
      option_a: 'Volt-meter (V m)',
      option_b: 'Newton / Coulomb (N/C)',
      option_c: 'Joule / meter (J/m)',
      option_d: 'Farad / meter (F/m)',
      correct_answer: 'A',
      numerical_answer: '',
      numerical_tolerance: '',
      assertion: '',
      reason: '',
      passage: '',
      explanation: 'Electric flux is phi = E . A = (V/m) * m^2 = V m.',
    },
    {
      question_id: '',
      subject: chemistrySub.name,
      chapter: chemistryCh.name,
      topic: '',
      question_type: 'MULTIPLE_CORRECT',
      difficulty: 'HARD',
      marks: 4,
      negative_marks: 1,
      question_text: 'Which of the following chemical species possess a tetrahedral geometry with sp3 hybridization?',
      option_a: 'Methane (CH4)',
      option_b: 'Ammonium cation (NH4+)',
      option_c: 'Carbon tetrachloride (CCl4)',
      option_d: 'Sulfur hexafluoride (SF6)',
      correct_answer: 'A,B,C',
      numerical_answer: '',
      numerical_tolerance: '',
      assertion: '',
      reason: '',
      passage: '',
      explanation: 'CH4, NH4+, and CCl4 all exhibit sp3 hybridization with 4 bonding pairs and tetrahedral geometry.',
    },
    {
      question_id: '',
      subject: mathSub.name,
      chapter: mathCh.name,
      topic: '',
      question_type: 'NUMERICAL',
      difficulty: 'EASY',
      marks: 4,
      negative_marks: 0,
      question_text: 'Evaluate the trigonometric limit as x approaches 0 for f(x) = sin(7x) / x.',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_answer: '',
      numerical_answer: '7',
      numerical_tolerance: '0',
      assertion: '',
      reason: '',
      passage: '',
      explanation: 'lim (x->0) [sin(7x)/x] = 7 * lim (x->0) [sin(7x)/(7x)] = 7 * 1 = 7.',
    },
    {
      question_id: '',
      subject: biologySub.name,
      chapter: biologyCh.name,
      topic: '',
      question_type: 'ASSERTION_REASON',
      difficulty: 'MEDIUM',
      marks: 4,
      negative_marks: 1,
      question_text: 'Select the correct relationship between Assertion (A) and Reason (R) statements below.',
      option_a: 'Both (A) and (R) are true and (R) is the correct explanation of (A)',
      option_b: 'Both (A) and (R) are true but (R) is NOT the correct explanation of (A)',
      option_c: '(A) is true but (R) is false',
      option_d: '(A) is false but (R) is true',
      correct_answer: 'A',
      numerical_answer: '',
      numerical_tolerance: '',
      assertion: 'Mitochondria and chloroplasts are semi-autonomous cell organelles.',
      reason: 'They possess their own circular double-stranded DNA genome and 70S ribosomes.',
      passage: '',
      explanation: 'Mitochondria and chloroplasts contain circular DNA molecules and synthesize some of their own structural proteins.',
    },
    {
      question_id: '',
      subject: physicsSub.name,
      chapter: physicsCh.name,
      topic: '',
      question_type: 'CASE_BASED',
      difficulty: 'HARD',
      marks: 4,
      negative_marks: 1,
      question_text: 'Based on the experimental case study described above, what happens to the electrostatic potential inside a solid spherical charged conductor?',
      option_a: 'Remains constant and equals potential at the surface',
      option_b: 'Decreases linearly to zero at the center',
      option_c: 'Increases quadratically towards the center',
      option_d: 'Varies inversely with distance from center',
      correct_answer: 'A',
      numerical_answer: '',
      numerical_tolerance: '',
      assertion: '',
      reason: '',
      passage: 'Consider an isolated spherical metal conductor in electrostatic equilibrium carrying net charge Q. In electrostatic conditions, excess charge resides entirely on the outer surface and electric field E = 0 everywhere within the conductor volume.',
      explanation: 'Since E = -dV/dr and E = 0 inside the conductor, the electric potential V is uniform and equal to surface potential V = kQ/R.',
    },
  ];

  // Write CSV
  const csvContent =
    csvHeaders.join(',') +
    '\n' +
    rowsData
      .map((row) =>
        csvHeaders
          .map((h) => {
            const val = String((row as any)[h] ?? '');
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
              return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          })
          .join(','),
      )
      .join('\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const csvPathRoot = path.join(rootDir, 'sample_questions_import.csv');
  const csvPathBackend = path.resolve(__dirname, '..', 'sample_questions_import.csv');
  fs.writeFileSync(csvPathRoot, csvContent, 'utf-8');
  fs.writeFileSync(csvPathBackend, csvContent, 'utf-8');

  // Write XLSX with ExcelJS
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sample Questions');

  sheet.columns = csvHeaders.map((header) => ({
    header,
    key: header,
    width:
      header === 'question_text' || header === 'passage' || header === 'explanation'
        ? 48
        : header === 'assertion' || header === 'reason'
          ? 36
          : header.startsWith('option_')
            ? 28
            : 20,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' }, // Indigo-600
  };
  headerRow.height = 28;
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  rowsData.forEach((row) => {
    sheet.addRow(row);
  });

  const xlsxPathRoot = path.join(rootDir, 'sample_questions_import.xlsx');
  const xlsxPathBackend = path.resolve(__dirname, '..', 'sample_questions_import.xlsx');
  await workbook.xlsx.writeFile(xlsxPathRoot);
  await workbook.xlsx.writeFile(xlsxPathBackend);

  console.log(`✓ Successfully updated sample CSV: ${csvPathRoot}`);
  console.log(`✓ Successfully updated sample Excel: ${xlsxPathRoot}`);

  await prisma.$disconnect();
}

generateSampleFiles().catch((e) => {
  console.error(e);
  process.exit(1);
});
