import { PrismaClient, BillStatus } from '@prisma/client';

const prisma = new PrismaClient();

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface InvoicedSchool {
  id: string;
  name: string;
  code: string;
  email: string | null;
  defaultStudents: number;
}

async function main() {
  console.log('--- SEEDING INVOICE DUMMY DATA ---');

  // 1. Find admin user
  const admin =
    (await prisma.user.findFirst({ where: { email: 'superadmin@brainros.test' } })) ||
    (await prisma.user.findFirst());

  if (!admin) {
    console.error('No user found to associate with bills. Please run main seed first.');
    return;
  }

  console.log(`Using admin user: ${admin.email || admin.mobileNumber} (${admin.id})`);

  // 2. Ensure system pricing setting exists
  await prisma.systemSetting.upsert({
    where: { key: 'PRICE_PER_STUDENT_PER_MONTH' },
    update: {},
    create: {
      key: 'PRICE_PER_STUDENT_PER_MONTH',
      value: '300',
      description: 'Default subscription billing rate per student per month',
      updatedById: admin.id,
    },
  });
  console.log('Ensured system pricing setting: ₹300/student/month');

  // 3. Fetch existing institutions
  const existingSchools = await prisma.institution.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, code: true, email: true },
    orderBy: { name: 'asc' },
  });

  const schoolsList: InvoicedSchool[] = [];

  const studentCounts = [520, 340, 480, 610, 290, 420, 180, 250];

  for (let i = 0; i < existingSchools.length; i++) {
    const s = existingSchools[i];
    // Ensure email exists
    if (!s.email) {
      const email = `billing@${s.code.toLowerCase().replace(/[^a-z0-9]/g, '')}.edu.in`;
      await prisma.institution.update({
        where: { id: s.id },
        data: { email },
      });
      s.email = email;
    }
    schoolsList.push({
      id: s.id,
      name: s.name,
      code: s.code,
      email: s.email,
      defaultStudents: studentCounts[i % studentCounts.length],
    });
  }

  // If fewer than 5 institutions, create a few
  if (schoolsList.length < 5) {
    const samples = [
      { name: 'KVT Secondary School Nashik', code: 'KVTS01', email: 'info@kvtnashik.org', students: 240 },
      { name: 'Delhi Public School Pune', code: 'DPSP02', email: 'accounts@dpspune.edu.in', students: 520 },
      { name: 'St. Xavier High School Mumbai', code: 'SXHM03', email: 'billing@stxaviermumbai.org', students: 410 },
      { name: 'Ryan International Academy Bangalore', code: 'RIAB04', email: 'finance@ryanbangalore.edu', students: 680 },
      { name: 'Greenwood High International Hyderabad', code: 'GHIH05', email: 'contact@greenwoodhyd.org', students: 310 },
    ];

    for (const sample of samples) {
      let inst = await prisma.institution.findFirst({
        where: { OR: [{ code: sample.code }, { name: sample.name }] },
      });

      if (!inst) {
        inst = await prisma.institution.create({
          data: {
            name: sample.name,
            code: sample.code,
            email: sample.email,
            status: 'ACTIVE',
            createdById: admin.id,
          },
        });
      }

      if (!schoolsList.some((s) => s.id === inst!.id)) {
        schoolsList.push({
          id: inst.id,
          name: inst.name,
          code: inst.code,
          email: inst.email || sample.email,
          defaultStudents: sample.students,
        });
      }
    }
  }

  console.log(`Total institutions configured for invoicing: ${schoolsList.length}`);
  for (const s of schoolsList) {
    console.log(`  - ${s.name} (${s.code}) | Email: ${s.email} | Default Students: ${s.defaultStudents}`);
  }

  // 4. Time reference
  const now = new Date();
  const currentYear = now.getFullYear(); // 2026
  const currentMonth = now.getMonth() + 1; // 9

  const lastMonthDate = new Date(currentYear, currentMonth - 2, 1);
  const lastMonth = lastMonthDate.getMonth() + 1; // 8 (August)
  const lastMonthYear = lastMonthDate.getFullYear(); // 2026

  console.log(`\nCurrent Period: ${MONTH_NAMES[currentMonth]} ${currentYear}`);
  console.log(`Last Month Period: ${MONTH_NAMES[lastMonth]} ${lastMonthYear}`);

  // 5. Seed billing periods
  interface PeriodConfig {
    month: number;
    year: number;
    price: number;
    statuses: BillStatus[];
  }

  const periods: PeriodConfig[] = [
    // A) Last Month (August 2026) - ALL schools
    {
      month: lastMonth,
      year: lastMonthYear,
      price: 300,
      statuses: [
        BillStatus.PAID,
        BillStatus.SENT,
        BillStatus.GENERATED,
        BillStatus.OVERDUE,
        BillStatus.PAID,
        BillStatus.SENT,
      ],
    },
    // B) Two Months Ago (July 2026) - ALL schools
    {
      month: 7,
      year: 2026,
      price: 300,
      statuses: [BillStatus.PAID],
    },
    // C) Three Months Ago (June 2026) - ALL schools
    {
      month: 6,
      year: 2026,
      price: 300,
      statuses: [BillStatus.PAID],
    },
    // D) Current Month (September 2026) - Selected schools
    {
      month: currentMonth,
      year: currentYear,
      price: 300,
      statuses: [BillStatus.GENERATED, BillStatus.GENERATED, BillStatus.DRAFT],
    },
    // E) Historical Year 2025 (December 2025)
    {
      month: 12,
      year: 2025,
      price: 280,
      statuses: [BillStatus.PAID],
    },
    // F) Historical Year 2025 (November 2025)
    {
      month: 11,
      year: 2025,
      price: 280,
      statuses: [BillStatus.PAID],
    },
  ];

  let totalCreated = 0;
  let totalUpdated = 0;
  let seq = 100;

  for (const p of periods) {
    const targetSchools =
      p.month === currentMonth && p.year === currentYear
        ? schoolsList.slice(0, 3)
        : schoolsList;

    for (let i = 0; i < targetSchools.length; i++) {
      const inst = targetSchools[i];
      const status = p.statuses[i % p.statuses.length];

      // Student count varies slightly by month and school
      const studentCount = inst.defaultStudents + (i * 20) - (p.month * 5);
      const totalAmount = studentCount * p.price;
      const periodLabel = `${MONTH_NAMES[p.month]} ${p.year}`;

      seq++;
      const billNumber = `INV-${p.year}${String(p.month).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;

      const emailStatus =
        status === BillStatus.PAID || status === BillStatus.SENT || status === BillStatus.OVERDUE
          ? 'SENT'
          : 'IDLE';

      const existing = await prisma.bill.findUnique({
        where: {
          institutionId_billingYear_billingMonth: {
            institutionId: inst.id,
            billingYear: p.year,
            billingMonth: p.month,
          },
        },
      });

      if (existing) {
        await prisma.bill.update({
          where: { id: existing.id },
          data: {
            studentCount,
            pricePerStudent: p.price,
            amount: totalAmount,
            totalAmount,
            status,
            emailStatus,
            description: `Student Platform Subscription (${periodLabel})`,
          },
        });
        totalUpdated++;
      } else {
        await prisma.bill.create({
          data: {
            billNumber,
            institutionId: inst.id,
            createdById: admin.id,
            billDate: new Date(p.year, p.month - 1, 1),
            billingMonth: p.month,
            billingYear: p.year,
            studentCount,
            pricePerStudent: p.price,
            amount: totalAmount,
            tax: 0,
            totalAmount,
            status,
            emailStatus,
            description: `Student Platform Subscription (${periodLabel})`,
          },
        });
        totalCreated++;
      }
    }
  }

  console.log(`\nSeed completed!`);
  console.log(`Invoices created: ${totalCreated}`);
  console.log(`Invoices updated: ${totalUpdated}`);

  // Print summary of Last Month (August 2026) invoices
  const lastMonthInvoices = await prisma.bill.findMany({
    where: { billingMonth: lastMonth, billingYear: lastMonthYear },
    include: { institution: { select: { name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n=== LAST MONTH (${MONTH_NAMES[lastMonth]} ${lastMonthYear}) INVOICES OF ALL SCHOOLS ===`);
  for (const inv of lastMonthInvoices) {
    console.log(
      `  • ${inv.billNumber} | ${inv.institution.name.padEnd(42)} | ${String(inv.studentCount).padStart(4)} students | ₹${inv.pricePerStudent}/ea | Total: ₹${Number(inv.totalAmount).toLocaleString('en-IN').padStart(9)} | Status: ${inv.status.padEnd(9)} | Email: ${inv.emailStatus}`,
    );
  }

  console.log('--------------------------------------------------\n');
}

main()
  .catch((e) => {
    console.error('Error seeding invoice dummy data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
