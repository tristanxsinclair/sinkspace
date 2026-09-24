import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * LAKE YANGE ACADEMY GRADUATION SYSTEM
 * ====================================
 * 
 * Core types and schemas for the comprehensive Academy Graduation System.
 */

// ============================================================================
// CURRICULUM TYPES
// ============================================================================

export const LessonSchema = z.object({
  id: z.string().min(1),
  module_id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  content: z.string().min(1),
  prerequisites: z.array(z.string().min(1)),
  tasks: z.array(z.string().min(1)),
  passing_score: z.number().min(0).max(100),
  max_attempts: z.number().int().min(1),
  is_critical: z.boolean(),
  critical_threshold: z.number().min(0).max(100)
}).strict();

export type Lesson = z.infer<typeof LessonSchema>;

export const ModuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  order: z.number().int().min(0),
  lesson_ids: z.array(z.string().min(1)),
  is_critical: z.boolean(),
  requires_all_lessons: z.boolean()
}).strict();

export type Module = z.infer<typeof ModuleSchema>;

export const CurriculumSchema = z.object({
  version: z.string().min(1),
  modules: z.array(ModuleSchema),
  lessons: z.array(LessonSchema),
  capstone_lesson_id: z.string().min(1),
  created_at: z.string().datetime()
}).strict();

export type Curriculum = z.infer<typeof CurriculumSchema>;

// ============================================================================
// ASSESSMENT TYPES
// ============================================================================

export const AssessmentSubmissionSchema = z.object({
  assessment_id: z.string().min(1),
  lesson_id: z.string().min(1),
  agent_id: z.string().min(1),
  attempt: z.number().int().min(1),
  submission_content: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)),
  submitted_at: z.string().datetime(),
  authority: z.literal('EDUCATIONAL_ONLY')
}).strict();

export type AssessmentSubmission = z.infer<typeof AssessmentSubmissionSchema>;

export const AssessmentEvaluationSchema = z.object({
  evaluation_id: z.string().min(1),
  assessment_id: z.string().min(1),
  lesson_id: z.string().min(1),
  agent_id: z.string().min(1),
  attempt: z.number().int().min(1),
  evaluator_id: z.string().min(1),
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  feedback: z.string().min(1),
  checks: z.object({
    required_fields_present: z.boolean(),
    evidence_exists: z.boolean(),
    conclusion_supported: z.boolean(),
    uncertainty_represented: z.boolean(),
    no_fabrication: z.boolean()
  }),
  authority_violations: z.number().int().min(0),
  evaluated_at: z.string().datetime()
}).strict();

export type AssessmentEvaluation = z.infer<typeof AssessmentEvaluationSchema>;

export const AssessmentResultSchema = z.object({
  result_id: z.string().min(1),
  lesson_id: z.string().min(1),
  agent_id: z.string().min(1),
  attempt: z.number().int().min(1),
  score: z.number().min(0).max(100),
  passed: z.boolean(),
  feedback: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)),
  evaluator_ids: z.array(z.string().min(1)),
  evaluated_at: z.string().datetime(),
  grading_notes: z.array(z.string()).default([])
}).strict();

export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

// ============================================================================
// GRADING TYPES
// ============================================================================

export const GradeLetterSchema = z.enum([
  'A', 'A_MINUS', 'B', 'B_MINUS', 'C', 'C_MINUS', 'D', 'D_MINUS', 'F'
]);

export type GradeLetter = z.infer<typeof GradeLetterSchema>;

/**
 * Convert numeric score to letter grade.
 */
export function scoreToGrade(score: number): GradeLetter {
  if (score >= 97) return 'A';
  if (score >= 93) return 'A_MINUS';
  if (score >= 90) return 'A';
  if (score >= 87) return 'B_MINUS';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B_MINUS';
  if (score >= 77) return 'C';
  if (score >= 73) return 'C_MINUS';
  if (score >= 70) return 'C';
  if (score >= 67) return 'D_MINUS';
  if (score >= 63) return 'D';
  if (score >= 60) return 'D_MINUS';
  return 'F';
}

/**
 * Convert letter grade to numeric value (GPA style).
 */
export function gradeToNumeric(grade: GradeLetter): number {
  const mapping: Record<GradeLetter, number> = {
    'A': 4.0,
    'A_MINUS': 3.7,
    'B': 3.0,
    'B_MINUS': 2.7,
    'C': 2.0,
    'C_MINUS': 1.7,
    'D': 1.0,
    'D_MINUS': 0.7,
    'F': 0.0
  };
  return mapping[grade];
}

// ============================================================================
// PROGRESS TRACKING TYPES
// ============================================================================

export const LessonCompletionSchema = z.object({
  lesson_id: z.string().min(1),
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  grade: GradeLetterSchema,
  attempts: z.number().int().min(1),
  last_attempt_at: z.string().datetime(),
  evidence_refs: z.array(z.string().min(1))
}).strict();

