import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ExamSecurityProfileService } from '../services/exam-security-profile.service';
import { ExamSessionService } from '../services/exam-session.service';
import { SecurityEventService } from '../services/security-event.service';
import { RiskEngineService } from '../services/risk-engine.service';
import {
  IngestSecurityEventsDto,
  HeartbeatDto,
  AcceptSecurityPolicyDto,
  CreateSessionDto,
} from '../dto/security.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class ExamSecurityController {
  constructor(
    private readonly securityProfileService: ExamSecurityProfileService,
    private readonly examSessionService: ExamSessionService,
    private readonly securityEventService: SecurityEventService,
    private readonly riskEngineService: RiskEngineService,
  ) {}

  @Get('exams/:examId/security-preflight')
  getSecurityPreflight(@Param('examId') examId: string) {
    return this.securityProfileService.getPreflightInfo(examId);
  }

  @Post('attempts/:attemptId/accept-policy')
  acceptSecurityPolicy(
    @Param('attemptId') attemptId: string,
    @Body() dto: AcceptSecurityPolicyDto,
    @Req() req: any,
  ) {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.securityProfileService.acceptSecurityPolicy(
      attemptId,
      dto.securityProfileId,
      dto.policyVersion || 1,
      ipAddress,
      userAgent,
    );
  }

  @Post('attempts/:attemptId/session')
  createOrResumeSession(
    @Param('attemptId') attemptId: string,
    @Body() body: CreateSessionDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const userId = user.userId || user.id || user.sub;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.examSessionService.createOrResumeSession(
      attemptId,
      userId,
      body?.deviceMetadata,
      ipAddress,
      userAgent,
      body?.transferSession,
      body?.sessionId,
    );
  }

  @Post('attempts/:attemptId/heartbeat')
  recordHeartbeat(
    @Param('attemptId') attemptId: string,
    @Body() dto: HeartbeatDto,
    @CurrentUser() user: any,
  ) {
    const userId = user.userId || user.id || user.sub;
    return this.examSessionService.recordHeartbeat(attemptId, dto, userId);
  }

  @Post('attempts/:attemptId/security-events')
  ingestSecurityEvents(
    @Param('attemptId') attemptId: string,
    @Body() dto: IngestSecurityEventsDto,
    @CurrentUser() user: any,
  ) {
    const userId = user.userId || user.id || user.sub;
    return this.securityEventService.ingestEvents(attemptId, dto, userId);
  }

  @Get('attempts/:attemptId/security-status')
  getSecurityStatus(
    @Param('attemptId') attemptId: string,
  ) {
    return this.riskEngineService.evaluateAttemptSecurity(attemptId);
  }

  @Get('attempts/:attemptId/security-events')
  getAttemptEvents(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
  ) {
    const userId = user.userId || user.id || user.sub;
    return this.securityEventService.getAttemptEvents(attemptId, userId, false);
  }
}
