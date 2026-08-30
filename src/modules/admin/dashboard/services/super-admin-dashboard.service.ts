import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import {
  SuperAdminAnalyticsFilterDto,
  DateRangePreset,
} from '../../dto/super-admin-dashboard.dto';

const CACHE_TTL_SECONDS = 120; // 2 minutes

@Injectable()
export class SuperAdminDashboardService {
  private readonly logger = new Logger(SuperAdminDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Helper: Parse Date Range Filter into start and end Date objects.
   */
  private parseDateRange(filter: SuperAdminAnalyticsFilterDto): {
    startDate?: Date;
    endDate?: Date;
  } {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (filter.from || filter.to) {
      return {
        startDate: filter.from ? new Date(filter.from) : undefined,
        endDate: filter.to ? new Date(filter.to) : new Date(),
      };
    }

    switch (filter.dateRange) {
      case DateRangePreset.TODAY:
        return { startDate: todayStart, endDate: now };
      case DateRangePreset.LAST_7_DAYS:
        return {
          startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          endDate: now,
        };
      case DateRangePreset.LAST_30_DAYS:
        return {
          startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          endDate: now,
        };
      case DateRangePreset.LAST_90_DAYS:
        return {
          startDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          endDate: now,
        };
      case DateRangePreset.ALL:
      default:
        return {};
    }
  }

  /**
   * Helper: Build common student WHERE filter clause from DTO.
   */
  private buildStudentWhere(filter: SuperAdminAnalyticsFilterDto): any {
    const where: any = {};
    const { startDate, endDate } = this.parseDateRange(filter);

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    if (filter.stateId) where.stateId = filter.stateId;
    else if (filter.state) {
      where.state = { contains: filter.state, mode: 'insensitive' };
    }

    if (filter.districtId) where.districtId = filter.districtId;
    else if (filter.district) {
      where.district = { contains: filter.district, mode: 'insensitive' };
    }

    if (filter.examTargetId) where.examTargetId = filter.examTargetId;
    if (filter.languageId) where.preferredLanguageId = filter.languageId;

    if (filter.institutionId) {
      where.OR = [
        {
          batchMemberships: {
            some: { batch: { institutionId: filter.institutionId } },
          },
        },
      ];
    }

    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { studentId: { contains: filter.search, mode: 'insensitive' } },
        { schoolCollege: { contains: filter.search, mode: 'insensitive' } },
        { state: { contains: filter.search, mode: 'insensitive' } },
        { district: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /**
   * 1. Overview KPI Cards (Total Students, Active Students, Exams Conducted, Total Attempts)
   */
  async getOverview(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:overview:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const studentWhere = this.buildStudentWhere(filter);
    const { startDate, endDate } = this.parseDateRange(filter);

    const examWhere: any = {
      status: { name: { in: ['COMPLETED', 'ENDED'] } },
    };
    if (startDate || endDate) {
      examWhere.updatedAt = {};
      if (startDate) examWhere.updatedAt.gte = startDate;
      if (endDate) examWhere.updatedAt.lte = endDate;
    }

    const attemptWhere: any = {};
    if (startDate || endDate) {
      attemptWhere.createdAt = {};
      if (startDate) attemptWhere.createdAt.gte = startDate;
      if (endDate) attemptWhere.createdAt.lte = endDate;
    }

    const [
      totalStudents,
      activeStudents,
      examsConducted,
      totalAttempts,
      completedAttempts,
      totalInstitutions,
    ] = await Promise.all([
      this.prisma.student.count({ where: studentWhere }),
      this.prisma.student.count({
        where: {
          ...studentWhere,
          status: 'ACTIVE',
          user: { isActive: true, status: 'ACTIVE' },
        },
      }),
      this.prisma.exam.count({ where: examWhere }),
      this.prisma.attempt.count({ where: attemptWhere }),
      this.prisma.attempt.count({
        where: {
          ...attemptWhere,
          status: { name: { in: ['COMPLETED', 'SUBMITTED'] } },
        },
      }),
      this.prisma.institution.count({ where: { status: 'ACTIVE' } }),
    ]);

    const activePercentage =
      totalStudents > 0
        ? Number(((activeStudents / totalStudents) * 100).toFixed(1))
        : 0;

    const result = {
      totalStudents,
      activeStudents,
      activePercentage,
      examsConducted,
      totalAttempts,
      completedAttempts,
      totalInstitutions,
      timestamp: new Date().toISOString(),
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 2. Daily Registrations Analytics (Timeline with zero-fill)
   */
  async getDailyRegistrations(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:daily-registrations:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const studentWhere = this.buildStudentWhere(filter);
    const { startDate, endDate } = this.parseDateRange(filter);

    const rangeStart =
      startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rangeEnd = endDate || new Date();

    const students = await this.prisma.student.findMany({
      where: {
        ...studentWhere,
        createdAt: {
          gte: rangeStart,
          lte: rangeEnd,
        },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Bucket counts by YYYY-MM-DD
    const countsByDate = new Map<string, number>();
    for (const st of students) {
      const dateKey = st.createdAt.toISOString().split('T')[0];
      countsByDate.set(dateKey, (countsByDate.get(dateKey) || 0) + 1);
    }

    // Build complete chronological array with zero-fill
    const timeline: { date: string; registrations: number; cumulative: number }[] = [];
    let cumulative = 0;

    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    const endMidnight = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());

    while (cursor <= endMidnight) {
      const key = cursor.toISOString().split('T')[0];
      const count = countsByDate.get(key) || 0;
      cumulative += count;
      timeline.push({
        date: key,
        registrations: count,
        cumulative,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const totalRegistrations = students.length;
    const result = {
      timeline,
      totalRegistrations,
      averageDaily:
        timeline.length > 0
          ? Number((totalRegistrations / timeline.length).toFixed(1))
          : 0,
      range: {
        from: rangeStart.toISOString().split('T')[0],
        to: rangeEnd.toISOString().split('T')[0],
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 3. State-wise Registrations Analytics
   */
  async getStateRegistrations(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:state-registrations:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const studentWhere = this.buildStudentWhere(filter);

    const students = await this.prisma.student.findMany({
      where: studentWhere,
      select: {
        state: true,
        stateId: true,
        stateRef: { select: { id: true, name: true, code: true } },
      },
    });

    const total = students.length;
    const stateMap = new Map<
      string,
      { stateName: string; stateId?: string; count: number }
    >();

    for (const st of students) {
      const name = st.stateRef?.name || st.state || 'Unspecified';
      const current = stateMap.get(name) || {
        stateName: name,
        stateId: st.stateId || undefined,
        count: 0,
      };
      current.count += 1;
      stateMap.set(name, current);
    }

    let items = Array.from(stateMap.values())
      .map((item) => ({
        state: item.stateName,
        stateId: item.stateId,
        count: item.count,
        percentage:
          total > 0 ? Number(((item.count / total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Optional Search
    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter((i) => i.state.toLowerCase().includes(q));
    }

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const paginatedItems = items.slice((page - 1) * limit, page * limit);

    const result = {
      data: paginatedItems,
      totalCount: items.length,
      totalStudents: total,
      meta: {
        total: items.length,
        page,
        limit,
        pages: Math.ceil(items.length / limit) || 1,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 4. District-wise Registrations Analytics (Filtered by State where applicable)
   */
  async getDistrictRegistrations(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:district-registrations:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const studentWhere = this.buildStudentWhere(filter);

    const students = await this.prisma.student.findMany({
      where: studentWhere,
      select: {
        district: true,
        districtId: true,
        state: true,
        districtRef: { select: { id: true, name: true } },
        stateRef: { select: { name: true } },
      },
    });

    const total = students.length;
    const districtMap = new Map<
      string,
      { districtName: string; stateName: string; count: number }
    >();

    for (const st of students) {
      const dName = st.districtRef?.name || st.district || 'Unspecified';
      const sName = st.stateRef?.name || st.state || 'Unspecified';
      const key = `${sName}:::${dName}`;
      const current = districtMap.get(key) || {
        districtName: dName,
        stateName: sName,
        count: 0,
      };
      current.count += 1;
      districtMap.set(key, current);
    }

    let items = Array.from(districtMap.values())
      .map((item) => ({
        district: item.districtName,
        state: item.stateName,
        count: item.count,
        percentage:
          total > 0 ? Number(((item.count / total) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (i) =>
          i.district.toLowerCase().includes(q) ||
          i.state.toLowerCase().includes(q),
      );
    }

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const paginatedItems = items.slice((page - 1) * limit, page * limit);

    const result = {
      data: paginatedItems,
      totalCount: items.length,
      totalStudents: total,
      meta: {
        total: items.length,
        page,
        limit,
        pages: Math.ceil(items.length / limit) || 1,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 5. Institution-wise Registrations Analytics (Searchable, paginated, real relation)
   */
  async getInstitutionRegistrations(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:institution-registrations:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const institutions = await this.prisma.institution.findMany({
      include: {
        batches: {
          include: {
            students: {
              where: { status: 'ACTIVE' },
              select: { id: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const institutionStats = institutions.map((inst) => {
      let studentCount = 0;
      for (const b of inst.batches) {
        studentCount += b.students.length;
      }
      return {
        institutionId: inst.id,
        name: inst.name,
        code: inst.code,
        type: inst.type,
        status: inst.status,
        state: inst.state || 'N/A',
        city: inst.city || 'N/A',
        batchCount: inst.batches.length,
        studentCount,
      };
    });

    // Also collect standalone school/college text names from students who may not be in official B2B batches
    const rawStudents = await this.prisma.student.findMany({
      where: {
        batchMemberships: { none: {} },
        schoolCollege: { not: '' },
      },
      select: { schoolCollege: true, state: true },
    });

    const schoolMap = new Map<
      string,
      { name: string; state: string; count: number }
    >();
    for (const rs of rawStudents) {
      const name = rs.schoolCollege.trim();
      if (!name) continue;
      const current = schoolMap.get(name) || {
        name,
        state: rs.state || 'N/A',
        count: 0,
      };
      current.count += 1;
      schoolMap.set(name, current);
    }

    const standaloneInstitutes = Array.from(schoolMap.values()).map((sc) => ({
      institutionId: undefined,
      name: sc.name,
      code: 'DIRECT_ENROLL',
      type: 'SCHOOL',
      status: 'ACTIVE',
      state: sc.state,
      city: 'N/A',
      batchCount: 0,
      studentCount: sc.count,
    }));

    let combined = [...institutionStats, ...standaloneInstitutes].sort(
      (a, b) => b.studentCount - a.studentCount,
    );

    if (filter.search) {
      const q = filter.search.toLowerCase();
      combined = combined.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.code.toLowerCase().includes(q) ||
          i.state.toLowerCase().includes(q),
      );
    }

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const paginated = combined.slice((page - 1) * limit, page * limit);

    const result = {
      data: paginated,
      totalCount: combined.length,
      meta: {
        total: combined.length,
        page,
        limit,
        pages: Math.ceil(combined.length / limit) || 1,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 6. Exam Target Analytics (NEET, JEE, CET, etc. dynamically from DB)
   */
  async getExamTargetAnalytics(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:exam-targets:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const studentWhere = this.buildStudentWhere(filter);

    const [targets, totalStudents] = await Promise.all([
      this.prisma.examTarget.findMany({
        include: {
          students: {
            where: studentWhere,
            select: { id: true },
          },
        },
      }),
      this.prisma.student.count({ where: studentWhere }),
    ]);

    const breakdown = targets
      .map((t) => {
        const count = t.students.length;
        const percentage =
          totalStudents > 0
            ? Number(((count / totalStudents) * 100).toFixed(1))
            : 0;
        return {
          id: t.id,
          name: t.name,
          description: t.description || '',
          count,
          percentage,
        };
      })
      .sort((a, b) => b.count - a.count);

    const result = {
      targets: breakdown,
      totalStudents,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 7. Language Preference Analytics (Dynamic from database)
   */
  async getLanguagePreferenceAnalytics(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:language-preferences:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const studentWhere = this.buildStudentWhere(filter);

    const [languages, totalStudents] = await Promise.all([
      this.prisma.preferredLanguage.findMany({
        where: { isActive: true },
        include: {
          students: {
            where: studentWhere,
            select: { id: true },
          },
        },
      }),
      this.prisma.student.count({ where: studentWhere }),
    ]);

    const breakdown = languages
      .map((lang) => {
        const count = lang.students.length;
        const percentage =
          totalStudents > 0
            ? Number(((count / totalStudents) * 100).toFixed(1))
            : 0;
        return {
          id: lang.id,
          name: lang.name,
          code: lang.code || '',
          nativeName: lang.nativeName || lang.name,
          count,
          percentage,
        };
      })
      .sort((a, b) => b.count - a.count);

    const result = {
      languages: breakdown,
      totalStudents,
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 8. Revenue Analytics (Orders, Transactions, Breakdowns & Trend)
   */
  async getRevenueAnalytics(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:revenue:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const { startDate, endDate } = this.parseDateRange(filter);
    const paymentWhere: any = {};
    if (startDate || endDate) {
      paymentWhere.createdAt = {};
      if (startDate) paymentWhere.createdAt.gte = startDate;
      if (endDate) paymentWhere.createdAt.lte = endDate;
    }

    const payments = await this.prisma.payment.findMany({
      where: paymentWhere,
      include: {
        order: {
          include: {
            examTarget: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    let totalRevenue = 0;
    let successfulCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    let totalRefunded = 0;

    const revenueByDate = new Map<string, number>();
    const revenueByProduct = new Map<string, { name: string; amount: number; count: number }>();
    const revenueByGateway = new Map<string, number>();

    for (const pay of payments) {
      if (pay.status === 'SUCCESS') {
        totalRevenue += pay.amount;
        successfulCount += 1;

        const dateKey = pay.paidAt
          ? pay.paidAt.toISOString().split('T')[0]
          : pay.createdAt.toISOString().split('T')[0];
        revenueByDate.set(
          dateKey,
          (revenueByDate.get(dateKey) || 0) + pay.amount,
        );

        const prodKey = pay.order?.itemName || 'Test Series';
        const currentProd = revenueByProduct.get(prodKey) || {
          name: prodKey,
          amount: 0,
          count: 0,
        };
        currentProd.amount += pay.amount;
        currentProd.count += 1;
        revenueByProduct.set(prodKey, currentProd);

        const gatewayKey = pay.gateway;
        revenueByGateway.set(
          gatewayKey,
          (revenueByGateway.get(gatewayKey) || 0) + pay.amount,
        );
      } else if (pay.status === 'INITIATED') {
        pendingCount += 1;
      } else if (pay.status === 'FAILED') {
        failedCount += 1;
      } else if (pay.status === 'REFUNDED') {
        totalRefunded += pay.refundedAmount || pay.amount;
      }
    }

    // Build timeline
    const rangeStart = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rangeEnd = endDate || new Date();
    const timeline: { date: string; revenue: number }[] = [];

    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    const endMidnight = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());

    while (cursor <= endMidnight) {
      const key = cursor.toISOString().split('T')[0];
      timeline.push({
        date: key,
        revenue: revenueByDate.get(key) || 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    const result = {
      summary: {
        totalRevenue,
        currency: 'INR',
        currencySymbol: '₹',
        successfulTransactions: successfulCount,
        pendingTransactions: pendingCount,
        failedTransactions: failedCount,
        refundedAmount: totalRefunded,
        netRevenue: Math.max(0, totalRevenue - totalRefunded),
      },
      timeline,
      products: Array.from(revenueByProduct.values()).sort((a, b) => b.amount - a.amount),
      gateways: Array.from(revenueByGateway.entries()).map(([gateway, amount]) => ({
        gateway,
        amount,
        percentage: totalRevenue > 0 ? Number(((amount / totalRevenue) * 100).toFixed(1)) : 0,
      })),
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 9. Conversion Rate Analytics (Student -> Attempt -> Paying Customer Funnel)
   */
  async getConversionRateAnalytics(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:conversion-rate:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const studentWhere = this.buildStudentWhere(filter);

    const [
      totalStudents,
      studentsWithAttempts,
      payingStudentsCount,
      totalLeads,
      convertedLeads,
    ] = await Promise.all([
      this.prisma.student.count({ where: studentWhere }),
      this.prisma.student.count({
        where: {
          ...studentWhere,
          attempts: { some: {} },
        },
      }),
      this.prisma.student.count({
        where: {
          ...studentWhere,
          orders: { some: { status: 'COMPLETED' } },
        },
      }),
      this.prisma.salesLead.count(),
      this.prisma.salesLead.count({ where: { status: 'CONVERTED' } }),
    ]);

    const payingConversionRate =
      totalStudents > 0
        ? Number(((payingStudentsCount / totalStudents) * 100).toFixed(1))
        : 0;

    const attemptConversionRate =
      totalStudents > 0
        ? Number(((studentsWithAttempts / totalStudents) * 100).toFixed(1))
        : 0;

    const salesLeadConversionRate =
      totalLeads > 0
        ? Number(((convertedLeads / totalLeads) * 100).toFixed(1))
        : 0;

    const result = {
      funnel: {
        totalRegistered: totalStudents,
        attemptedExam: studentsWithAttempts,
        attemptConversionRate,
        purchasedPackage: payingStudentsCount,
        payingConversionRate,
      },
      salesLeads: {
        totalLeads,
        convertedLeads,
        leadConversionRate: salesLeadConversionRate,
      },
      formulaUsed:
        'Paying Conversion Rate = (Paying Students / Total Registered Students) * 100',
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 10. Sales Agent Performance Analytics (Leads, conversions, orders, revenue, AOV)
   */
  async getSalesAgentPerformance(filter: SuperAdminAnalyticsFilterDto = {}) {
    const cacheKey = `super-admin:sales-agent-performance:${JSON.stringify(filter)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const { startDate, endDate } = this.parseDateRange(filter);
    const orderDateWhere: any = {};
    if (startDate || endDate) {
      orderDateWhere.createdAt = {};
      if (startDate) orderDateWhere.createdAt.gte = startDate;
      if (endDate) orderDateWhere.createdAt.lte = endDate;
    }

    // Find all users with SALES_AGENT role
    const salesAgents = await this.prisma.user.findMany({
      where: {
        userRoles: {
          some: { role: { name: 'SALES_AGENT' } },
        },
      },
      include: {
        salesOrders: {
          where: orderDateWhere,
          include: { payments: true },
        },
        salesLeads: true,
      },
    });

    let performanceData = salesAgents.map((agent) => {
      const assignedLeads = agent.salesLeads.length;
      const convertedLeads = agent.salesLeads.filter(
        (l) => l.status === 'CONVERTED',
      ).length;
      const conversionRate =
        assignedLeads > 0
          ? Number(((convertedLeads / assignedLeads) * 100).toFixed(1))
          : 0;

      const totalOrders = agent.salesOrders.length;
      const completedOrders = agent.salesOrders.filter(
        (o) => o.status === 'COMPLETED',
      );
      const successfulSales = completedOrders.length;

      const revenueGenerated = completedOrders.reduce(
        (acc, o) => acc + o.amount,
        0,
      );
      const averageOrderValue =
        successfulSales > 0
          ? Number((revenueGenerated / successfulSales).toFixed(0))
          : 0;

      return {
        id: agent.id,
        name: agent.email?.split('@')[0] || 'Sales Agent',
        email: agent.email || '',
        phone: agent.phone || agent.mobileNumber || '',
        assignedLeads,
        convertedLeads,
        conversionRate,
        totalOrders,
        successfulSales,
        revenueGenerated,
        averageOrderValue,
        currency: 'INR',
      };
    });

    // Default sort by revenueGenerated descending
    performanceData.sort((a, b) => b.revenueGenerated - a.revenueGenerated);

    if (filter.search) {
      const q = filter.search.toLowerCase();
      performanceData = performanceData.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q) ||
          a.phone.includes(q),
      );
    }

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const paginated = performanceData.slice((page - 1) * limit, page * limit);

    const result = {
      data: paginated,
      totalCount: performanceData.length,
      meta: {
        total: performanceData.length,
        page,
        limit,
        pages: Math.ceil(performanceData.length / limit) || 1,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * 11. Dynamic Filters Metadata (Populate filter dropdowns directly from DB)
   */
  async getFiltersMetadata() {
    const cacheKey = 'super-admin:filters-metadata';
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }

    const [states, districts, institutions, examTargets, languages, salesAgents] =
      await Promise.all([
        this.prisma.state.findMany({
          where: { isActive: true },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.district.findMany({
          where: { isActive: true },
          select: { id: true, name: true, stateId: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.institution.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.examTarget.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.preferredLanguage.findMany({
          where: { isActive: true },
          select: { id: true, name: true, code: true },
          orderBy: { displayOrder: 'asc' },
        }),
        this.prisma.user.findMany({
          where: { userRoles: { some: { role: { name: 'SALES_AGENT' } } } },
          select: { id: true, email: true, phone: true },
        }),
      ]);

    const result = {
      states,
      districts,
      institutions,
      examTargets,
      languages,
      salesAgents: salesAgents.map((sa) => ({
        id: sa.id,
        name: sa.email?.split('@')[0] || sa.phone || 'Sales Agent',
      })),
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 300); // 5 minutes cache
    return result;
  }
}
