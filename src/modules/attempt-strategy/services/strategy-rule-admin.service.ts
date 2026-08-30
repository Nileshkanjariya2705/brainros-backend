import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateStrategyRuleDto,
  UpdateStrategyRuleDto,
  QueryStrategyRulesDto,
} from '../dto/strategy-rule.dto';

@Injectable()
export class StrategyRuleAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createRule(dto: CreateStrategyRuleDto) {
    const existing = await this.prisma.strategyRule.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Strategy rule with code '${dto.code}' already exists`,
      );
    }

    return this.prisma.strategyRule.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        metric: dto.metric,
        operator: dto.operator,
        threshold: dto.threshold,
        comparisonValue: dto.comparisonValue,
        severity: dto.severity || 'MEDIUM',
        priority: dto.priority || 1,
        recommendationTemplate: dto.recommendationTemplate,
        titleTemplate: dto.titleTemplate || 'Strategy Recommendation',
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        examTargetId: dto.examTargetId,
        examId: dto.examId,
      },
    });
  }

  async listRules(query?: QueryStrategyRulesDto) {
    const where: any = {};
    if (query?.category) where.category = query.category;
    if (query?.isActive !== undefined) where.isActive = query.isActive;
    if (query?.examTargetId) where.examTargetId = query.examTargetId;

    return this.prisma.strategyRule.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getRuleById(id: string) {
    const rule = await this.prisma.strategyRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException(`Strategy rule '${id}' not found`);
    return rule;
  }

  async updateRule(id: string, dto: UpdateStrategyRuleDto) {
    await this.getRuleById(id);

    return this.prisma.strategyRule.update({
      where: { id },
      data: {
        ...dto,
        configVersion: { increment: 1 },
      },
    });
  }

  async deleteRule(id: string) {
    await this.getRuleById(id);
    return this.prisma.strategyRule.delete({ where: { id } });
  }
}
