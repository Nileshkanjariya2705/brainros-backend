import { SeedContext, SeederResult } from './types';
import * as bcrypt from 'bcrypt';
import {
  User,
  Student,
  UserStatus,
  StudentStatus,
  ParentRelationshipType,
  ParentLinkStatus,
} from '@prisma/client';

export async function seedUsersAndRoles(ctx: SeedContext): Promise<SeederResult> {
  const start = Date.now();
  const created: Record<string, number> = {};
  const reused: Record<string, number> = {};

  const inc = (type: string, isNew: boolean) => {
    if (isNew) created[type] = (created[type] || 0) + 1;
    else reused[type] = (reused[type] || 0) + 1;
  };

  const { prisma } = ctx;
  const passwordHash = await bcrypt.hash('Password@123', 10);

  // Helper to ensure user + role mapping
  const ensureUser = async (
    email: string,
    phone: string,
    roleNames: string[],
    status: UserStatus = UserStatus.ACTIVE,
  ) => {
    let user = await prisma.user.findUnique({ where: { email } });
    let isNew = false;
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          phone,
          mobileNumber: phone,
          passwordHash,
          status,
          isActive: true,
          isVerified: true,
          emailVerifiedAt: new Date(),
          mobileVerifiedAt: new Date(),
        },
      });
      isNew = true;
      inc('users', true);
    } else {
      inc('users', false);
    }
    ctx.users.set(email, user);

    // Assign roles
    for (const rName of roleNames) {
      const role = ctx.roles.get(rName);
      if (role) {
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: role.id } },
          update: {},
          create: { userId: user.id, roleId: role.id },
        });
      }
    }
    return user;
  };

  // 1. Super Admin
  await ensureUser('superadmin@brainros.test', '+919000000000', ['SUPER_ADMIN']);

  // 2. Academic Admins
  await ensureUser('admin.neet@brainros.test', '+919000000091', ['ADMIN']);
  await ensureUser('admin.jee@brainros.test', '+919000000092', ['ADMIN']);

  // 3. Institution Admin Users
  await ensureUser('inst.allen@brainros.test', '+919000000081', ['INSTITUTION_ADMIN']);
  await ensureUser('inst.aakash@brainros.test', '+919000000082', ['INSTITUTION_ADMIN']);
  await ensureUser('inst.resonance@brainros.test', '+919000000083', ['INSTITUTION_ADMIN']);
  await ensureUser('inst.fiitjee@brainros.test', '+919000000084', ['INSTITUTION_ADMIN']);

  // 4. Sales & Accountant
  await ensureUser('sales01@brainros.test', '+919000000071', ['SALES_AGENT']);
  await ensureUser('accounts01@brainros.test', '+919000000072', ['ACCOUNTANT']);

  // 5. Parent Users
  const parentUsers: User[] = [];
  for (let i = 1; i <= 10; i++) {
    const pNum = String(i).padStart(2, '0');
    const pUser = await ensureUser(
      `parent${pNum}@brainros.test`,
      `+9190000006${pNum}`,
      ['PARENT'],
    );
    parentUsers.push(pUser);
  }

  // 6. Student Users and Student Profiles
  const studentNames = [
    { name: 'Aarav Sharma', state: 'KA', dist: 'Bengaluru Urban', target: 'NEET', cls: 'CLASS_12', lang: 'en', school: 'Delhi Public School' },
    { name: 'Diya Patel', state: 'GJ', dist: 'Ahmedabad', target: 'NEET', cls: 'CLASS_12', lang: 'gu', school: 'St. Xavier High School' },
    { name: 'Rohan Gupta', state: 'MH', dist: 'Pune', target: 'JEE_MAIN', cls: 'CLASS_12', lang: 'en', school: 'Bishop Cotton Boys School' },
    { name: 'Ananya Reddy', state: 'TS', dist: 'Hyderabad', target: 'JEE_MAIN', cls: 'CLASS_11', lang: 'te', school: 'Chaitanya Junior College' },
    { name: 'Kavya Iyer', state: 'TN', dist: 'Chennai', target: 'NEET', cls: 'CLASS_11', lang: 'en', school: 'Padma Seshadri Bala Bhavan' },
    { name: 'Aditya Verma', state: 'RJ', dist: 'Kota', target: 'JEE_ADVANCED', cls: 'DROPPER', lang: 'hi', school: 'Allen Career Institute' },
    { name: 'Ishaan Joshi', state: 'MH', dist: 'Mumbai City', target: 'JEE_MAIN', cls: 'CLASS_12', lang: 'mr', school: 'Ruparel College' },
    { name: 'Pooja Hegde', state: 'KA', dist: 'Mysuru', target: 'NEET', cls: 'CLASS_12', lang: 'kn', school: 'Marimallappa PU College' },
    { name: 'Varun Nair', state: 'KA', dist: 'Mangaluru', target: 'NEET', cls: 'DROPPER', lang: 'en', school: 'Expert PU College' },
    { name: 'Meera Rao', state: 'TS', dist: 'Secunderabad', target: 'NEET', cls: 'CLASS_11', lang: 'en', school: 'FIITJEE Junior College' },
    { name: 'Siddharth Deshmukh', state: 'MH', dist: 'Nagpur', target: 'JEE_MAIN', cls: 'CLASS_12', lang: 'mr', school: 'Shivaji Science College' },
    { name: 'Tanvi Kulkarni', state: 'MH', dist: 'Nashik', target: 'NEET', cls: 'CLASS_12', lang: 'en', school: 'KTHM College' },
    { name: 'Yash Rathore', state: 'RJ', dist: 'Jaipur', target: 'JEE_ADVANCED', cls: 'CLASS_12', lang: 'hi', school: 'Maharaja Sawai Man Singh School' },
    { name: 'Sneha Sundaram', state: 'TN', dist: 'Coimbatore', target: 'NEET', cls: 'CLASS_12', lang: 'ta', school: 'PSG Sarvajana School' },
    { name: 'Manish Kumar', state: 'DL', dist: 'New Delhi', target: 'JEE_MAIN', cls: 'CLASS_11', lang: 'en', school: 'Modern School Barakhamba' },
    { name: 'Nisha Singhania', state: 'DL', dist: 'South Delhi', target: 'NEET', cls: 'CLASS_12', lang: 'en', school: 'Vasant Valley School' },
    { name: 'Harshil Shah', state: 'GJ', dist: 'Surat', target: 'JEE_MAIN', cls: 'DROPPER', lang: 'gu', school: 'P.P. Savani Vidhyalay' },
    { name: 'Bhavna Dave', state: 'GJ', dist: 'Rajkot', target: 'NEET', cls: 'CLASS_12', lang: 'gu', school: 'Dholakiya School' },
    { name: 'Tejas Gowda', state: 'KA', dist: 'Hubballi-Dharwad', target: 'CET', cls: 'CLASS_12', lang: 'kn', school: 'KLE Society PU College' },
    { name: 'Ritika Roy', state: 'DL', dist: 'North Delhi', target: 'NEET', cls: 'CLASS_11', lang: 'en', school: 'Mount Carmel School' },
    { name: 'Abhishek Choudhury', state: 'RJ', dist: 'Jodhpur', target: 'JEE_MAIN', cls: 'CLASS_12', lang: 'hi', school: 'Mayoor Chopasni School' },
    { name: 'Preeti Mittal', state: 'DL', dist: 'East Delhi', target: 'NEET', cls: 'DROPPER', lang: 'hi', school: 'Aakash Educational Services' },
    { name: 'Karthik Raja', state: 'TN', dist: 'Madurai', target: 'JEE_MAIN', cls: 'CLASS_11', lang: 'ta', school: 'TVS Matriculation Higher Secondary' },
    { name: 'Divya Shenoy', state: 'KA', dist: 'Udupi', target: 'NEET', cls: 'CLASS_12', lang: 'en', school: 'Poornaprajna PU College' },
    { name: 'Nikhil Mehta', state: 'GJ', dist: 'Vadodara', target: 'JEE_MAIN', cls: 'CLASS_12', lang: 'en', school: 'Navrachana School' },
    { name: 'Gayatri Pillai', state: 'MH', dist: 'Thane', target: 'NEET', cls: 'CLASS_11', lang: 'en', school: 'Smt. Sulochanadevi Singhania School' },
    { name: 'Gautam Menon', state: 'KA', dist: 'Bengaluru Rural', target: 'BITSAT', cls: 'CLASS_12', lang: 'en', school: 'Greenwood High International' },
    { name: 'Swati Agarwal', state: 'RJ', dist: 'Udaipur', target: 'NEET', cls: 'CLASS_12', lang: 'hi', school: 'St. Paul Senior Secondary' },
    { name: 'Pranav Bhat', state: 'KA', dist: 'Shivamogga', target: 'CET', cls: 'CLASS_11', lang: 'kn', school: 'DVS Composite PU College' },
    { name: 'Shruti Kamat', state: 'MH', dist: 'Mumbai Suburban', target: 'NEET', cls: 'CLASS_12', lang: 'en', school: 'D.G. Ruparel College' },
  ];

  const studentEntities: Student[] = [];

  for (let idx = 0; idx < studentNames.length; idx++) {
    const sData = studentNames[idx];
    const sIndex = idx + 1;
    const sNum = String(sIndex).padStart(3, '0');
    const sEmail = `student${sNum}@brainros.test`;
    const sPhone = `+91900000${String(sIndex + 1000).substring(1)}`;

    const user = await ensureUser(sEmail, sPhone, ['STUDENT']);

    // Check existing student profile
    let student = await prisma.student.findUnique({ where: { userId: user.id } });
    if (!student) {
      const stateObj = ctx.states.get(sData.state);
      const districtObj = ctx.districts.get(`${sData.state}:${sData.dist}`);
      const targetObj = ctx.examTargets.get(sData.target) || ctx.examTargets.get('NEET');
      const classObj = ctx.classes.get(sData.cls) || ctx.classes.get('CLASS_12');
      const langObj = ctx.languages.get(sData.lang) || ctx.languages.get('en');

      const year = new Date().getFullYear();
      const studentCode = `BRN-${year}-${String(sIndex).padStart(6, '0')}`;
      const studentId = `STU${String(1000 + sIndex)}`;

      student = await prisma.student.create({
        data: {
          userId: user.id,
          studentId,
          studentCode,
          name: sData.name,
          state: stateObj?.name || 'Karnataka',
          district: districtObj?.name || 'Bengaluru Urban',
          stateId: stateObj?.id,
          districtId: districtObj?.id,
          schoolCollege: sData.school,
          classId: classObj!.id,
          examTargetId: targetObj!.id,
          preferredLanguageId: langObj!.id,
          status: StudentStatus.ACTIVE,
        },
      });
      inc('students', true);
    } else {
      inc('students', false);
    }

    ctx.students.set(sEmail, student);
    ctx.students.set(student.studentId, student);
    studentEntities.push(student);
  }

  // 7. Link Parents to Students
  for (let pIdx = 0; pIdx < parentUsers.length; pIdx++) {
    const parent = parentUsers[pIdx];
    const linkedStudent = studentEntities[pIdx % studentEntities.length];
    if (parent && linkedStudent) {
      await prisma.parentStudentLink.upsert({
        where: { parentId_studentId: { parentId: parent.id, studentId: linkedStudent.id } },
        update: { status: ParentLinkStatus.ACTIVE },
        create: {
          parentId: parent.id,
          studentId: linkedStudent.id,
          relationshipType: pIdx % 2 === 0 ? ParentRelationshipType.FATHER : ParentRelationshipType.MOTHER,
          status: ParentLinkStatus.ACTIVE,
        },
      });
      inc('parent_student_links', true);
    }
  }

  return {
    seederName: 'UsersAndRolesSeeder',
    createdCounts: created,
    reusedCounts: reused,
    timeMs: Date.now() - start,
  };
}
