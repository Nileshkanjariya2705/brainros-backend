export interface IApprovalHandler {
  /**
   * Supported entity type (e.g. 'QUESTION', 'EXAM', 'INSTITUTION', 'BULK_UPLOAD', 'QUESTION_TRANSLATION')
   */
  readonly entityType: string;

  /**
   * Validate that the target entity exists and is in a reviewable state before submission
   */
  validateEntity(entityId: string, tx?: any): Promise<any>;

  /**
   * Apply domain-specific state transition on approval
   */
  onApprove(
    request: any,
    reviewerId: string,
    comment?: string,
    tx?: any,
  ): Promise<{
    beforeState: Record<string, any>;
    afterState: Record<string, any>;
  }>;

  /**
   * Apply domain-specific state transition on rejection
   */
  onReject(
    request: any,
    reviewerId: string,
    reason: string,
    tx?: any,
  ): Promise<{
    beforeState: Record<string, any>;
    afterState: Record<string, any>;
  }>;

  /**
   * Apply domain-specific state transition on cancellation
   */
  onCancel?(
    request: any,
    actorId: string,
    tx?: any,
  ): Promise<{
    beforeState: Record<string, any>;
    afterState: Record<string, any>;
  }>;
}
