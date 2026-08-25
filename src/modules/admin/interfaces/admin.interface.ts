// ═══════════════════════════════════════════════════════════════════
// Admin & Super Admin Control Center — Interfaces
// ═══════════════════════════════════════════════════════════════════

export interface AdminDashboardOverview {
  users: {
    total: number;
    students: number;
    parents: number;
    admins: number;
    institutionAdmins: number;
    active: number;
    newThisMonth: number;
  };
  questions: {
    total: number;
    draft: number;
    submitted: number;
    underReview: number;
    approved: number;
    rejected: number;
    archived: number;
    translationCoveragePercentage: number;
  };
  translations: {
    supportedLanguagesCount: number;
    totalTranslatedQuestions: number;
    languages: Array<{
      code: string;
      name: string;
      translatedCount: number;
      completionRate: number;
    }>;
  };
  exams: {
    total: number;
    draft: number;
    submitted: number;
    approved: number;
    scheduled: number;
    active: number;
    ended: number;
    completed: number;
    cancelled: number;
  };
  attempts: {
    total: number;
    inProgress: number;
    submitted: number;
    autoSubmitted: number;
    completed: number;
  };
  evaluation: {
    totalEvaluated: number;
    averageScore: number;
    averagePercentage: number;
    averageAccuracy: number;
  };
  institutions: {
    total: number;
    active: number;
    pendingApproval: number;
    suspended: number;
    totalBatches: number;
    totalStudentsManaged: number;
  };
  sales: {
    available: boolean;
    totalRevenue?: number;
    revenueThisMonth?: number;
    activeSubscriptions?: number;
    newInstitutionsThisMonth?: number;
    message?: string;
  };
  notifications: {
    queued: number;
    sentToday: number;
    failedToday: number;
  };
  reports: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
  };
  approvals: {
    pendingTotal: number;
    byEntityType: Record<string, number>;
  };
  timestamp: string;
}

export interface ApprovalRequestItem {
  id: string;
  resourceType: string;
  resourceId: string;
  requestedById: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewedById?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  reviewComment?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogItem {
  id: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, any> | null;
  afterState?: Record<string, any> | null;
  reason?: string | null;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  createdAt: string;
}
