import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSubjectDto,
  UpdateSubjectDto,
  CreateChapterDto,
  UpdateChapterDto,
  CreateTopicDto,
  UpdateTopicDto,
  CreateSubTopicDto,
  UpdateSubTopicDto,
} from './dto/academic.dto';

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════
  // SUBJECTS
  // ═══════════════════════════════════════════════════════════════

  async createSubject(dto: CreateSubjectDto) {
    return this.prisma.subject.create({
      data: dto,
      include: { examTarget: { select: { id: true, name: true } } },
    });
  }

  async findAllSubjects(examTargetId?: string) {
    return this.prisma.subject.findMany({
      where: examTargetId ? { examTargetId } : undefined,
      include: {
        examTarget: { select: { id: true, name: true } },
        _count: { select: { chapters: true, questions: true } },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findSubjectById(id: string) {
    const subject = await this.prisma.subject.findUnique({
      where: { id },
      include: {
        examTarget: { select: { id: true, name: true } },
        chapters: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: { _count: { select: { topics: true, questions: true } } },
        },
        _count: { select: { questions: true } },
      },
    });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  async updateSubject(id: string, dto: UpdateSubjectDto) {
    await this.findSubjectById(id);
    return this.prisma.subject.update({
      where: { id },
      data: dto,
      include: { examTarget: { select: { id: true, name: true } } },
    });
  }

  async deleteSubject(id: string) {
    await this.findSubjectById(id);
    await this.prisma.subject.delete({ where: { id } });
    return { message: 'Subject deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════
  // CHAPTERS
  // ═══════════════════════════════════════════════════════════════

  async createChapter(dto: CreateChapterDto) {
    return this.prisma.chapter.create({
      data: dto,
      include: { subject: { select: { id: true, name: true } } },
    });
  }

  async findChaptersBySubject(subjectId: string) {
    return this.prisma.chapter.findMany({
      where: { subjectId },
      include: {
        subject: { select: { id: true, name: true } },
        _count: { select: { topics: true, questions: true } },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findChapterById(id: string) {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id },
      include: {
        subject: { select: { id: true, name: true } },
        topics: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: { _count: { select: { subTopics: true, questions: true } } },
        },
        _count: { select: { questions: true } },
      },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    return chapter;
  }

  async updateChapter(id: string, dto: UpdateChapterDto) {
    await this.findChapterById(id);
    return this.prisma.chapter.update({
      where: { id },
      data: dto,
      include: { subject: { select: { id: true, name: true } } },
    });
  }

  async deleteChapter(id: string) {
    await this.findChapterById(id);
    await this.prisma.chapter.delete({ where: { id } });
    return { message: 'Chapter deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════
  // TOPICS
  // ═══════════════════════════════════════════════════════════════

  async createTopic(dto: CreateTopicDto) {
    return this.prisma.topic.create({
      data: dto,
      include: { chapter: { select: { id: true, name: true } } },
    });
  }

  async findTopicsByChapter(chapterId: string) {
    return this.prisma.topic.findMany({
      where: { chapterId },
      include: {
        chapter: { select: { id: true, name: true } },
        _count: { select: { subTopics: true, questions: true } },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findTopicById(id: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: {
        chapter: { select: { id: true, name: true } },
        subTopics: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
        },
        _count: { select: { questions: true } },
      },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }

  async updateTopic(id: string, dto: UpdateTopicDto) {
    await this.findTopicById(id);
    return this.prisma.topic.update({
      where: { id },
      data: dto,
      include: { chapter: { select: { id: true, name: true } } },
    });
  }

  async deleteTopic(id: string) {
    await this.findTopicById(id);
    await this.prisma.topic.delete({ where: { id } });
    return { message: 'Topic deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════
  // SUB-TOPICS
  // ═══════════════════════════════════════════════════════════════

  async createSubTopic(dto: CreateSubTopicDto) {
    return this.prisma.subTopic.create({
      data: dto,
      include: { topic: { select: { id: true, name: true } } },
    });
  }

  async findSubTopicsByTopic(topicId: string) {
    return this.prisma.subTopic.findMany({
      where: { topicId },
      include: {
        topic: { select: { id: true, name: true } },
        _count: { select: { questions: true } },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findSubTopicById(id: string) {
    const subTopic = await this.prisma.subTopic.findUnique({
      where: { id },
      include: {
        topic: { select: { id: true, name: true } },
        _count: { select: { questions: true } },
      },
    });
    if (!subTopic) throw new NotFoundException('Sub-topic not found');
    return subTopic;
  }

  async updateSubTopic(id: string, dto: UpdateSubTopicDto) {
    await this.findSubTopicById(id);
    return this.prisma.subTopic.update({
      where: { id },
      data: dto,
      include: { topic: { select: { id: true, name: true } } },
    });
  }

  async deleteSubTopic(id: string) {
    await this.findSubTopicById(id);
    await this.prisma.subTopic.delete({ where: { id } });
    return { message: 'Sub-topic deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════
  // LOOKUP DATA
  // ═══════════════════════════════════════════════════════════════

  async getDifficultyLevels() {
    return this.prisma.difficultyLevel.findMany({
      orderBy: { displayOrder: 'asc' },
    });
  }

  async getQuestionTypes() {
    return this.prisma.questionType.findMany({ orderBy: { name: 'asc' } });
  }

  async getExamStatuses() {
    return this.prisma.examStatus.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Returns the entire academic hierarchy for a given exam target as a tree
   */
  async getHierarchy(examTargetId: string) {
    const subjects = await this.prisma.subject.findMany({
      where: { examTargetId, isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        chapters: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: {
            topics: {
              where: { isActive: true },
              orderBy: { displayOrder: 'asc' },
              include: {
                subTopics: {
                  where: { isActive: true },
                  orderBy: { displayOrder: 'asc' },
                },
              },
            },
          },
        },
      },
    });
    return subjects;
  }
}
