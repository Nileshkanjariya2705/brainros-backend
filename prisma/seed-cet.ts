import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const targets = await prisma.examTarget.findMany();
  console.log('Existing targets:', targets.map((t: any) => t.name).join(', '));

  const cet = await prisma.examTarget.findUnique({ where: { name: 'CET' } });
  if (!cet) {
    const created = await prisma.examTarget.create({
      data: { name: 'CET', description: 'State Common Entrance Test (MHT-CET, GUJCET, KCET, KEAM, etc.)' },
    });
    console.log('Created CET exam target:', created.id);
  } else {
    console.log('CET already exists:', cet.id);
  }

  const classes = await prisma.studentClass.findMany();
  console.log('Existing classes:', classes.map((c: any) => c.name).join(', '));

  for (const cls of [
    { name: 'CLASS_11', description: '11th Standard / 1st PUC' },
    { name: 'CLASS_12', description: '12th Standard / 2nd PUC' },
    { name: 'DROPPER', description: 'Repeater / Long Term Batch' },
    { name: 'FOUNDATION', description: '9th & 10th Foundation' },
  ]) {
    const existing = await prisma.studentClass.findUnique({ where: { name: cls.name } });
    if (!existing) {
      await prisma.studentClass.create({ data: cls });
      console.log(`Created class: ${cls.name}`);
    } else {
      console.log(`${cls.name} already exists`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
