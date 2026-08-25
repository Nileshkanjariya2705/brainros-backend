import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBlueprintDto,
  UpdateBlueprintDto,
  CreateBlueprintRuleDto,
  UpdateBlueprintRuleDto,
} from '../dto/blueprint.dto';

@Injectable()
export class BlueprintService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a blueprint with optional initial rules
   */
  async createBlueprint(examId: string, dto: CreateBlueprintDto, createdById: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
    });
    if (!exam) {
      throw new NotFoundException(`Exam with ID '${examId}' not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const blueprint = await tx.examBlueprint.create({
        data: {
          examId,
          name: dto.name.trim(),
          totalQuestions: dto.totalQuestions,
          createdById,
        },
      });

      if (dto.rules && dto.rules.length > 0) {
        for (const rule of dto.rules) {
          await tx.blueprintRule.create({
            data: {
              blueprintId: blueprint.id,
              subjectId: rule.subjectId || null,
              chapterId: rule.chapterId || null,
              topicId: rule.topicId || null,
              subTopicId: rule.subTopicId || null,
              difficultyLevel: rule.difficultyLevel || null,
              type: rule.type || null,
              selectionCount: rule.selectionCount || null,
              selectionPercentage: rule.selectionPercentage || null,
              priority: rule.priority ?? 0,
            },
          });
        }
      }

      return tx.examBlueprint.findUnique({
        where: { id: blueprint.id },
        include: {
          rules: {
            include: {
              subject: { select: { id: true, name: true } },
              chapter: { select: { id: true, name: true } },
              topic: { select: { id: true, name: true } },
            },
          },
          createdBy: { select: { id: true, email: true } },
        },
      });
    });
  }

  /**
   * Get all blueprints for an exam
   */
  async getExamBlueprints(examId: string) {
    return this.prisma.examBlueprint.findMany({
      where: { examId },
      orderBy: { createdAt: 'desc' },
      include: {
        rules: {
          include: {
            subject: { select: { id: true, name: true } },
            chapter: { select: { id: true, name: true } },
            topic: { select: { id: true, name: true } },
          },
        },
        _count: { select: { generatedVersions: true } },
      },
    });
  }

  /**
   * Get blueprint by ID
   */
  async getBlueprintById(id: string) {
    const blueprint = await this.prisma.examBlueprint.findUnique({
      where: { id },
      include: {
        rules: {
          include: {
            subject: { select: { id: true, name: true } },
            chapter: { select: { id: true, name: true } },
            topic: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, email: true } },
        _count: { select: { generatedVersions: true } },
      },
    });

    if (!blueprint) {
      throw new NotFoundException(`Blueprint with ID '${id}' not found`);
    }
    return blueprint;
  }

  /**
   * Update blueprint metadata
   */
  async updateBlueprint(id: string, dto: UpdateBlueprintDto) {
    await this.getBlueprintById(id);

    return this.prisma.examBlueprint.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        totalQuestions: dto.totalQuestions !== undefined ? dto.totalQuestions : undefined,
      },
      include: { rules: true },
    });
  }

  /**
   * Delete blueprint (only if no versions were generated from it)
   */
  async deleteBlueprint(id: string) {
    const blueprint = await this.getBlueprintById(id);

    if (blueprint._count.generatedVersions > 0) {
      throw new BadRequestException(
        'Cannot delete blueprint that has generated exam versions. Deactivate it instead.',
      );
    }

    await this.prisma.examBlueprint.delete({ where: { id } });
    return { message: 'Blueprint deleted successfully' };
  }

  /**
   * Add a rule to a blueprint
   */
  async addRule(blueprintId: string, dto: CreateBlueprintRuleDto) {
    await this.getBlueprintById(blueprintId);

    return this.prisma.blueprintRule.create({
      data: {
        blueprintId,
        subjectId: dto.subjectId || null,
        chapterId: dto.chapterId || null,
        topicId: dto.topicId || null,
        subTopicId: dto.subTopicId || null,
        difficultyLevel: dto.difficultyLevel || null,
        type: dto.type || null,
        selectionCount: dto.selectionCount || null,
        selectionPercentage: dto.selectionPercentage || null,
        priority: dto.priority ?? 0,
      },
      include: {
        subject: { select: { id: true, name: true } },
        chapter: { select: { id: true, name: true } },
        topic: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Update a blueprint rule
   */
  async updateRule(ruleId: string, dto: UpdateBlueprintRuleDto) {
    const rule = await this.prisma.blueprintRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) {
      throw new NotFoundException(`Blueprint rule with ID '${ruleId}' not found`);
    }

    return this.prisma.blueprintRule.update({
      where: { id: ruleId },
      data: {
        subjectId: dto.subjectId !== undefined ? dto.subjectId : undefined,
        chapterId: dto.chapterId !== undefined ? dto.chapterId : undefined,
        topicId: dto.topicId !== undefined ? dto.topicId : undefined,
        subTopicId: dto.subTopicId !== undefined ? dto.subTopicId : undefined,
        difficultyLevel: dto.difficultyLevel !== undefined ? dto.difficultyLevel : undefined,
        type: dto.type !== undefined ? dto.type : undefined,
        selectionCount: dto.selectionCount !== undefined ? dto.selectionCount : undefined,
        selectionPercentage:
          dto.selectionPercentage !== undefined ? dto.selectionPercentage : undefined,
        priority: dto.priority !== undefined ? dto.priority : undefined,
      },
    });
  }

  /**
   * Delete a blueprint rule
   */
  async deleteRule(ruleId: string) {
    const rule = await this.prisma.blueprintRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) {
      throw new NotFoundException(`Blueprint rule with ID '${ruleId}' not found`);
    }

    await this.prisma.blueprintRule.delete({ where: { id: ruleId } });
    return { message: 'Rule deleted successfully' };
  }
}
