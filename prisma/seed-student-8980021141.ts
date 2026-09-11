import { PrismaClient, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phone = '+918980021141';
  const rawMobile = '8980021141';

  console.log(`Configuring mobile ${phone} as STUDENT role with Target Exam NEET...`);

  // 1. Ensure STUDENT role exists
  const studentRole = await prisma.role.upsert({
    where: { name: 'STUDENT' },
    update: {},
    create: { name: 'STUDENT', description: 'Enrolled Examination Candidate' },
  });

  // 2. Find or create user
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
        email: 'student.8980021141@brainros.test',
        passwordHash: '',
        status: UserStatus.ACTIVE,
        isActive: true,
        isVerified: true,
        emailVerifiedAt: new Date(),
        mobileVerifiedAt: new Date(),
      },
    });
    console.log(`Created user ID: ${user.id}`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        phone,
        mobileNumber: phone,
        status: UserStatus.ACTIVE,
        isActive: true,
        isVerified: true,
        mobileVerifiedAt: user.mobileVerifiedAt || new Date(),
      },
    });
    console.log(`Updated user ID: ${user.id}`);
  }

  // 3. Clear existing user roles and assign ONLY STUDENT role
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

  // 4. Resolve Master Data: Target Exam NEET, Class, Language, State, District
  const neetTarget = await prisma.examTarget.findFirst({
    where: { name: 'NEET' },
  });
  if (!neetTarget) {
    throw new Error('ExamTarget NEET not found in database.');
  }

  const defaultClass =
    (await prisma.studentClass.findFirst({ where: { name: 'CLASS_12' } })) ||
    (await prisma.studentClass.findFirst());
  if (!defaultClass) {
    throw new Error('StudentClass not found in database.');
  }

  const defaultLanguage =
    (await prisma.preferredLanguage.findFirst({ where: { name: 'ENGLISH' } })) ||
    (await prisma.preferredLanguage.findFirst());
  if (!defaultLanguage) {
    throw new Error('PreferredLanguage not found in database.');
  }

  const gujaratState = await prisma.state.findFirst({
    where: { name: { contains: 'Gujarat', mode: 'insensitive' } },
    include: { districts: true },
  });

  const ahmedabadDistrict = gujaratState?.districts.find((d) =>
    d.name.toLowerCase().includes('ahmedabad'),
  );

  // 5. Ensure Student record exists, is ACTIVE, and is linked to NEET
  const existingStudent = await prisma.student.findUnique({
    where: { userId: user.id },
  });

  let studentId: string;
  let studentCode: string;

  if (existingStudent) {
    studentId = existingStudent.id;
    studentCode = existingStudent.studentCode || existingStudent.studentId;

    await prisma.student.update({
      where: { id: existingStudent.id },
      data: {
        name: existingStudent.name || 'Student 8980021141',
        status: 'ACTIVE',
        classId: defaultClass.id,
        examTargetId: neetTarget.id,
        preferredLanguageId: defaultLanguage.id,
        state: gujaratState?.name || 'Gujarat',
        stateId: gujaratState?.id,
        district: ahmedabadDistrict?.name || 'Ahmedabad',
        districtId: ahmedabadDistrict?.id,
        schoolCollege: existingStudent.schoolCollege || 'Brainros Academy',
      },
    });
    console.log(`Updated Student Profile: ${studentCode}`);
  } else {
    const year = new Date().getFullYear();
    let sequenceNum = (await prisma.student.count()) + 1;
    let studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
    let codeStr = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;

    // Ensure collision avoidance
    let collision = await prisma.student.findFirst({
      where: { OR: [{ studentCode: codeStr }, { studentId: studentIdStr }] },
    });
    while (collision) {
      sequenceNum++;
      studentIdStr = `STU${String(sequenceNum + 1000).padStart(6, '0')}`;
      codeStr = `BRN-${year}-${String(sequenceNum).padStart(6, '0')}`;
      collision = await prisma.student.findFirst({
        where: { OR: [{ studentCode: codeStr }, { studentId: studentIdStr }] },
      });
    }

    const newStudent = await prisma.student.create({
      data: {
        userId: user.id,
        studentId: studentIdStr,
        studentCode: codeStr,
        name: 'Student 8980021141',
        state: gujaratState?.name || 'Gujarat',
        stateId: gujaratState?.id,
        district: ahmedabadDistrict?.name || 'Ahmedabad',
        districtId: ahmedabadDistrict?.id,
        schoolCollege: 'Brainros Academy',
        classId: defaultClass.id,
        examTargetId: neetTarget.id,
        preferredLanguageId: defaultLanguage.id,
        status: 'ACTIVE',
      },
    });
    studentId = newStudent.id;
    studentCode = newStudent.studentCode || newStudent.studentId;
    console.log(`Created Student Profile: ${studentCode} (${studentIdStr})`);
  }

  // 6. Ensure StudentExamTarget links to NEET as Primary
  await prisma.studentExamTarget.upsert({
    where: {
      studentId_examTargetId: {
        studentId,
        examTargetId: neetTarget.id,
      },
    },
    update: {
      isPrimary: true,
    },
    create: {
      studentId,
      examTargetId: neetTarget.id,
      isPrimary: true,
    },
  });

  // 7. Verify full record configuration
  const verifyUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      userRoles: { include: { role: true } },
      student: {
        include: {
          examTarget: true,
          studentClass: true,
          preferredLanguage: true,
          studentExamTargets: { include: { examTarget: true } },
        },
      },
    },
  });

  console.log(`\n==============================================`);
  console.log(`✅ Successfully seeded student 8980021141:`);
  console.log(`- User ID: ${verifyUser?.id}`);
  console.log(`- Mobile / Phone: ${verifyUser?.mobileNumber || verifyUser?.phone}`);
  console.log(`- Email: ${verifyUser?.email}`);
  console.log(`- Role: ${verifyUser?.userRoles.map((ur) => ur.role.name).join(', ')}`);
  console.log(`- Student Name: ${verifyUser?.student?.name}`);
  console.log(`- Student ID: ${verifyUser?.student?.studentId}`);
  console.log(`- Student Code: ${verifyUser?.student?.studentCode}`);
  console.log(`- Target Exam: ${verifyUser?.student?.examTarget.name} (${verifyUser?.student?.examTarget.description})`);
  console.log(`- Primary Target: ${verifyUser?.student?.studentExamTargets.map(t => `${t.examTarget.name} (isPrimary: ${t.isPrimary})`).join(', ')}`);
  console.log(`- Class: ${verifyUser?.student?.studentClass.name}`);
  console.log(`- Language: ${verifyUser?.student?.preferredLanguage.name}`);
  console.log(`- State / District: ${verifyUser?.student?.state} / ${verifyUser?.student?.district}`);
  console.log(`- Status: ${verifyUser?.student?.status}`);
  console.log(`==============================================\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
