import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import * as ExcelJS from 'exceljs';
import {
  InstitutionDashboardSummary,
  BatchAnalytics,
  SubjectPerformanceItem,
  TrendPoint,
} from '../interfaces/institution.interface';
import {
  DashboardQueryDto,
  InstituteStudentQueryDto,
  InstituteRankQueryDto,
  ExportInstituteStudentsDto,
} from '../dto/institution.dto';

const DASHBOARD_CACHE_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class InstitutionDashboardService {
  private readonly logger = new Logger(InstitutionDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Main Institution Dashboard Summary with Redis caching
   */
  async getDashboardSummary(
    institutionId: string,
    query: DashboardQueryDto = {},
  ): Promise<InstitutionDashboardSummary> {
    const cacheKey = `institution:${institutionId}:dashboard:${JSON.stringify(query)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        this.logger.warn(
          `Failed to parse cached dashboard for ${institutionId}`,
        );
      }
    }

    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });

    if (!institution) {
      throw new NotFoundException(`Institution '${institutionId}' not found.`);
    }

    // 1. Get all batches for this institution
    const batches = await this.prisma.institutionBatch.findMany({
      where: { institutionId },
      include: {
        students: {
          include: {
            student: {
              include: {
                attempts: {
                  where: { status: { name: 'COMPLETED' } },
                  include: {
                    result: {
                      include: {
                        subjectResults: { include: { subject: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // 2. Also get any students directly attached to institution
    const directStudents = await this.prisma.student.findMany({
      where: {
        institutionId,
      },
      include: {
        attempts: {
          where: { status: { name: 'COMPLETED' } },
          include: {
            result: {
              include: {
                subjectResults: { include: { subject: true } },
              },
            },
          },
        },
      },
    });

    // 3. Aggregate student counts
    const studentMap = new Map<string, { student: any; active: boolean }>();

    for (const s of directStudents) {
      studentMap.set(s.id, {
        student: s,
        active: s.status === 'ACTIVE',
      });
    }

    for (const b of batches) {
      for (const bs of b.students) {
        if (!studentMap.has(bs.studentId)) {
          studentMap.set(bs.studentId, {
            student: bs.student,
            active: bs.status === 'ACTIVE',
          });
        } else if (bs.status === 'ACTIVE') {
          studentMap.get(bs.studentId)!.active = true;
        }
      }
    }

    const totalStudents = studentMap.size;
    let activeStudents = 0;
    for (const val of studentMap.values()) {
      if (val.active) activeStudents++;
    }

    // 4. Aggregate test attempts and results
    let totalAttemptsCount = 0;
    let totalPercentageSum = 0;
    let totalAccuracySum = 0;
    const completedExamIds = new Set<string>();

    let topStudentCandidate: {
      studentId: string;
      name: string;
      percentage: number;
    } | null = null;
    const subjectStatsMap = new Map<
      string,
      { subjectId: string; name: string; accuracySum: number; count: number }
    >();

    const studentAvgPercentage = new Map<
      string,
      { name: string; sum: number; count: number }
    >();

    for (const [studentId, { student }] of studentMap.entries()) {
      const attempts = student.attempts || [];
      for (const att of attempts) {
        if (att.examId) completedExamIds.add(att.examId);
        if (att.result) {
          totalAttemptsCount++;
          totalPercentageSum += att.result.percentage || 0;
          totalAccuracySum += att.result.accuracy || 0;

          if (!studentAvgPercentage.has(studentId)) {
            studentAvgPercentage.set(studentId, {
              name: student.name,
              sum: att.result.percentage || 0,
              count: 1,
            });
          } else {
            const entry = studentAvgPercentage.get(studentId)!;
            entry.sum += att.result.percentage || 0;
            entry.count++;
          }

          // Subject breakdowns
          for (const sr of att.result.subjectResults || []) {
            if (sr.subject) {
              const sKey = sr.subject.id;
              if (!subjectStatsMap.has(sKey)) {
                subjectStatsMap.set(sKey, {
                  subjectId: sr.subject.id,
                  name: sr.subject.name,
                  accuracySum: sr.accuracy || 0,
                  count: 1,
                });
              } else {
                const sEntry = subjectStatsMap.get(sKey)!;
                sEntry.accuracySum += sr.accuracy || 0;
                sEntry.count++;
              }
            }
          }
        }
      }
    }

    // Calculate Top Student
    let maxAvg = -1;
    for (const [sId, sData] of studentAvgPercentage.entries()) {
      const avg = sData.sum / (sData.count || 1);
      if (avg > maxAvg) {
        maxAvg = avg;
        topStudentCandidate = {
          studentId: sId,
          name: sData.name,
          percentage: Number(avg.toFixed(2)),
        };
      }
    }

    // Calculate Weakest Subject
    let weakestSubject: {
      subjectId: string;
      name: string;
      accuracy: number;
    } | null = null;
    let minAcc = Infinity;
    for (const sStat of subjectStatsMap.values()) {
      const avgAcc = sStat.accuracySum / (sStat.count || 1);
      if (avgAcc < minAcc) {
        minAcc = avgAcc;
        weakestSubject = {
          subjectId: sStat.subjectId,
          name: sStat.name,
          accuracy: Number(avgAcc.toFixed(2)),
        };
      }
    }

    const avgPercentage =
      totalAttemptsCount > 0 ? totalPercentageSum / totalAttemptsCount : 0;
    const avgAccuracy =
      totalAttemptsCount > 0 ? totalAccuracySum / totalAttemptsCount : 0;

    // Dynamic Attendance calculation
    const expectedExamParticipations = activeStudents * completedExamIds.size;
    const attendancePercentage =
      expectedExamParticipations > 0
        ? Math.min(100, (totalAttemptsCount / expectedExamParticipations) * 100)
        : activeStudents > 0 && totalAttemptsCount > 0
          ? 100
          : 0;

    // 5. Batch summaries
    const batchSummaries = batches.map((b) => {
      const bStudents = b.students || [];
      const bActiveCount = bStudents.filter(
        (bs) => bs.status === 'ACTIVE',
      ).length;
      let bAttempts = 0;
      let bPercSum = 0;
      let bAccSum = 0;
      let bTop: { studentId: string; name: string; percentage: number } | null =
        null;
      let bMaxPerc = -1;

      for (const bs of bStudents) {
        const student = bs.student;
        if (student?.attempts) {
          let sPercSum = 0;
          let sCount = 0;
          for (const att of student.attempts) {
            if (att.result) {
              bAttempts++;
              bPercSum += att.result.percentage || 0;
              bAccSum += att.result.accuracy || 0;
              sPercSum += att.result.percentage || 0;
              sCount++;
            }
          }
          if (sCount > 0) {
            const sAvg = sPercSum / sCount;
            if (sAvg > bMaxPerc) {
              bMaxPerc = sAvg;
              bTop = {
                studentId: student.id,
                name: student.name,
                percentage: Number(sAvg.toFixed(2)),
              };
            }
          }
        }
      }

      return {
        batchId: b.id,
        batchName: b.name,
        studentCount: bStudents.length,
        activeStudents: bActiveCount,
        averagePercentage: Number(
          (bAttempts > 0 ? bPercSum / bAttempts : 0).toFixed(2),
        ),
        averageAccuracy: Number(
          (bAttempts > 0 ? bAccSum / bAttempts : 0).toFixed(2),
        ),
        attendancePercentage:
          bAttempts > 0 ? Number(attendancePercentage.toFixed(2)) : 0,
        topStudent: bTop,
      };
    });

    const result: InstitutionDashboardSummary = {
      institution: {
        institutionId: institution.id,
        name: institution.name,
        code: institution.code,
        type: institution.type,
        status: institution.status,
      },
      summary: {
        totalStudents,
        activeStudents,
        testsConducted: completedExamIds.size,
        averagePercentage: Number(avgPercentage.toFixed(2)),
        averageAccuracy: Number(avgAccuracy.toFixed(2)),
        attendancePercentage: Number(attendancePercentage.toFixed(2)),
      },
      topStudent: topStudentCandidate,
      weakestSubject: weakestSubject,
      batches: batchSummaries,
    };

    await this.redis.set(
      cacheKey,
      JSON.stringify(result),
      DASHBOARD_CACHE_TTL_SECONDS,
    );
    return result;
  }

  /**
   * Detailed Batch Analytics
   */
  async getBatchAnalytics(batchId: string): Promise<BatchAnalytics> {
    const batch = await this.prisma.institutionBatch.findUnique({
      where: { id: batchId },
      include: {
        students: {
          include: {
            student: {
              include: {
                attempts: {
                  where: { status: { name: 'COMPLETED' } },
                  include: {
                    exam: true,
                    result: {
                      include: {
                        subjectResults: { include: { subject: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Batch '${batchId}' not found.`);
    }

    const students = batch.students || [];
    const activeCount = students.filter((s) => s.status === 'ACTIVE').length;

    let totalAttempts = 0;
    let percentageSum = 0;
    let accuracySum = 0;
    let highestScore = 0;
    let lowestScore = Infinity;

    const examStatsMap = new Map<
      string,
      { exam: any; percSum: number; accSum: number; count: number }
    >();
    const subjectStatsMap = new Map<
      string,
      {
        subjectId: string;
        name: string;
        accSum: number;
        percSum: number;
        students: Set<string>;
        strongCount: number;
        weakCount: number;
      }
    >();
    let topStudentCandidate: {
      studentId: string;
      name: string;
      percentage: number;
    } | null = null;
    let maxStudentAvg = -1;

    for (const bs of students) {
      const student = bs.student;
      if (!student) continue;

      let sPercSum = 0;
      let sCount = 0;

      for (const att of student.attempts || []) {
        if (!att.result) continue;
        totalAttempts++;
        percentageSum += att.result.percentage || 0;
        accuracySum += att.result.accuracy || 0;
        sPercSum += att.result.percentage || 0;
        sCount++;

        const score = att.result.totalScore || 0;
        if (score > highestScore) highestScore = score;
        if (score < lowestScore) lowestScore = score;

        // Exam Trend tracking
        if (att.exam) {
          const eId = att.exam.id;
          if (!examStatsMap.has(eId)) {
            examStatsMap.set(eId, {
              exam: att.exam,
              percSum: att.result.percentage || 0,
              accSum: att.result.accuracy || 0,
              count: 1,
            });
          } else {
            const eEntry = examStatsMap.get(eId)!;
            eEntry.percSum += att.result.percentage || 0;
            eEntry.accSum += att.result.accuracy || 0;
            eEntry.count++;
          }
        }

        // Subject breakdowns
        for (const sr of att.result.subjectResults || []) {
          if (!sr.subject) continue;
          const sId = sr.subject.id;
          if (!subjectStatsMap.has(sId)) {
            subjectStatsMap.set(sId, {
              subjectId: sId,
              name: sr.subject.name,
              accSum: sr.accuracy || 0,
              percSum: sr.percentage || 0,
              students: new Set([student.id]),
              strongCount: (sr.accuracy || 0) >= 80 ? 1 : 0,
              weakCount: (sr.accuracy || 0) < 50 ? 1 : 0,
            });
          } else {
            const entry = subjectStatsMap.get(sId)!;
            entry.accSum += sr.accuracy || 0;
            entry.percSum += sr.percentage || 0;
            entry.students.add(student.id);
            if ((sr.accuracy || 0) >= 80) entry.strongCount++;
            if ((sr.accuracy || 0) < 50) entry.weakCount++;
          }
        }
      }

      if (sCount > 0) {
        const sAvg = sPercSum / sCount;
        if (sAvg > maxStudentAvg) {
          maxStudentAvg = sAvg;
          topStudentCandidate = {
            studentId: student.id,
            name: student.name,
            percentage: Number(sAvg.toFixed(2)),
          };
        }
      }
    }

    const avgPercentage = totalAttempts > 0 ? percentageSum / totalAttempts : 0;
    const avgAccuracy = totalAttempts > 0 ? accuracySum / totalAttempts : 0;
    const expectedBatchParticipations = activeCount * examStatsMap.size;
    const attendancePercentage =
      expectedBatchParticipations > 0
        ? Math.min(100, (totalAttempts / expectedBatchParticipations) * 100)
        : activeCount > 0 && totalAttempts > 0
          ? 100
          : 0;

    const subjectPerformance: SubjectPerformanceItem[] = Array.from(
      subjectStatsMap.values(),
    ).map((s) => ({
      subjectId: s.subjectId,
      subjectName: s.name,
      averageAccuracy: Number((s.accSum / (s.students.size || 1)).toFixed(2)),
      averagePercentage: Number(
        (s.percSum / (s.students.size || 1)).toFixed(2),
      ),
      studentCount: s.students.size,
      strongStudents: s.strongCount,
      weakStudents: s.weakCount,
    }));

    const recentTrends: TrendPoint[] = Array.from(examStatsMap.values()).map(
      (e) => ({
        examId: e.exam.id,
        examTitle: e.exam.title,
        date: (e.exam.createdAt || new Date()).toISOString().split('T')[0],
        averagePercentage: Number((e.percSum / e.count).toFixed(2)),
        averageAccuracy: Number((e.accSum / e.count).toFixed(2)),
        participantCount: e.count,
      }),
    );

    return {
      batchId: batch.id,
      batchName: batch.name,
      studentCount: students.length,
      activeStudents: activeCount,
      testsConducted: examStatsMap.size,
      averagePercentage: Number(avgPercentage.toFixed(2)),
      averageAccuracy: Number(avgAccuracy.toFixed(2)),
      attendancePercentage: Number(attendancePercentage.toFixed(2)),
      highestScore: highestScore,
      lowestScore: lowestScore === Infinity ? 0 : lowestScore,
      topStudent: topStudentCandidate,
      subjectPerformance,
      recentTrends,
    };
  }

  /**
   * Helper: Build student where filter for institution
   */
  private buildStudentWhereClause(
    institutionId: string,
    filters: {
      search?: string;
      batchId?: string;
      admissionYear?: number;
    },
  ) {
    const where: any = {
      OR: [
        { institutionId },
        { batchMemberships: { some: { batch: { institutionId } } } },
      ],
    };

    if (filters.batchId) {
      where.batchMemberships = {
        some: {
          batchId: filters.batchId,
          batch: { institutionId },
        },
      };
    }

    if (filters.admissionYear) {
      where.admissionYear = filters.admissionYear;
    }

    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim();
      where.AND = [
        {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { studentId: { contains: term, mode: 'insensitive' } },
            { studentCode: { contains: term, mode: 'insensitive' } },
            { user: { mobileNumber: { contains: term } } },
            { user: { phone: { contains: term } } },
            { user: { email: { contains: term, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    return where;
  }

  /**
   * Server-side paginated, searchable, sorted, filterable student directory for institution
   */
  async getStudents(
    institutionId: string,
    query: InstituteStudentQueryDto = {},
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const where = this.buildStudentWhereClause(institutionId, {
      search: query.search,
      batchId: query.batchId,
      admissionYear: query.admissionYear ? Number(query.admissionYear) : undefined,
    });

    // Whitelisted sorting
    const validSortFields = [
      'name',
      'studentId',
      'admissionYear',
      'createdAt',
      'status',
    ];
    const sortBy = validSortFields.includes(query.sortBy || '')
      ? (query.sortBy as string)
      : 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [students, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              mobileNumber: true,
              phone: true,
            },
          },
          studentClass: { select: { id: true, name: true } },
          examTarget: { select: { id: true, name: true } },
          batchMemberships: {
            where: { batch: { institutionId } },
            include: {
              batch: { select: { id: true, name: true, academicYear: true } },
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.student.count({ where }),
    ]);

    const formattedData = students.map((s) => {
      const activeBatch = s.batchMemberships?.[0]?.batch;
      return {
        id: s.id,
        studentId: s.studentId,
        studentCode: s.studentCode || s.studentId,
        name: s.name,
        mobile: s.user?.mobileNumber || s.user?.phone || 'N/A',
        email: s.user?.email || null,
        className: s.studentClass?.name || 'N/A',
        examTargetName: s.examTarget?.name || 'N/A',
        batchId: activeBatch?.id || null,
        batchName: activeBatch?.name || 'Unassigned',
        admissionYear: s.admissionYear || null,
        state: s.state || 'N/A',
        district: s.district || 'N/A',
        status: s.status,
        createdAt: s.createdAt,
      };
    });

    return {
      data: formattedData,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get distinct dynamic admission years for the institution
   */
  async getAdmissionYears(institutionId: string): Promise<number[]> {
    const records = await this.prisma.student.findMany({
      where: {
        OR: [
          { institutionId },
          { batchMemberships: { some: { batch: { institutionId } } } },
        ],
        admissionYear: { not: null },
      },
      select: { admissionYear: true },
      distinct: ['admissionYear'],
      orderBy: { admissionYear: 'desc' },
    });

    return records
      .map((r) => r.admissionYear)
      .filter((y): y is number => typeof y === 'number' && !isNaN(y));
  }

  /**
   * Export institution students to Excel matching active filters
   */
  async exportStudentsExcel(
    institutionId: string,
    query: ExportInstituteStudentsDto = {},
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      select: { name: true, code: true },
    });

    const where = this.buildStudentWhereClause(institutionId, {
      search: query.search,
      batchId: query.batchId,
      admissionYear: query.admissionYear ? Number(query.admissionYear) : undefined,
    });

    const students = await this.prisma.student.findMany({
      where,
      include: {
        user: {
          select: {
            email: true,
            mobileNumber: true,
            phone: true,
          },
        },
        studentClass: { select: { name: true } },
        examTarget: { select: { name: true } },
        batchMemberships: {
          where: { batch: { institutionId } },
          include: {
            batch: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50000,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Brainros Institute Portal';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Students');

    // Title Row
    sheet.mergeCells('A1:K1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `${institution?.name || 'Institution'} — Student Directory`;
    titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 36;

    // Subtitle Row
    sheet.mergeCells('A2:K2');
    const subCell = sheet.getCell('A2');
    subCell.value = `Exported on ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} | Total Records: ${students.length}`;
    subCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF64748B' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(2).height = 20;

    // Blank row
    sheet.addRow([]);

    // Table Headers
    const headers = [
      'Student ID',
      'Student Name',
      'Mobile',
      'Email',
      'Class',
      'Exam Target',
      'Batch',
      'Admission Year',
      'State',
      'District',
      'Status',
    ];

    const headerRow = sheet.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF334155' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });

    // Populate Data Rows
    students.forEach((s, idx) => {
      const activeBatch = s.batchMemberships?.[0]?.batch?.name || 'Unassigned';
      const row = sheet.addRow([
        s.studentCode || s.studentId,
        s.name,
        s.user?.mobileNumber || s.user?.phone || 'N/A',
        s.user?.email || 'N/A',
        s.studentClass?.name || 'N/A',
        s.examTarget?.name || 'N/A',
        activeBatch,
        s.admissionYear || 'N/A',
        s.state || 'N/A',
        s.district || 'N/A',
        s.status,
      ]);

      row.height = 22;
      const isEven = idx % 2 === 0;

      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: [1, 3, 5, 6, 7, 8, 11].includes(colNum) ? 'center' : 'left',
        };
        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    });

    // Adjust column widths automatically
    sheet.columns.forEach((col, idx) => {
      let maxLen = headers[idx] ? headers[idx].length : 12;
      col?.eachCell?.({ includeEmpty: false }, (cell) => {
        const strVal = cell.value ? String(cell.value) : '';
        if (strVal.length > maxLen && strVal.length < 50) {
          maxLen = strVal.length;
        }
      });
      col.width = Math.max(maxLen + 4, 14);
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const safeName = (institution?.name || 'Institute').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `${safeName}_Students_${dateStr}.xlsx`;

    return { buffer, fileName };
  }

  /**
   * Get exams attempted by institution students (for rank list exam selector)
   */
  async getExamsWithResults(institutionId: string) {
    const exams = await this.prisma.exam.findMany({
      where: {
        attempts: {
          some: {
            status: { name: 'COMPLETED' },
            student: {
              OR: [
                { institutionId },
                { batchMemberships: { some: { batch: { institutionId } } } },
              ],
            },
          },
        },
      },
      select: {
        id: true,
        title: true,
        examTarget: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return exams.map((e) => ({
      id: e.id,
      title: e.title,
      targetName: e.examTarget?.name || 'General',
      createdAt: e.createdAt,
    }));
  }

  /**
   * Get institute-scoped Rank List for selected exam
   */
  async getRankings(
    institutionId: string,
    query: InstituteRankQueryDto = {},
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    // If no examId passed, find the most recent exam for this institution
    let selectedExamId = query.examId;
    if (!selectedExamId) {
      const latestAttempt = await this.prisma.attempt.findFirst({
        where: {
          status: { name: 'COMPLETED' },
          result: { isNot: null },
          student: {
            OR: [
              { institutionId },
              { batchMemberships: { some: { batch: { institutionId } } } },
            ],
          },
        },
        orderBy: { submittedAt: 'desc' },
        select: { examId: true },
      });
      selectedExamId = latestAttempt?.examId;
    }

    if (!selectedExamId) {
      return {
        data: [],
        exam: null,
        meta: { total: 0, page: 1, limit, totalPages: 1 },
      };
    }

    const exam = await this.prisma.exam.findUnique({
      where: { id: selectedExamId },
      select: { id: true, title: true, totalMarks: true },
    });

    const studentCondition: any = {
      OR: [
        { institutionId },
        { batchMemberships: { some: { batch: { institutionId } } } },
      ],
    };

    if (query.batchId) {
      studentCondition.batchMemberships = {
        some: { batchId: query.batchId, batch: { institutionId } },
      };
    }

    // Query persisted CandidateRank first if available
    const candidateRanksCount = await this.prisma.candidateRank.count({
      where: {
        attempt: { examId: selectedExamId },
        student: studentCondition,
      },
    });

    if (candidateRanksCount > 0) {
      const [ranks, total] = await Promise.all([
        this.prisma.candidateRank.findMany({
          where: {
            attempt: { examId: selectedExamId },
            student: studentCondition,
          },
          include: {
            student: {
              include: {
                batchMemberships: {
                  where: { batch: { institutionId } },
                  include: { batch: { select: { name: true } } },
                },
              },
            },
            attempt: {
              include: {
                result: { select: { percentage: true, totalScore: true, accuracy: true } },
              },
            },
          },
          orderBy: { rank: 'asc' },
          skip,
          take: limit,
        }),
        this.prisma.candidateRank.count({
          where: {
            attempt: { examId: selectedExamId },
            student: studentCondition,
          },
        }),
      ]);

      const formatted = ranks.map((r, idx) => ({
        rank: r.rank || skip + idx + 1,
        studentName: r.student.name,
        studentId: r.student.studentCode || r.student.studentId,
        score: r.score || r.attempt.result?.totalScore || 0,
        percentage: Number(
          (r.attempt.result?.percentage ?? r.percentile ?? 0).toFixed(2),
        ),
        accuracy: Number((r.accuracy ?? r.attempt.result?.accuracy ?? 0).toFixed(2)),
        batchName: r.student.batchMemberships?.[0]?.batch?.name || 'Unassigned',
      }));

      return {
        data: formatted,
        exam,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }

    // Fallback directly to persisted Results ordered by totalScore desc
    const [results, total] = await Promise.all([
      this.prisma.result.findMany({
        where: {
          attempt: {
            examId: selectedExamId,
            status: { name: 'COMPLETED' },
            student: studentCondition,
          },
        },
        include: {
          attempt: {
            include: {
              student: {
                include: {
                  batchMemberships: {
                    where: { batch: { institutionId } },
                    include: { batch: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ totalScore: 'desc' }, { percentage: 'desc' }, { accuracy: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.result.count({
        where: {
          attempt: {
            examId: selectedExamId,
            status: { name: 'COMPLETED' },
            student: studentCondition,
          },
        },
      }),
    ]);

    const formatted = results.map((res, idx) => ({
      rank: skip + idx + 1,
      studentName: res.attempt.student.name,
      studentId: res.attempt.student.studentCode || res.attempt.student.studentId,
      score: res.totalScore,
      percentage: Number((res.percentage || 0).toFixed(2)),
      accuracy: Number((res.accuracy || 0).toFixed(2)),
      batchName: res.attempt.student.batchMemberships?.[0]?.batch?.name || 'Unassigned',
    }));

    return {
      data: formatted,
      exam,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
