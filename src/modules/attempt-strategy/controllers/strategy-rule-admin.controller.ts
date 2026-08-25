import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StrategyRuleAdminService } from '../services/strategy-rule-admin.service';
import {
  CreateStrategyRuleDto,
  UpdateStrategyRuleDto,
  QueryStrategyRulesDto,
} from '../dto/strategy-rule.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@Controller('analysis/strategy-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class StrategyRuleAdminController {
  constructor(private readonly adminService: StrategyRuleAdminService) {}

  @Post()
  createRule(@Body() dto: CreateStrategyRuleDto) {
    return this.adminService.createRule(dto);
  }

  @Get()
  listRules(@Query() query: QueryStrategyRulesDto) {
    return this.adminService.listRules(query);
  }

  @Get(':id')
  getRuleById(@Param('id') id: string) {
    return this.adminService.getRuleById(id);
  }

  @Patch(':id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateStrategyRuleDto) {
    return this.adminService.updateRule(id, dto);
  }

  @Delete(':id')
  deleteRule(@Param('id') id: string) {
    return this.adminService.deleteRule(id);
  }
}
