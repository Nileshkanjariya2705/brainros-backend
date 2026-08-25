import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { IApprovalHandler } from '../interfaces/approval-handler.interface';
import { QuestionApprovalHandler } from './question-approval.handler';
import { ExamApprovalHandler } from './exam-approval.handler';
import { InstitutionApprovalHandler } from './institution-approval.handler';
import { BulkUploadApprovalHandler } from './bulk-upload-approval.handler';

@Injectable()
export class ApprovalHandlerRegistry implements OnModuleInit {
  private handlers = new Map<string, IApprovalHandler>();

  constructor(
    private readonly questionHandler: QuestionApprovalHandler,
    private readonly examHandler: ExamApprovalHandler,
    private readonly institutionHandler: InstitutionApprovalHandler,
    private readonly bulkUploadHandler: BulkUploadApprovalHandler,
  ) {}

  onModuleInit() {
    this.registerHandler(this.questionHandler);
    this.registerHandler(this.examHandler);
    this.registerHandler(this.institutionHandler);
    this.registerHandler(this.bulkUploadHandler);
  }

  registerHandler(handler: IApprovalHandler) {
    this.handlers.set(handler.entityType.toUpperCase(), handler);
  }

  getHandler(entityType: string): IApprovalHandler {
    const handler = this.handlers.get(entityType.toUpperCase());
    if (!handler) {
      const supported = Array.from(this.handlers.keys()).join(', ');
      throw new BadRequestException(
        `Unsupported entity type '${entityType}' for approval workflow. Supported: [${supported}]`,
      );
    }
    return handler;
  }

  getSupportedEntityTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
