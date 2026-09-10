import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AdminStaffService } from '../services/admin-staff.service';
import {
  CreateStaffDto,
  UpdateStaffDto,
  UpdateStaffStatusDto,
  StaffFilterDto,
} from '../dto/staff.dto';

@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminStaffController {
  constructor(private readonly staffService: AdminStaffService) {}

  /**
   * POST /admin/staff
   * Create a new staff account (OPERATOR, MANAGER, GENERAL_MANAGER, ACCOUNTANT)
   */
  @Post()
  async createStaff(
    @CurrentUser('userId') currentUserId: string,
    @Body() dto: CreateStaffDto,
  ) {
    const data = await this.staffService.createStaff(dto, currentUserId);
    return {
      statusCode: 201,
      message: 'Staff account created successfully.',
      data,
    };
  }

  /**
   * GET /admin/staff
   * List staff members with pagination, search, and filtering
   */
  @Get()
  async listStaff(@Query() filter: StaffFilterDto) {
    const data = await this.staffService.listStaff(filter);
    return {
      statusCode: 200,
      message: 'Staff members retrieved successfully.',
      ...data,
    };
  }

  /**
   * GET /admin/staff/:id
   * Get staff profile details by ID
   */
  @Get(':id')
  async getStaffById(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.staffService.getStaffById(id);
    return {
      statusCode: 200,
      message: 'Staff details retrieved successfully.',
      data,
    };
  }

  /**
   * PATCH /admin/staff/:id
   * Update staff profile details
   */
  @Patch(':id')
  async updateStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') currentUserId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    const data = await this.staffService.updateStaff(id, dto, currentUserId);
    return {
      statusCode: 200,
      message: 'Staff details updated successfully.',
      data,
    };
  }

  /**
   * PATCH /admin/staff/:id/status
   * Activate or Deactivate staff account
   */
  @Patch(':id/status')
  async updateStaffStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') currentUserId: string,
    @Body() dto: UpdateStaffStatusDto,
  ) {
    const data = await this.staffService.updateStaffStatus(id, dto, currentUserId);
    return {
      statusCode: 200,
      message: data.message,
      data,
    };
  }
}
