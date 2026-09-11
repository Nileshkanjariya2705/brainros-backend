import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ColumnDefinition, PdfExportOptions } from './pdf-export.service';
import { Prisma, StudentStatus } from '@prisma/client';

export interface ExportRequestContext {
  resource: string;
  filters?: Record<string, any>;
  search?: string;
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
  userId: string;
  userRoles: string[];
}

export interface ResolvedExportConfig {
  options: PdfExportOptions;
  totalCount: number;
}

@Injectable()
export class ExportRegistryService {
  private readonly logger = new Logger(ExportRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve export data and configuration for the requested resource
   */
  async resolveExport(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { resource, userId, userRoles } = ctx;

    // Check Actor's Institution Scoping if applicable
    let assignedInstitutionIds: string[] = [];
    const isSuperAdmin = userRoles.includes('SUPER_ADMIN');

    if (!isSuperAdmin) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { institutionAdmins: { where: { isActive: true } } },
      });
      assignedInstitutionIds = user?.institutionAdmins?.map((ia) => ia.institutionId) || [];
    }

    switch (resource.toLowerCase()) {
      case 'students':
        return this.exportStudents(ctx, assignedInstitutionIds, isSuperAdmin);

      case 'schools':
        return this.exportSchools(ctx, assignedInstitutionIds, isSuperAdmin);

      case 'staff':
        return this.exportStaff(ctx, isSuperAdmin);

      case 'invoices':
        return this.exportInvoices(ctx, assignedInstitutionIds, isSuperAdmin);

      case 'bills':
        return this.exportBills(ctx, assignedInstitutionIds, isSuperAdmin);

      case 'exams':
        return this.exportExams(ctx);

      case 'registrations':
        return this.exportRegistrations(ctx, assignedInstitutionIds, isSuperAdmin);

      case 'batches':
        return this.exportBatches(ctx, assignedInstitutionIds, isSuperAdmin);

      case 'questions':
        return this.exportQuestions(ctx);

      case 'translations':
        return this.exportTranslations(ctx);

      case 'approval_queue':
        return this.exportApprovalQueue(ctx);

      case 'completed_exams':
        return this.exportCompletedExams(ctx);

      case 'results':
        return this.exportResults(ctx);

      case 'rank_list':
        return this.exportRankList(ctx);

      case 'institution_students':
        return this.exportInstitutionStudents(ctx, assignedInstitutionIds, isSuperAdmin);

      case 'chapters':
        return this.exportChapters(ctx);

      default:
        throw new BadRequestException(
          `Resource '${resource}' is not supported for PDF export. Supported: students, schools, staff, invoices, bills, exams, registrations, batches, questions, translations, approval_queue, completed_exams, results, rank_list, institution_students, chapters.`,
        );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. STUDENTS DIRECTORY
  // ─────────────────────────────────────────────────────────────
  private async exportStudents(
    ctx: ExportRequestContext,
    assignedInstitutionIds: string[],
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    const { filters = {}, search, sort, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.StudentWhereInput = {};

    if (!isSuperAdmin && assignedInstitutionIds.length > 0) {
      where.batchMemberships = {
        some: { batch: { institutionId: { in: assignedInstitutionIds } } },
      };
    }

    if (filters.status) where.status = filters.status as StudentStatus;
    if (filters.classId) where.classId = filters.classId;
    if (filters.examTargetId) where.examTargetId = filters.examTargetId;
    if (filters.stateId) where.stateId = filters.stateId;
    if (filters.districtId) where.districtId = filters.districtId;

    if (filters.schoolId || filters.institutionId) {
      const instId = filters.schoolId || filters.institutionId;
      where.institutionId = instId;
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { studentCode: { contains: q, mode: 'insensitive' } },
        { user: { phone: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Prisma.StudentOrderByWithRelationInput = sort?.field
      ? { [sort.field]: sort.direction || 'desc' }
      : { createdAt: 'desc' };

    const [items, totalCount] = await Promise.all([
      this.prisma.student.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy,
        include: {
          user: true,
          examTarget: true,
          studentClass: true,
          stateRef: true,
          districtRef: true,
          institution: true,
        },
      }),
      this.prisma.student.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Student Name', key: 'name', width: 2.2 },
      { header: 'Student Code', key: 'studentCode', width: 1.3 },
      { header: 'Mobile', key: 'mobile', width: 1.3 },
      { header: 'School / Institution', key: 'schoolName', width: 2.2 },
      { header: 'Exam Target', key: 'targetName', width: 1.2 },
      { header: 'Class', key: 'className', width: 0.9, align: 'center' },
      { header: 'State / District', key: 'location', width: 1.8 },
      { header: 'Status', key: 'status', width: 1.1, align: 'center' },
    ];

    const data = items.map((s, idx) => {
      const schoolName = s.institution?.name || s.schoolCollege || '—';
      const stateName = s.stateRef?.name || s.state || '';
      const districtName = s.districtRef?.name || s.district || '';
      const location = [districtName, stateName].filter(Boolean).join(', ') || '—';

      return {
        _index: offset + idx + 1,
        name: s.name,
        studentCode: s.studentCode || s.studentId || '—',
        mobile: s.user?.phone || '—',
        schoolName,
        targetName: s.examTarget?.name || '—',
        className: s.studentClass?.name || '—',
        location,
        status: s.status,
      };
    });

    return {
      options: {
        title: 'Student Directory Report',
        subtitle: `Total Matching Records: ${totalCount} | Exported: ${data.length}`,
        orientation: 'landscape',
        columns,
        data,
        filterSummary: {
          Status: filters.status || 'All',
          Search: search || 'None',
          Target: filters.examTargetName || filters.examTargetId || 'All',
          State: filters.stateName || filters.stateId || 'All',
        },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 2. SCHOOLS / INSTITUTIONS DIRECTORY
  // ─────────────────────────────────────────────────────────────
  private async exportSchools(
    ctx: ExportRequestContext,
    assignedInstitutionIds: string[],
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.InstitutionWhereInput = {};

    if (!isSuperAdmin && assignedInstitutionIds.length > 0) {
      where.id = { in: assignedInstitutionIds };
    }

    if (filters.status) where.status = filters.status;
    if (filters.stateId) where.stateId = filters.stateId;
    if (filters.districtId) where.districtId = filters.districtId;

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.institution.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          stateRef: true,
          districtRef: true,
          _count: { select: { students: true, batches: true } },
        },
      }),
      this.prisma.institution.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'School Name', key: 'name', width: 2.5 },
      { header: 'School Code', key: 'code', width: 1.2 },
      { header: 'State', key: 'state', width: 1.5 },
      { header: 'District/City', key: 'district', width: 1.5 },
      { header: 'Phone', key: 'phone', width: 1.3 },
      { header: 'Students', key: 'studentsCount', width: 0.9, align: 'right' },
      { header: 'Batches', key: 'batchesCount', width: 0.8, align: 'right' },
      { header: 'Status', key: 'status', width: 1.0, align: 'center' },
    ];

    const data = items.map((s, idx) => ({
      _index: offset + idx + 1,
      name: s.name,
      code: s.code,
      state: s.stateRef?.name || s.state || '—',
      district: s.districtRef?.name || s.city || '—',
      phone: s.phone || '—',
      studentsCount: s._count.students,
      batchesCount: s._count.batches,
      status: s.status,
    }));

    return {
      options: {
        title: 'Schools & Colleges Roster',
        subtitle: `Total Matching Institutions: ${totalCount} | Exported: ${data.length}`,
        orientation: 'landscape',
        columns,
        data,
        filterSummary: {
          Status: filters.status || 'All',
          Search: search || 'None',
          State: filters.stateName || filters.stateId || 'All',
        },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 3. STAFF DIRECTORY
  // ─────────────────────────────────────────────────────────────
  private async exportStaff(
    ctx: ExportRequestContext,
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    if (!isSuperAdmin) {
      throw new ForbiddenException('Only Super Admins can export the staff directory.');
    }

    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.UserWhereInput = {
      userRoles: {
        some: {
          role: {
            name: {
              in: [
                'SUPER_ADMIN',
                'ADMIN',
                'GENERAL_MANAGER',
                'MANAGER',
                'OPERATOR',
                'SALES_AGENT',
                'FINANCE',
              ],
            },
          },
        },
      },
    };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.role) {
      where.userRoles = { some: { role: { name: filters.role } } };
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: { userRoles: { include: { role: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Staff Name', key: 'name', width: 2.2 },
      { header: 'Role', key: 'roles', width: 1.8 },
      { header: 'Mobile Number', key: 'phone', width: 1.4 },
      { header: 'Email Address', key: 'email', width: 2.2 },
      { header: 'Status', key: 'status', width: 1.0, align: 'center' },
    ];

    const data = items.map((u, idx) => ({
      _index: offset + idx + 1,
      name: u.name || '—',
      roles: u.userRoles?.map((r) => r.role.name.replace(/_/g, ' ')).join(', ') || 'STAFF',
      phone: u.phone || '—',
      email: u.email || '—',
      status: u.status,
    }));

    return {
      options: {
        title: 'Staff Personnel Register',
        subtitle: `Total Personnel: ${totalCount} | Exported: ${data.length}`,
        orientation: 'portrait',
        columns,
        data,
        filterSummary: {
          Role: filters.role || 'All Roles',
          Status: filters.status || 'All',
          Search: search || 'None',
        },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 4. INVOICES & BILLS
  // ─────────────────────────────────────────────────────────────
  private async exportInvoices(
    ctx: ExportRequestContext,
    assignedInstitutionIds: string[],
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.BillWhereInput = {};

    if (!isSuperAdmin && assignedInstitutionIds.length > 0) {
      where.institutionId = { in: assignedInstitutionIds };
    }

    if (filters.status && filters.status !== 'ALL') where.status = filters.status;
    if (filters.institutionId && filters.institutionId !== 'ALL') where.institutionId = filters.institutionId;
    if (filters.month && filters.month !== 'ALL') where.billingMonth = Number(filters.month);
    if (filters.year && filters.year !== 'ALL') where.billingYear = Number(filters.year);

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { billNumber: { contains: q, mode: 'insensitive' } },
        { institution: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { billDate: 'desc' },
        include: { institution: true },
      }),
      this.prisma.bill.count({ where }),
    ]);

    const formatInr = (n: number) =>
      new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Invoice #', key: 'billNumber', width: 1.4 },
      { header: 'School Name', key: 'schoolName', width: 2.4 },
      { header: 'Period', key: 'period', width: 1.2 },
      { header: 'Students', key: 'studentCount', width: 0.9, align: 'right' },
      { header: 'Taxable', key: 'taxable', width: 1.3, align: 'right' },
      { header: 'GST', key: 'tax', width: 1.1, align: 'right' },
      { header: 'Total (INR)', key: 'total', width: 1.4, align: 'right' },
      { header: 'Status', key: 'status', width: 1.0, align: 'center' },
    ];

    const data = items.map((b, idx) => ({
      _index: offset + idx + 1,
      billNumber: b.billNumber,
      schoolName: b.institution?.name || '—',
      period: b.billingMonth && b.billingYear ? `${b.billingMonth}/${b.billingYear}` : '—',
      studentCount: b.studentCount || 0,
      taxable: formatInr(b.amount),
      tax: formatInr(b.tax),
      total: formatInr(b.totalAmount),
      status: b.status,
    }));

    return {
      options: {
        title: 'Institutional Invoices & Billing Summary',
        subtitle: `Total Invoices: ${totalCount} | Exported: ${data.length}`,
        orientation: 'landscape',
        columns,
        data,
        filterSummary: {
          Status: filters.status || 'All',
          Search: search || 'None',
        },
      },
      totalCount,
    };
  }

  private async exportBills(
    ctx: ExportRequestContext,
    assignedInstitutionIds: string[],
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    return this.exportInvoices(ctx, assignedInstitutionIds, isSuperAdmin);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. EXAMS & SCHEDULES
  // ─────────────────────────────────────────────────────────────
  private async exportExams(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.ExamWhereInput = {};

    if (filters.statusId) where.statusId = filters.statusId;
    if (filters.examTargetId) where.examTargetId = filters.examTargetId;

    if (search && search.trim()) {
      const q = search.trim();
      where.title = { contains: q, mode: 'insensitive' };
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.exam.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          examTarget: true,
          status: true,
          versions: { take: 1 },
          _count: { select: { schedules: true, attempts: true } },
        },
      }),
      this.prisma.exam.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Exam Title', key: 'title', width: 2.8 },
      { header: 'Target', key: 'target', width: 1.2 },
      { header: 'Duration', key: 'duration', width: 1.0, align: 'center' },
      { header: 'Total Marks', key: 'marks', width: 1.0, align: 'right' },
      { header: 'Questions', key: 'questions', width: 1.0, align: 'right' },
      { header: 'Attempts', key: 'attempts', width: 1.0, align: 'right' },
      { header: 'Status', key: 'status', width: 1.1, align: 'center' },
    ];

    const data = items.map((e, idx) => ({
      _index: offset + idx + 1,
      title: e.title,
      target: e.examTarget?.name || 'General',
      duration: `${e.durationMinutes}m`,
      marks: e.totalMarks,
      questions: e.totalQuestions || e.versions?.[0]?.totalQuestions || 0,
      attempts: e._count.attempts,
      status: e.status?.name || 'ACTIVE',
    }));

    return {
      options: {
        title: 'Master Examinations Inventory',
        subtitle: `Total Exams: ${totalCount} | Exported: ${data.length}`,
        orientation: 'landscape',
        columns,
        data,
        filterSummary: {
          Status: filters.status || 'All',
          Search: search || 'None',
          Target: filters.examTargetName || 'All',
        },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 6. REGISTRATIONS
  // ─────────────────────────────────────────────────────────────
  private async exportRegistrations(
    ctx: ExportRequestContext,
    assignedInstitutionIds: string[],
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    return this.exportStudents(ctx, assignedInstitutionIds, isSuperAdmin);
  }

  // ─────────────────────────────────────────────────────────────
  // 7. BATCHES
  // ─────────────────────────────────────────────────────────────
  private async exportBatches(
    ctx: ExportRequestContext,
    assignedInstitutionIds: string[],
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.InstitutionBatchWhereInput = {};

    if (!isSuperAdmin && assignedInstitutionIds.length > 0) {
      where.institutionId = { in: assignedInstitutionIds };
    }

    if (filters.institutionId) where.institutionId = filters.institutionId;

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { academicYear: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.institutionBatch.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          institution: true,
          _count: { select: { students: true } },
        },
      }),
      this.prisma.institutionBatch.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Batch Name', key: 'name', width: 2.5 },
      { header: 'Institution', key: 'institution', width: 2.5 },
      { header: 'Academic Year', key: 'year', width: 1.2, align: 'center' },
      { header: 'Students', key: 'studentCount', width: 1.0, align: 'right' },
      { header: 'Status', key: 'status', width: 1.0, align: 'center' },
    ];

    const data = items.map((b, idx) => ({
      _index: offset + idx + 1,
      name: b.name,
      institution: b.institution?.name || '—',
      year: b.academicYear || '—',
      studentCount: b._count.students,
      status: b.status,
    }));

    return {
      options: {
        title: 'Academic Batches Register',
        subtitle: `Total Batches: ${totalCount} | Exported: ${data.length}`,
        orientation: 'portrait',
        columns,
        data,
        filterSummary: { Search: search || 'None' },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 8. QUESTIONS
  // ─────────────────────────────────────────────────────────────
  private async exportQuestions(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.QuestionWhereInput = {};

    if (filters.subjectId) where.subjectId = filters.subjectId;
    if (filters.chapterId) where.chapterId = filters.chapterId;
    if (filters.questionType) where.questionType = filters.questionType;

    if (search && search.trim()) {
      const q = search.trim();
      where.translations = {
        some: { questionText: { contains: q, mode: 'insensitive' } },
      };
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.question.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          subject: true,
          chapter: true,
          translations: { take: 1 },
        },
      }),
      this.prisma.question.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Question Statement', key: 'text', width: 3.5 },
      { header: 'Subject', key: 'subject', width: 1.3 },
      { header: 'Chapter', key: 'chapter', width: 1.5 },
      { header: 'Type', key: 'type', width: 1.2 },
      { header: 'Marks', key: 'marks', width: 0.8, align: 'right' },
    ];

    const data = items.map((q, idx) => ({
      _index: offset + idx + 1,
      text: q.translations?.[0]?.questionText?.replace(/<[^>]*>?/gm, '').slice(0, 100) || '—',
      subject: q.subject?.name || '—',
      chapter: q.chapter?.name || '—',
      type: q.type || 'SINGLE_CORRECT',
      marks: `+${q.marks}/-${q.negativeMarks}`,
    }));

    return {
      options: {
        title: 'Question Bank Inventory',
        subtitle: `Total Questions: ${totalCount} | Exported: ${data.length}`,
        orientation: 'landscape',
        columns,
        data,
        filterSummary: {
          Type: filters.questionType || 'All Types',
          Search: search || 'None',
        },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 9. TRANSLATIONS
  // ─────────────────────────────────────────────────────────────
  private async exportTranslations(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.QuestionTranslationWhereInput = {};

    if (filters.languageId) where.languageId = filters.languageId;

    if (search && search.trim()) {
      where.questionText = { contains: search.trim(), mode: 'insensitive' };
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.questionTranslation.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: { language: true, question: true },
      }),
      this.prisma.questionTranslation.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Language', key: 'language', width: 1.5 },
      { header: 'Translated Statement', key: 'text', width: 4.5 },
    ];

    const data = items.map((t, idx) => ({
      _index: offset + idx + 1,
      language: t.language?.name || '—',
      text: t.questionText?.replace(/<[^>]*>?/gm, '').slice(0, 120) || '—',
    }));

    return {
      options: {
        title: 'Regional Translation Roster',
        subtitle: `Total Translations: ${totalCount} | Exported: ${data.length}`,
        orientation: 'landscape',
        columns,
        data,
        filterSummary: {
          Language: filters.languageName || 'All Languages',
        },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 10. APPROVAL QUEUE
  // ─────────────────────────────────────────────────────────────
  private async exportApprovalQueue(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { filters = {}, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.ApprovalRequestWhereInput = {};

    if (filters.status) where.status = filters.status;
    if (filters.resourceType) where.resourceType = filters.resourceType;

    const [items, totalCount] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Item Type', key: 'resourceType', width: 1.8 },
      { header: 'Entity Reference', key: 'resourceId', width: 2.2 },
      { header: 'Requested At', key: 'submittedAt', width: 1.5 },
      { header: 'Status', key: 'status', width: 1.2, align: 'center' },
    ];

    const data = items.map((a, idx) => ({
      _index: offset + idx + 1,
      resourceType: a.resourceType?.replace(/_/g, ' ') || 'GENERAL',
      resourceId: a.resourceId?.slice(0, 12) || '—',
      submittedAt: a.submittedAt ? new Date(a.submittedAt).toLocaleDateString('en-IN') : '—',
      status: a.status,
    }));

    return {
      options: {
        title: 'Administrative Approval Queue',
        subtitle: `Total Items: ${totalCount} | Exported: ${data.length}`,
        orientation: 'portrait',
        columns,
        data,
        filterSummary: {
          Status: filters.status || 'All',
          Type: filters.resourceType || 'All Types',
        },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 11. COMPLETED EXAMS
  // ─────────────────────────────────────────────────────────────
  private async exportCompletedExams(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { limit = 2000, offset = 0 } = ctx;
    const where: Prisma.ExamScheduleWhereInput = {
      status: 'ENDED',
    };

    const [items, totalCount] = await Promise.all([
      this.prisma.examSchedule.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { endTime: 'desc' },
        include: { exam: { include: { examTarget: true } } },
      }),
      this.prisma.examSchedule.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Exam Title', key: 'title', width: 2.8 },
      { header: 'Target Standard', key: 'target', width: 1.4 },
      { header: 'End Date', key: 'endDate', width: 1.4 },
      { header: 'Questions', key: 'questions', width: 1.0, align: 'right' },
      { header: 'Key Status', key: 'keyStatus', width: 1.4, align: 'center' },
    ];

    const data = items.map((s, idx) => ({
      _index: offset + idx + 1,
      title: s.exam.title,
      target: s.exam.examTarget?.name || 'General',
      endDate: new Date(s.endTime).toLocaleDateString('en-IN'),
      questions: s.exam.totalQuestions,
      keyStatus: s.hasAnswerKey ? 'KEY READY' : 'KEY PENDING',
    }));

    return {
      options: {
        title: 'Concluded Official Examinations',
        subtitle: `Total Concluded Exams: ${totalCount} | Exported: ${data.length}`,
        orientation: 'portrait',
        columns,
        data,
        filterSummary: { Status: 'ENDED' },
      },
      totalCount,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 12. EXAM RESULTS & RANK LIST
  // ─────────────────────────────────────────────────────────────
  private async exportResults(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { filters = {}, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.ResultWhereInput = {};

    if (filters.examId) {
      where.attempt = { examId: filters.examId };
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.result.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { totalScore: 'desc' },
        include: {
          attempt: {
            include: {
              student: true,
              exam: true,
            },
          },
        },
      }),
      this.prisma.result.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.6, align: 'center' },
      { header: 'Student Name', key: 'studentName', width: 2.4 },
      { header: 'Student Code', key: 'studentCode', width: 1.4 },
      { header: 'Score', key: 'score', width: 1.2, align: 'right' },
      { header: 'Percentage', key: 'percentage', width: 1.2, align: 'right' },
      { header: 'Accuracy', key: 'accuracy', width: 1.2, align: 'right' },
    ];

    const data = items.map((r, idx) => ({
      _index: offset + idx + 1,
      studentName: r.attempt?.student?.name || 'Student',
      studentCode: r.attempt?.student?.studentCode || '—',
      score: `${r.totalScore} / ${r.maxScore}`,
      percentage: `${r.percentage.toFixed(1)}%`,
      accuracy: `${r.accuracy.toFixed(1)}%`,
    }));

    return {
      options: {
        title: 'Official Examination Results',
        subtitle: `Exam: ${items[0]?.attempt?.exam?.title || 'Selected Exam'} | Total Candidates: ${totalCount}`,
        orientation: 'landscape',
        columns,
        data,
      },
      totalCount,
    };
  }

  private async exportRankList(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    return this.exportResults(ctx);
  }

  private async exportInstitutionStudents(
    ctx: ExportRequestContext,
    assignedInstitutionIds: string[],
    isSuperAdmin: boolean,
  ): Promise<ResolvedExportConfig> {
    return this.exportStudents(ctx, assignedInstitutionIds, isSuperAdmin);
  }

  // ─────────────────────────────────────────────────────────────
  // 13. CHAPTERS
  // ─────────────────────────────────────────────────────────────
  private async exportChapters(ctx: ExportRequestContext): Promise<ResolvedExportConfig> {
    const { filters = {}, search, limit = 2000, offset = 0 } = ctx;
    const where: Prisma.ChapterWhereInput = {};

    if (filters.subjectId) where.subjectId = filters.subjectId;

    if (search && search.trim()) {
      where.name = { contains: search.trim(), mode: 'insensitive' };
    }

    const [items, totalCount] = await Promise.all([
      this.prisma.chapter.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { name: 'asc' },
        include: {
          subject: true,
          _count: { select: { questions: true } },
        },
      }),
      this.prisma.chapter.count({ where }),
    ]);

    const columns: ColumnDefinition[] = [
      { header: '#', key: '_index', width: 0.5, align: 'center' },
      { header: 'Chapter Name', key: 'name', width: 2.8 },
      { header: 'Subject', key: 'subject', width: 1.8 },
      { header: 'Questions Count', key: 'questionCount', width: 1.2, align: 'right' },
    ];

    const data = items.map((c, idx) => ({
      _index: offset + idx + 1,
      name: c.name,
      subject: c.subject?.name || 'General',
      questionCount: c._count.questions,
    }));

    return {
      options: {
        title: 'Subject Curriculum Chapters Directory',
        subtitle: `Total Chapters: ${totalCount} | Exported: ${data.length}`,
        orientation: 'portrait',
        columns,
        data,
        filterSummary: { Search: search || 'None' },
      },
      totalCount,
    };
  }
}
