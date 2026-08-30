import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { NotificationService } from '../services/notification.service';
import { NotificationPreferenceService } from '../services/notification-preference.service';
import { UpdateNotificationPreferenceDto } from '../dto/notification.dto';
import { NotificationQueryDto } from '../dto/student-notification.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  /**
   * GET /notifications
   * Fetch paginated in-app notifications for the authenticated user
   */
  @Get()
  async getMyNotifications(
    @CurrentUser() user: any,
    @Query() query: NotificationQueryDto,
  ) {
    const userId = user.userId || user.id || user.sub;
    return this.notificationService.getUserNotifications(userId, query);
  }

  /**
   * GET /notifications/unread-count
   * Fast dynamic counter for notification bell/badge
   */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: any) {
    const userId = user.userId || user.id || user.sub;
    return this.notificationService.getUnreadCount(userId);
  }

  /**
   * PATCH /notifications/read-all
   * Mark all unread notifications as read for current user
   */
  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: any) {
    const userId = user.userId || user.id || user.sub;
    return this.notificationService.markAllAsRead(userId);
  }

  /**
   * PATCH /notifications/:id/read
   * Mark a single notification as read (idempotent, ownership enforced)
   */
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @CurrentUser() user: any) {
    const userId = user.userId || user.id || user.sub;
    return this.notificationService.markAsRead(id, userId);
  }

  /**
   * DELETE /notifications/:id
   * Delete a notification (ownership enforced)
   */
  @Delete(':id')
  async deleteNotification(@Param('id') id: string, @CurrentUser() user: any) {
    const userId = user.userId || user.id || user.sub;
    return this.notificationService.deleteNotification(id, userId);
  }

  /**
   * GET /notifications/preferences (Backward compatible)
   */
  @Get('preferences')
  async getMyPreferences(@CurrentUser() user: any) {
    const userId = user.userId || user.id || user.sub;
    return this.preferenceService.getUserPreferences(userId);
  }

  /**
   * PATCH /notifications/preferences (Backward compatible)
   */
  @Patch('preferences')
  async updateMyPreference(
    @CurrentUser() user: any,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    const userId = user.userId || user.id || user.sub;
    return this.preferenceService.updatePreference(userId, dto);
  }
}

