import {
  PrismaClient,
  Role,
  Permission,
  StudentClass,
  PreferredLanguage,
  ExamTarget,
  DifficultyLevel,
  QuestionType,
  ExamStatus,
  AttemptStatus,
  State,
  District,
  User,
  Student,
  Institution,
  InstitutionBatch,
  Subject,
  Chapter,
  Topic,
  SubTopic,
  Question,
  QuestionOption,
  Exam,
  ExamSection,
  ExamQuestion,
  ExamVersion,
  ExamVersionQuestion,
  ExamSchedule,
  Attempt,
  Result,
} from '@prisma/client';

export interface SeedContext {
  prisma: PrismaClient;
  // Master Lookups
  roles: Map<string, Role>;
  permissions: Map<string, Permission>;
  classes: Map<string, StudentClass>;
  languages: Map<string, PreferredLanguage>;
  examTargets: Map<string, ExamTarget>;
  difficulties: Map<string, DifficultyLevel>;
  questionTypes: Map<string, QuestionType>;
  examStatuses: Map<string, ExamStatus>;
  attemptStatuses: Map<string, AttemptStatus>;
  states: Map<string, State>;
  districts: Map<string, District>; // key: `${stateCode}:${districtName}`

  // Users & Profiles
  users: Map<string, User>; // key: email
  students: Map<string, Student>; // key: email or studentId
  institutions: Map<string, Institution>; // key: code
  batches: Map<string, InstitutionBatch>; // key: `${institutionCode}:${batchName}`

  // Academic
  subjects: Map<string, Subject>; // key: `${targetName}:${subjectName}`
  chapters: Map<string, Chapter>; // key: `${subjectName}:${chapterName}`
  topics: Map<string, Topic>; // key: `${chapterName}:${topicName}`
  subTopics: Map<string, SubTopic>; // key: `${topicName}:${subTopicName}`
  questions: Map<string, Question>; // key: questionCode
  questionOptions: Map<string, QuestionOption[]>; // key: questionId

  // Exams
  exams: Map<string, Exam>; // key: examCode
  examSections: Map<string, ExamSection[]>; // key: examId
  examQuestions: Map<string, ExamQuestion[]>; // key: examId
  examVersions: Map<string, ExamVersion>; // key: `${examCode}:${version}`
  examSchedules: Map<string, ExamSchedule>; // key: scheduleKey

  // Attempts & Results
  attempts: Map<string, Attempt>; // key: `${studentEmail}:${examCode}`
  results: Map<string, Result>; // key: attemptId
}

export interface SeederResult {
  seederName: string;
  createdCounts: Record<string, number>;
  reusedCounts: Record<string, number>;
  timeMs: number;
}
