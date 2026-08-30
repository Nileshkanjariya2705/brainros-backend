import { PrismaClient, UserStatus, StudentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Ensuring all role test accounts exist with OTP: 12345...');
  const passwordHash = await bcrypt.hash('Password@123', 10);

  // 1. Roles mapping
  const allRoles = await prisma.role.findMany();
  const roleMap = new Map(allRoles.map((r) => [r.name, r.id]));

  const testAccounts = [
    {
      phone: '+919000000000',
      email: 'superadmin@brainros.test',
      roles: ['SUPER_ADMIN'],
      name: 'Super Administrator',
    },
    {
      phone: '+919000000091',
      email: 'admin.neet@brainros.test',
      roles: ['ADMIN'],
      name: 'NEET Academic Admin',
    },
    {
      phone: '+918320982232',
      email: 'student.dev@brainros.test',
      roles: ['STUDENT'],
      name: 'Aarav Student (Dev)',
    },
    {
      phone: '+919000000001',
      email: 'student001@brainros.test',
      roles: ['STUDENT'],
      name: 'Aarav Sharma',
    },
    {
      phone: '+919000000601',
      email: 'parent01@brainros.test',
      roles: ['PARENT'],
      name: 'Parent User 01',
    },
    {
      phone: '+919000000081',
      email: 'inst.allen@brainros.test',
      roles: ['INSTITUTION_ADMIN'],
      name: 'Allen Institution Admin',
    },
    {
      phone: '+919000000071',
      email: 'sales01@brainros.test',
      roles: ['SALES_AGENT'],
      name: 'Sales Agent 01',
    },
  ];

  for (const acc of testAccounts) {
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: acc.phone },
          { mobileNumber: acc.phone },
          { email: acc.email },
        ],
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: acc.email,
          phone: acc.phone,
          mobileNumber: acc.phone,
          passwordHash,
          status: UserStatus.ACTIVE,
          isActive: true,
          isVerified: true,
          emailVerifiedAt: new Date(),
          mobileVerifiedAt: new Date(),
        },
      });
      console.log(`Created user: ${acc.email} (${acc.phone})`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          phone: acc.phone,
          mobileNumber: acc.phone,
          isActive: true,
          status: UserStatus.ACTIVE,
          isVerified: true,
        },
      });
      console.log(`Updated user: ${acc.email} (${acc.phone})`);
    }

    // Assign roles
    for (const rName of acc.roles) {
      const roleId = roleMap.get(rName);
      if (roleId) {
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId } },
          update: {},
          create: { userId: user.id, roleId },
        });
      }
    }

    // If student, ensure student profile
    if (acc.roles.includes('STUDENT')) {
      const existingStudent = await prisma.student.findUnique({
        where: { userId: user.id },
      });
      if (!existingStudent) {
        const defaultClass = await prisma.studentClass.findFirst();
        const defaultTarget = await prisma.examTarget.findFirst();
        const defaultLang = await prisma.preferredLanguage.findFirst();

        await prisma.student.create({
          data: {
            userId: user.id,
            studentId: `STU${Math.floor(1000 + Math.random() * 9000)}`,
            studentCode: `BRN-2026-${Math.floor(100000 + Math.random() * 900000)}`,
            name: acc.name,
            state: 'Karnataka',
            district: 'Bengaluru Urban',
            schoolCollege: 'Delhi Public School',
            classId: defaultClass?.id || '',
            examTargetId: defaultTarget?.id || '',
            preferredLanguageId: defaultLang?.id || '',
            status: StudentStatus.ACTIVE,
          },
        });
        console.log(`Created student profile for: ${acc.name}`);
      }
    }
  }

  console.log('\n======================================================');
  console.log('TEST ACCOUNTS SUMMARY (ALL OTP: 12345):');
  console.log('======================================================');
  console.log('1. SUPER_ADMIN       : +919000000000 or 9000000000');
  console.log('2. ADMIN             : +919000000091 or 9000000091');
  console.log('3. STUDENT (Dev)     : +918320982232 or 8320982232');
  console.log('4. STUDENT (Aarav)   : +919000000001 or 9000000001');
  console.log('5. PARENT            : +919000000601 or 9000000601');
  console.log('6. INSTITUTION_ADMIN : +919000000081 or 9000000081');
  console.log('7. SALES_AGENT       : +919000000071 or 9000000071');
  console.log('======================================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
