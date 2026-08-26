import { PrismaClient, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phone = '+918320982232';
  const rawMobile = '8320982232';

  console.log(`Configuring mobile ${phone} as STUDENT role...`);

  // 1. Ensure STUDENT role exists
  const studentRole = await prisma.role.upsert({
    where: { name: 'STUDENT' },
    update: {},
    create: { name: 'STUDENT', description: 'Enrolled Examination Candidate' },
  });

  // 2. Find user
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone },
        { mobileNumber: phone },
        { phone: rawMobile },
        { mobileNumber: rawMobile },
      ],
    },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        phone,
        mobileNumber: phone,
        email: 'student.8320982232@brainros.test',
        passwordHash: '',
        status: UserStatus.ACTIVE,
        isActive: true,
        isVerified: true,
        emailVerifiedAt: new Date(),
        mobileVerifiedAt: new Date(),
      },
    });
    console.log(`Created user ID: ${user.id}`);
  }

  // 3. Clear admin roles and assign ONLY STUDENT role
  await prisma.userRole.deleteMany({
    where: { userId: user.id },
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: studentRole.id,
    },
  });

  console.log(`Assigned role STUDENT to user ID: ${user.id}`);

  // 4. Ensure master records for Student Profile
  const defaultClass = (await prisma.studentClass.findFirst()) || (await prisma.studentClass.create({
    data: { name: 'Class 12' },
  }));

  const defaultExamTarget = (await prisma.examTarget.findFirst()) || (await prisma.examTarget.create({
    data: { name: 'NEET' },
  }));

  const defaultLanguage = (await prisma.preferredLanguage.findFirst()) || (await prisma.preferredLanguage.create({
    data: { name: 'English', code: 'EN' },
  }));

  // 5. Ensure Student record exists and is active
  const existingStudent = await prisma.student.findUnique({
    where: { userId: user.id },
  });

  if (existingStudent) {
    await prisma.student.update({
      where: { id: existingStudent.id },
      data: {
        name: 'Student 8320982232',
        status: 'ACTIVE',
        classId: defaultClass.id,
        examTargetId: defaultExamTarget.id,
        preferredLanguageId: defaultLanguage.id,
      },
    });
    console.log(`Updated Student Profile: ${existingStudent.studentCode} (${existingStudent.studentId})`);
  } else {
    const studentCount = await prisma.student.count();
    const studentIdStr = `STU${String(studentCount + 1000).padStart(6, '0')}`;
    const studentCode = `BRN-2026-${String(studentCount + 1).padStart(6, '0')}`;

    const newStudent = await prisma.student.create({
      data: {
        userId: user.id,
        studentId: studentIdStr,
        studentCode,
        name: 'Student 8320982232',
        state: 'Gujarat',
        district: 'Ahmedabad',
        schoolCollege: 'Brainros Test Academy',
        classId: defaultClass.id,
        examTargetId: defaultExamTarget.id,
        preferredLanguageId: defaultLanguage.id,
        status: 'ACTIVE',
      },
    });
    console.log(`Created Student Profile: ${newStudent.studentCode} (${newStudent.studentId})`);
  }

  // 6. Verify configuration
  const verifyUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      userRoles: { include: { role: true } },
      student: true,
    },
  });

  console.log(`\n✅ Successfully configured 8320982232 as STUDENT:`);
  console.log(`- Mobile: ${verifyUser?.mobileNumber || verifyUser?.phone}`);
  console.log(`- Roles: ${verifyUser?.userRoles.map((ur) => ur.role.name).join(', ')}`);
  console.log(`- Student Name: ${verifyUser?.student?.name}`);
  console.log(`- Student Code: ${verifyUser?.student?.studentCode}`);
  console.log(`- Student ID: ${verifyUser?.student?.studentId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