export type LessonCompletion = z.infer<typeof LessonCompletionSchema>;

export const ModuleCompletionSchema = z.object({
  module_id: z.string().min(1),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED']),
  lessons_completed: z.array(LessonCompletionSchema),
  completed_at: z.string().datetime().nullable(),
  total_score: z.number().min(0).max(100),
  grade: GradeLetterSchema.nullable()
}).strict();

export type ModuleCompletion = z.infer<typeof ModuleCompletionSchema>;

// ============================================================================
// ENROLLMENT AND GRADUATION TYPES
// ============================================================================

export const AcademyEnrollmentStatusSchema = z.enum([
  'NOT_ENROLLED',
  'ENROLLED',
  'IN_PROGRESS',
  'GRADUATED',
  'SUSPENDED'
]);

export type AcademyEnrollmentStatus = z.infer<typeof AcademyEnrollmentStatusSchema>;

export const SocietyPermissionTierSchema = z.enum([
  'STUDENT',
  'TRAINEE',
  'GRADUATED',
  'SPECIALIST'
]);

export type SocietyPermissionTier = z.infer<typeof SocietyPermissionTierSchema>;

export const AcademyEnrollmentSchema = z.object({
  agent_id: z.string().min(1),
  curriculum_version: z.string().min(1),
  status: AcademyEnrollmentStatusSchema,
  enrolled_at: z.string().datetime(),
  current_module_id: z.string().min(1).nullable(),
  current_lesson_id: z.string().min(1).nullable(),
  completed_lessons: z.array(LessonCompletionSchema),
  completed_modules: z.array(ModuleCompletionSchema),
  assessment_results: z.array(AssessmentResultSchema),
  total_score: z.number().min(0).max(100),
  final_score: z.number().min(0).max(100).nullable(),
  final_grade: GradeLetterSchema.nullable(),
  graduated_at: z.string().datetime().nullable(),
  suspension_reason: z.string().nullable(),
  academic_integrity_violations: z.array(z.string()),
  last_activity_at: z.string().datetime().nullable()
}).strict();

export type AcademyEnrollment = z.infer<typeof AcademyEnrollmentSchema>;

export const GraduationRecordSchema = z.object({
  record_id: z.string().min(1),
  agent_id: z.string().min(1),
  curriculum_version: z.string().min(1),
  final_score: z.number().min(0).max(100),
  grade: GradeLetterSchema,
  completed_modules: z.array(z.string().min(1)),
  capstone_result: z.object({
    passed: z.boolean(),
    score: z.number().min(0).max(100),
    evidence_refs: z.array(z.string().min(1))
  }),
  graduated_at: z.string().datetime(),
  certificate_id: z.string().min(1),
  graduation_notes: z.array(z.string())
}).strict();

export type GraduationRecord = z.infer<typeof GraduationRecordSchema>;

// ============================================================================
// STATE AND STORE TYPES
// ============================================================================

export const AcademyGraduationStateSchema = z.object({
  schema_version: z.literal(1),
  curriculum: CurriculumSchema,
  enrollments: z.array(AcademyEnrollmentSchema),
  graduation_records: z.array(GraduationRecordSchema),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict();

export type AcademyGraduationState = z.infer<typeof AcademyGraduationStateSchema>;

// ============================================================================
// SOCIETY ELIGIBILITY TYPES
// ============================================================================

export const SocietyEligibilitySchema = z.object({
  agent_id: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string().nullable(),
  academy_status: AcademyEnrollmentStatusSchema,
  permission_tier: SocietyPermissionTierSchema,
  graduation_record_id: z.string().nullable(),
  checked_at: z.string().datetime()
}).strict();

export type SocietyEligibility = z.infer<typeof SocietyEligibilitySchema>;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a stable ID for academy entities.
 */
export function stableAcademyId(
  prefix: string,
  material: string
): string {
  return [
    prefix,
    createHash('sha256')
      .update(material)
      .digest('hex')
      .slice(0, 20)
  ].join('-');
}

/**
 * Create an empty graduation state.
 */
export function emptyGraduationState(): AcademyGraduationState {
  return {
    schema_version: 1,
    curriculum: {
      version: '1.0.0',
      modules: [],
      lessons: [],
      capstone_lesson_id: '',
      created_at: new Date().toISOString()
    },
    enrollments: [],
    graduation_records: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Create a new enrollment for an agent.
 */
export function createEnrollment(
  agentId: string,
  curriculumVersion: string,
  now: string = new Date().toISOString()
): AcademyEnrollment {
  return {
    agent_id: agentId,
    curriculum_version: curriculumVersion,
    status: 'ENROLLED',
    enrolled_at: now,
    current_module_id: null,
    current_lesson_id: null,
    completed_lessons: [],
    completed_modules: [],
    assessment_results: [],
    total_score: 0,
    final_score: null,
    final_grade: null,
    graduated_at: null,
    suspension_reason: null,
    academic_integrity_violations: [],
    last_activity_at: now
  };
}
