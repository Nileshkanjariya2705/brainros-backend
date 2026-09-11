/**
 * Centralized Redis Key Builder for Exam Runtime Caching
 *
 * Keys policy:
 * - Questions snapshot: exam:{examId}:version:{examVersionId}:questions
 *   Stores the complete immutable question-paper snapshot JSON string.
 *   TTL: officialExamEndTime - now + safetyBuffer
 *
 * - Status: exam:{examId}:version:{examVersionId}:status
 *   Stores cache state string (e.g., 'PREPARING', 'CACHE_READY').
 *   TTL: Synchronized with questions snapshot TTL.
 *
 * - Meta: exam:{examId}:version:{examVersionId}:meta
 *   Stores preparation metadata JSON (questionCount, preparedAt, verifiedAt, etc.).
 *   TTL: Synchronized with questions snapshot TTL.
 *
 * - Lock: exam:{examId}:version:{examVersionId}:lock
 *   Distributed mutex preventing concurrent duplicate preparation workers.
 *   TTL: 60 seconds.
 */
export class ExamRedisKeys {
  /**
   * Complete immutable question paper snapshot
   */
  static questions(examId: string, examVersionId: string): string {
    return `exam:${examId}:version:${examVersionId}:questions`;
  }

  /**
   * Cache preparation readiness status ('PREPARING' | 'CACHE_READY')
   */
  static status(examId: string, examVersionId: string): string {
    return `exam:${examId}:version:${examVersionId}:status`;
  }

  /**
   * Cache preparation metadata (stats, timings, question count)
   */
  static meta(examId: string, examVersionId: string): string {
    return `exam:${examId}:version:${examVersionId}:meta`;
  }

  /**
   * Distributed lock key during preparation
   */
  static lock(examId: string, examVersionId: string): string {
    return `exam:${examId}:version:${examVersionId}:lock`;
  }
}
