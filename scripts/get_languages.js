const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const languages = await prisma.preferredLanguage.findMany();
  console.log('Available Languages in DB:', JSON.stringify(languages, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
