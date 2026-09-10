import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedStaffRoles() {
  console.log('Seeding Staff Roles & Permissions...');

  const staffRoles = [
    { name: 'OPERATOR', description: 'Operations staff for exams, questions, and translations' },
    { name: 'MANAGER', description: 'Operational and candidate/institution management staff' },
    { name: 'GENERAL_MANAGER', description: 'Senior management staff overseeing platform operations' },
    { name: 'ACCOUNTANT', description: 'Financial, invoicing, and billing staff' },
  ];

  const roleMap: Record<string, any> = {};

  for (const r of staffRoles) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, isActive: true },
      create: { name: r.name, description: r.description, isActive: true },
    });
    roleMap[r.name] = role;
    console.log(`✓ Role ready: ${role.name}`);
  }

  // New billing & staff permissions if not already present
  const newPermissions = [
    { code: 'bill:view', description: 'View institutional bills and invoices' },
    { code: 'bill:create', description: 'Create draft institutional bills' },
    { code: 'bill:submit', description: 'Submit bills for Super Admin approval' },
    { code: 'bill:approve', description: 'Approve or reject institutional bills (Super Admin only)' },
    { code: 'staff:manage', description: 'Create and manage staff accounts (Super Admin only)' },
  ];

  for (const p of newPermissions) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { description: p.description, isActive: true },
      create: { code: p.code, description: p.description, isActive: true },
    });
  }

  // Grant bill:approve and staff:manage to SUPER_ADMIN
  const superAdmin = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (superAdmin) {
    const allPerms = await prisma.permission.findMany({ where: { isActive: true } });
    for (const p of allPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: superAdmin.id, permissionId: p.id } },
        update: {},
        create: { roleId: superAdmin.id, permissionId: p.id },
      });
    }
  }

  // Role permissions mapping
  const rolePermMappings: Record<string, string[]> = {
    OPERATOR: [
      'student:view',
      'exam:view',
      'exam:schedule',
      'question:view',
      'question:create',
      'question:update',
      'translation:view',
      'translation:create',
      'translation:update',
      'chapter:view',
      'report:view',
      'notification:view',
    ],
    MANAGER: [
      'student:view',
      'student:update',
      'student:manage',
      'institution:view',
      'institution:manage',
      'batch:manage',
      'exam:view',
      'exam:create',
      'exam:edit',
      'exam:schedule',
      'question:view',
      'question:create',
      'question:update',
      'translation:view',
      'translation:create',
      'translation:update',
      'chapter:view',
      'analytics:view',
      'report:view',
      'notification:view',
    ],
    GENERAL_MANAGER: [
      'student:view',
      'student:update',
      'student:manage',
      'institution:view',
      'institution:manage',
      'batch:manage',
      'exam:view',
      'exam:create',
      'exam:edit',
      'exam:schedule',
      'question:view',
      'question:create',
      'question:update',
      'question:review',
      'translation:view',
      'translation:create',
      'translation:update',
      'chapter:view',
      'analytics:view',
      'report:view',
      'report:generate',
      'report:export',
      'notification:view',
      'approval:view',
    ],
    ACCOUNTANT: [
      'bill:view',
      'bill:create',
      'bill:submit',
      'revenue:view',
      'report:view',
      'report:export',
      'institution:view',
      'notification:view',
    ],
  };

  for (const [roleName, permCodes] of Object.entries(rolePermMappings)) {
    const role = roleMap[roleName];
    if (!role) continue;

    for (const code of permCodes) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (perm) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          update: {},
          create: { roleId: role.id, permissionId: perm.id },
        });
      }
    }
    console.log(`✓ Permissions assigned to ${roleName}: ${permCodes.length} permissions (0 delete permissions)`);
  }

  console.log('✅ Staff Roles & Permissions seeding complete.');
}

seedStaffRoles()
  .catch((e) => {
    console.error('Error seeding staff roles:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
