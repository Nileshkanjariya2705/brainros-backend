import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { NotificationPreferenceService } from '../services/notification-preference.service';
import { UpdateNotificationPreferenceDto } from '../dto/notification.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('users/me/notification-preferences')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly preferenceService: NotificationPreferenceService) {}

  @Get()
  async getMyPreferences(@CurrentUser() user: any) {
    return this.preferenceService.getUserPreferences(user.userId);
  }

  @Patch()
  async updateMyPreference(
    @CurrentUser() user: any,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.preferenceService.updatePreference(user.userId, dto);
  }
}
