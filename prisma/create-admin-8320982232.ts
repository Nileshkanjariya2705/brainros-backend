import { PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const phone = '+918320982232';
  const rawMobile = '8320982232';
  const email = 'admin8320982232@brainros.test';
  const passwordHash = await bcrypt.hash('Password@123', 10);

  console.log(`Provisioning Admin user for mobile: ${phone} (${rawMobile})...`);

  // 1. Ensure Roles exist
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: { name: 'SUPER_ADMIN', description: 'Platform Executive Super Administrator' },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Academic Administrator' },
  });

  // 2. Fetch master records for Student Profile
  const defaultClass = (await prisma.studentClass.findFirst()) || (await prisma.studentClass.create({
    data: { name: 'Class 12' },
  }));

  const defaultExamTarget = (await prisma.examTarget.findFirst()) || (await prisma.examTarget.create({
    data: { name: 'JEE Advanced' },
  }));

  const defaultLanguage = (await prisma.preferredLanguage.findFirst()) || (await prisma.preferredLanguage.create({
    data: { name: 'English', code: 'EN' },
  }));

  // 3. Find or Create User
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone },
        { mobileNumber: phone },
        { phone: rawMobile },
        { mobileNumber: rawMobile },
        { email },
      ],
    },
  });

  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        phone,
        mobileNumber: phone,
        email,
        passwordHash,
        status: UserStatus.ACTIVE,
        isActive: true,
        isVerified: true,
        emailVerifiedAt: new Date(),
        mobileVerifiedAt: new Date(),
      },
    });
    console.log(`Updated existing user ID: ${user.id}`);
  } else {
    user = await prisma.user.create({
      data: {
        phone,
        mobileNumber: phone,
        email,
        passwordHash,
        status: UserStatus.ACTIVE,
        isActive: true,
        isVerified: true,
        emailVerifiedAt: new Date(),
        mobileVerifiedAt: new Date(),
      },
    });
    console.log(`Created new user ID: ${user.id}`);
  }

  // 4. Assign SUPER_ADMIN and ADMIN roles
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: user.id, roleId: superAdminRole.id },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });

  // 5. Ensure Student Profile exists for student view / full navigation
  const existingStudent = await prisma.student.findUnique({
    where: { userId: user.id },
  });

  if (!existingStudent) {
    const studentCount = await prisma.student.count();
    const studentIdStr = `STU${String(studentCount + 1000).padStart(6, '0')}`;
    const studentCode = `BRN-2026-${String(studentCount + 1).padStart(6, '0')}`;

    await prisma.student.create({
      data: {
        userId: user.id,
        studentId: studentIdStr,
        studentCode,
        name: 'Admin 8320982232',
        state: 'Gujarat',
        district: 'Ahmedabad',
        schoolCollege: 'Brainros Admin Command',
        classId: defaultClass.id,
        examTargetId: defaultExamTarget.id,
        preferredLanguageId: defaultLanguage.id,
        status: 'ACTIVE',
      },
    });
    console.log(`Created student profile: ${studentCode} (${studentIdStr})`);
  }

  console.log(`\n✅ Successfully provisioned Admin user:`);
  console.log(`- Mobile: ${phone} / ${rawMobile}`);
  console.log(`- Email: ${email}`);
  console.log(`- Password: Password@123`);
  console.log(`- Roles: SUPER_ADMIN, ADMIN`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
