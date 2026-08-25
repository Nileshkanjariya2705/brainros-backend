import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { QuestionTimingService } from '../services/question-timing.service';
import {
  StartQuestionTimingDto,
  EndQuestionTimingDto,
  TimeSyncDto,
} from '../dto/time-tracking.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('attempts/:attemptId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionTimingController {
  constructor(private readonly timingService: QuestionTimingService) {}

  /**
   * Start question timing interval (server-authoritative).
   * Automatically closes any previous active question.
   */
  @Post('questions/:questionId/time/start')
  startQuestionTiming(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body() dto: StartQuestionTimingDto,
    @CurrentUser() user: any,
  ) {
    return this.timingService.startQuestionTiming(
      attemptId,
      { ...dto, examQuestionId: questionId },
      user.userId,
    );
  }

  /**
   * End question timing interval (explicit close).
   */
  @Post('questions/:questionId/time/end')
  endQuestionTiming(
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body() dto: EndQuestionTimingDto,
    @CurrentUser() user: any,
  ) {
    return this.timingService.endQuestionTiming(
      attemptId,
      { ...dto, examQuestionId: questionId },
      user.userId,
    );
  }

  /**
   * Get active timing state and authoritative server time sync.
   */
  @Get('time/active')
  getActiveTiming(
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: any,
    @Query() dto?: TimeSyncDto,
  ) {
    return this.timingService.getActiveTimingSync(attemptId, user.userId, dto);
  }
}
