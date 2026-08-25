// ═══════════════════════════════════════════════════════════════════
// Institution / B2B Module — Interfaces
// ═══════════════════════════════════════════════════════════════════

export interface InstitutionDashboardSummary {
  institution: {
    institutionId: string;
    name: string;
    code: string;
    type: string;
    status: string;
  };
  summary: {
    totalStudents: number;
    activeStudents: number;
    testsConducted: number;
    averagePercentage: number;
    averageAccuracy: number;
    attendancePercentage: number;
  };
  topStudent: {
    studentId: string;
    name: string;
    percentage: number;
  } | null;
  weakestSubject: {
    subjectId: string;
    name: string;
    accuracy: number;
  } | null;
  batches: BatchSummary[];
}

export interface BatchSummary {
  batchId: string;
  batchName: string;
  studentCount: number;
  activeStudents: number;
  averagePercentage: number;
  averageAccuracy: number;
  attendancePercentage: number;
  topStudent: {
    studentId: string;
    name: string;
    percentage: number;
  } | null;
}

export interface BatchAnalytics {
  batchId: string;
  batchName: string;
  studentCount: number;
  activeStudents: number;
  testsConducted: number;
  averagePercentage: number;
  averageAccuracy: number;
  attendancePercentage: number;
  highestScore: number;
  lowestScore: number;
  topStudent: {
    studentId: string;
    name: string;
    percentage: number;
  } | null;
  subjectPerformance: SubjectPerformanceItem[];
  recentTrends: TrendPoint[];
}

export interface SubjectPerformanceItem {
  subjectId: string;
  subjectName: string;
  averageAccuracy: number;
  averagePercentage: number;
  studentCount: number;
  strongStudents: number;
  weakStudents: number;
}

export interface TrendPoint {
  examId: string;
  examTitle: string;
  date: string;
  averagePercentage: number;
  averageAccuracy: number;
  participantCount: number;
}

export interface BulkUploadPreview {
  uploadId: string;
  fileName: string;
  status: string;
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    existingStudents: number;
    newStudents: number;
  };
  sampleErrors: BulkUploadErrorItem[];
}

export interface BulkUploadErrorItem {
  rowNumber: number;
  field: string;
  errorCode: string;
  message: string;
}

export interface StudentReportRow {
  studentId: string;
  name: string;
  batchName: string;
  testsAttempted: number;
  averageScore: number;
  averagePercentage: number;
  accuracy: number;
  latestRank: number | null;
  percentile: number | null;
  attendancePercentage: number;
  weakestSubject: string | null;
}
