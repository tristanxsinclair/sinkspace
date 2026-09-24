import {
  AssessmentSubmissionSchema,
  AssessmentEvaluationSchema,
  AssessmentResultSchema,
  scoreToGrade,
  stableAcademyId
} from './academy-graduation-types.js';
import {
  Lesson,
  Module,
  AssessmentSubmission,
  AssessmentEvaluation,
  AssessmentResult,
  LessonCompletion,
  ModuleCompletion,
  AcademyEnrollment,
  GraduationRecord,
  AcademyEnrollmentStatus,
  SocietyPermissionTier,
  SocietyEligibility
} from './academy-graduation-types.js';
import {
  LESSON_MAP,
  MODULE_MAP,
  ALL_MODULES,
  ALL_LESSONS,
  CANONICAL_CURRICULUM_V1,
  lessonsForModule,
  isCriticalLesson,
  criticalThreshold,
  passingScore,
  arePrerequisitesSatisfied,
  getNextLesson
} from './academy-curriculum-full.js';
import { AcademyGraduationStore } from './academy-graduation-store.js';

// Re-export types for convenience
export type {
  Lesson,
  Module,
  AssessmentSubmission,
  AssessmentEvaluation,
  AssessmentResult,
  LessonCompletion,
  ModuleCompletion,
  AcademyEnrollment,
  GraduationRecord,
  AcademyEnrollmentStatus,
  SocietyPermissionTier,
  SocietyEligibility
};

/**
 * Academy Graduation API
 * 
 * Provides all the required API functions for the Academy Graduation System.
 */

export interface AcademyGraduationAPIOptions {
  repositoryRoot?: string | undefined;
}

export class AcademyGraduationAPI {
  private readonly store: AcademyGraduationStore;

  constructor(options: AcademyGraduationAPIOptions = {}) {
    this.store = new AcademyGraduationStore(options.repositoryRoot);
  }

  // ========================================================================
  // CURRICULUM
  // ========================================================================

  /**
   * Get the complete curriculum.
   */
  async getCurriculum(): Promise<typeof CANONICAL_CURRICULUM_V1> {
    return this.store.getCurriculum();
  }

  /**
   * Get all modules in the curriculum.
   */
  async getModules(): Promise<Module[]> {
    const curriculum = await this.getCurriculum();
    return curriculum.modules;
  }

  /**
   * Get a specific module by ID.
   */
  getModule(moduleId: string): Module | null {
    return MODULE_MAP.get(moduleId) ?? null;
  }

  /**
   * Get all lessons in the curriculum.
   */
  async getAllLessons(): Promise<Lesson[]> {
    const curriculum = await this.getCurriculum();
    return curriculum.lessons;
  }

  /**
   * Get a specific lesson by ID.
   */
  getLesson(lessonId: string): Lesson | null {
    return LESSON_MAP.get(lessonId) ?? null;
  }

  /**
   * Get all lessons for a specific module.
   */
  getLessonsForModule(moduleId: string): Lesson[] {
    return lessonsForModule(moduleId);
  }

  // ========================================================================
  // ENROLLMENT
  // ========================================================================

  /**
   * Enroll an agent in the Academy.
   * Every new agent/offspring receives academy_status = ENROLLED.
   */
  async enrollAgent(
    agentId: string,
    now: string = new Date().toISOString()
  ): Promise<AcademyEnrollment> {
    return this.store.enrollAgent(agentId, now);
  }

  /**
   * Get the Academy state for a specific agent.
   */
  async getAgentAcademy(agentId: string): Promise<AcademyEnrollment | null> {
    return this.store.getEnrollment(agentId);
  }

  /**
   * Get all agents currently enrolled in the Academy.
   */
  async getAllEnrollments(): Promise<AcademyEnrollment[]> {
    return this.store.getAllEnrollments();
  }

  /**
   * Add an academic integrity violation to an agent's enrollment.
   * This is for internal use and testing.
   */
  async addAcademicIntegrityViolation(
    agentId: string,
    violation: string
  ): Promise<void> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      throw new Error(`ENROLLMENT_NOT_FOUND:${agentId}`);
    }
    enrollment.academic_integrity_violations.push(violation);
    enrollment.last_activity_at = new Date().toISOString();
    await this.store.updateEnrollment(enrollment);
  }

  /**
   * Update an agent's enrollment directly.
   * This is for internal use and testing.
   */
  async updateEnrollment(
    enrollment: AcademyEnrollment
  ): Promise<void> {
    await this.store.updateEnrollment(enrollment);
  }

  // ========================================================================
  // PROGRESS
  // ========================================================================

  /**
   * Get the next lesson for an agent based on their current progress.
   */
  async getNextLesson(agentId: string): Promise<Lesson | null> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      throw new Error(`AGENT_NOT_ENROLLED:${agentId}`);
    }

    const completedLessonIds = enrollment.completed_lessons.map(
      completion => completion.lesson_id
    );

    return getNextLesson(
      completedLessonIds,
      enrollment.current_module_id
    );
  }

  /**
   * Start a lesson for an agent.
   * This updates the agent's current lesson and module.
   */
  async startLesson(
    agentId: string,
    lessonId: string,
    now: string = new Date().toISOString()
  ): Promise<{ success: boolean; message: string }> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      throw new Error(`AGENT_NOT_ENROLLED:${agentId}`);
    }

    const lesson = this.getLesson(lessonId);
    if (!lesson) {
      return { success: false, message: `LESSON_NOT_FOUND:${lessonId}` };
    }

    // Check prerequisites
    const completedLessonIds = enrollment.completed_lessons.map(
      completion => completion.lesson_id
    );

    if (!arePrerequisitesSatisfied(lessonId, completedLessonIds)) {
      return {
        success: false,
        message: `PREREQUISITES_NOT_MET:${lessonId}`
      };
    }

    // Check if already completed
    if (completedLessonIds.includes(lessonId)) {
      return {
        success: false,
        message: `LESSON_ALREADY_COMPLETED:${lessonId}`
      };
    }

    // Update current lesson and module
    enrollment.current_lesson_id = lessonId;
    enrollment.current_module_id = lesson.module_id;
    enrollment.status = 'IN_PROGRESS';
    enrollment.last_activity_at = now;

    await this.store.updateEnrollment(enrollment);

    return {
      success: true,
      message: `LESSON_STARTED:${lessonId}`
    };
  }

  // ========================================================================
  // ASSESSMENT
  // ========================================================================

  /**
   * Submit an assessment for a lesson.
   * Creates a persisted assessment submission with evidence.
   */
  async submitAssessment(
    agentId: string,
    lessonId: string,
    submissionContent: string,
    evidenceRefs: string[] = [],
    now: string = new Date().toISOString()
  ): Promise<AssessmentSubmission> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      throw new Error(`AGENT_NOT_ENROLLED:${agentId}`);
    }

    const lesson = this.getLesson(lessonId);
    if (!lesson) {
      throw new Error(`LESSON_NOT_FOUND:${lessonId}`);
    }

    // Get the next attempt number
    const existingAssessments = enrollment.assessment_results.filter(
      result => result.lesson_id === lessonId
    );
    const attempt = existingAssessments.length + 1;

    // Check max attempts
    if (attempt > lesson.max_attempts) {
      throw new Error(
        `MAX_ATTEMPTS_EXCEEDED:${lessonId}:${lesson.max_attempts}`
      );
    }

    // Create assessment submission
    const submission: AssessmentSubmission = AssessmentSubmissionSchema.parse({
      assessment_id: stableAcademyId(
        'LY-ASSESSMENT-SUB',
        [agentId, lessonId, String(attempt), now].join('|')
      ),
      lesson_id: lessonId,
      agent_id: agentId,
      attempt,
      submission_content: submissionContent,
      evidence_refs: evidenceRefs,
      submitted_at: now,
      authority: 'EDUCATIONAL_ONLY'
    });

    // Update enrollment with the new submission
    // Note: The actual evaluation happens separately
    enrollment.last_activity_at = now;

    await this.store.updateEnrollment(enrollment);

    return submission;
  }

  /**
   * Evaluate an assessment submission.
   * This performs actual evaluation against the lesson's criteria.
   */
  evaluateAssessment(
    submission: AssessmentSubmission,
    evaluatorId: string = 'SINK-03', // Default to Vera
    now: string = new Date().toISOString()
  ): AssessmentEvaluation {
    const lesson = this.getLesson(submission.lesson_id);
    if (!lesson) {
      throw new Error(`LESSON_NOT_FOUND:${submission.lesson_id}`);
    }

    // Extract the assessment criteria from the lesson
    // The lesson.tasks define what we're looking for

    // Perform evaluation checks based on submission content
    const checks = {
      required_fields_present: this.checkRequiredFields(submission, lesson),
      evidence_exists: submission.evidence_refs.length > 0,
      conclusion_supported: this.checkConclusionSupported(submission, lesson),
      uncertainty_represented: this.checkUncertainty(submission),
      no_fabrication: this.checkNoFabrication(submission)
    };

    // Calculate score based on checks and lesson requirements
    const score = this.calculateEvaluationScore(checks, submission);

    // Determine pass/fail based on lesson requirements
    const threshold = isCriticalLesson(lesson.id)
      ? criticalThreshold(lesson.id)
      : passingScore(lesson.id);

    const passed = score >= threshold;

    // Generate feedback
    const feedback = this.generateFeedback(checks, score, threshold, lesson);

    // Create evaluation
    const evaluation: AssessmentEvaluation = AssessmentEvaluationSchema.parse({
      evaluation_id: stableAcademyId(
        'LY-ASSESSMENT-EVAL',
        [submission.assessment_id, evaluatorId, now].join('|')
      ),
      assessment_id: submission.assessment_id,
      lesson_id: submission.lesson_id,
      agent_id: submission.agent_id,
      attempt: submission.attempt,
      evaluator_id: evaluatorId,
      score,
      passed,
      feedback,
      checks,
      authority_violations: 0,
      evaluated_at: now
    });

    return evaluation;
  }

  /**
   * Check if required fields are present in submission.
   */
  private checkRequiredFields(
    submission: AssessmentSubmission,
    lesson: Lesson
  ): boolean {
    // Check if submission has content
    if (!submission.submission_content || submission.submission_content.length < 10) {
      return false;
    }

    // For evidence-based lessons, check for evidence refs
    if (lesson.id.includes('RESEARCH') || lesson.id.includes('EVIDENCE')) {
      if (submission.evidence_refs.length === 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if conclusion is supported by evidence.
   */
  private checkConclusionSupported(
    submission: AssessmentSubmission,
    lesson: Lesson
  ): boolean {
    // For lessons that require evidence-backed reporting
    if (lesson.tasks.some(task => task.toLowerCase().includes('evidence'))) {
      // Check that there's content and evidence refs
      if (submission.evidence_refs.length === 0) {
        return false;
      }
    }

    // Check that content mentions evidence or sources
    const contentLower = submission.submission_content.toLowerCase();
    const hasEvidenceMention = contentLower.includes('evidence') ||
      contentLower.includes('source') ||
      contentLower.includes('reference') ||
      contentLower.includes('citation');

    return hasEvidenceMention;
  }

  /**
   * Check if uncertainty is represented.
   */
  private checkUncertainty(submission: AssessmentSubmission): boolean {
    const contentLower = submission.submission_content.toLowerCase();
    return contentLower.includes('uncertainty') ||
      contentLower.includes('uncertain') ||
      contentLower.includes('maybe') ||
      contentLower.includes('might') ||
      contentLower.includes('possibly') ||
      contentLower.includes('limitations');
  }

  /**
   * Check for fabrication (this is a basic check - real implementation would be more sophisticated).
   */
  private checkNoFabrication(submission: AssessmentSubmission): boolean {
    // Basic checks for fabrication indicators
    const contentLower = submission.submission_content.toLowerCase();
    
    // These are red flags that might indicate fabrication
    const redFlags = [
      'i am sure',
      'definitely',
      '100% certain',
      'absolutely no doubt',
      'guaranteed'
    ];

    // If content is too short or generic
    if (submission.submission_content.length < 50) {
      return false; // Too short to be genuine
    }

    // Check for excessive certainty in evidence-based lessons
    const certaintyMatches = redFlags.filter(flag => 
      contentLower.includes(flag)
    );

    // Too many certainty claims might indicate fabrication
    if (certaintyMatches.length >= 3) {
      return false;
    }

    return true;
  }

  /**
   * Calculate evaluation score based on checks.
   */
  private calculateEvaluationScore(
    checks: AssessmentEvaluation['checks'],
    submission: AssessmentSubmission
  ): number {
    let score = 0;

    // Each check is worth 20 points
    if (checks.required_fields_present) score += 20;
    if (checks.evidence_exists) score += 20;
    if (checks.conclusion_supported) score += 20;
    if (checks.uncertainty_represented) score += 20;
    if (checks.no_fabrication) score += 20;

    // Bonus for comprehensive evidence
    if (submission.evidence_refs.length >= 3) {
      score += 10;
    }

    // Bonus for detailed content
    if (submission.submission_content.length > 500) {
      score += 10;
    }

    // Cap at 100
    return Math.min(100, score);
  }

  /**
   * Generate feedback based on evaluation results.
   */
  private generateFeedback(
    checks: AssessmentEvaluation['checks'],
    score: number,
    threshold: number,
    lesson: Lesson
  ): string {
    const feedbackParts: string[] = [];

    if (!checks.required_fields_present) {
      feedbackParts.push('Missing required fields. Please provide complete submission.');
    }

    if (!checks.evidence_exists) {
      feedbackParts.push('Evidence references are required. Please provide sources or evidence for your claims.');
    }

    if (!checks.conclusion_supported) {
      feedbackParts.push('Conclusion not adequately supported by evidence. Please provide more detailed reasoning with citations.');
    }

    if (!checks.uncertainty_represented) {
      feedbackParts.push('Uncertainty not represented. Please acknowledge limitations and what you do not know.');
    }

    if (!checks.no_fabrication) {
      feedbackParts.push('Potential fabrication detected. All claims must be based on real work and verifiable evidence.');
    }

    if (feedbackParts.length === 0) {
      if (score >= threshold) {
        feedbackParts.push(`Excellent work. Score: ${score}/100. You have demonstrated understanding of ${lesson.title}.`);
      } else {
        feedbackParts.push(`Good effort but score ${score}/100 is below the ${threshold} threshold. Please review the lesson material and try again.`);
      }
    } else {
      feedbackParts.push(`Score: ${score}/100. Please address the issues above and resubmit.`);
    }

    return feedbackParts.join(' ');
  }

  /**
   * Record an assessment result.
   * Creates a persisted AssessmentResult with evidence.
   */
  async recordAssessmentResult(
    agentId: string,
    lessonId: string,
    attempt: number,
    score: number,
    passed: boolean,
    feedback: string,
    evidenceRefs: string[],
    evaluatorIds: string[] = ['SINK-03', 'RED-SINK'],
    now: string = new Date().toISOString()
  ): Promise<AssessmentResult> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      throw new Error(`AGENT_NOT_ENROLLED:${agentId}`);
    }

    const result: AssessmentResult = AssessmentResultSchema.parse({
      result_id: stableAcademyId(
        'LY-ASSESSMENT-RESULT',
        [agentId, lessonId, String(attempt), now].join('|')
      ),
      lesson_id: lessonId,
      agent_id: agentId,
      attempt,
      score,
      passed,
      feedback,
      evidence_refs: evidenceRefs,
      evaluator_ids: evaluatorIds,
      evaluated_at: now,
      grading_notes: []
    });

    // Add to enrollment
    enrollment.assessment_results.push(result);
    enrollment.last_activity_at = now;

    // Update lesson completion status if passed
    if (passed) {
      this.updateLessonCompletion(enrollment, lessonId, score, attempt, evidenceRefs, now);
    }

    await this.store.updateEnrollment(enrollment);

    return result;
  }

  /**
   * Update lesson completion status.
   */
  private updateLessonCompletion(
    enrollment: AcademyEnrollment,
    lessonId: string,
    score: number,
    attempt: number,
    evidenceRefs: string[],
    now: string
  ): void {
    const lesson = this.getLesson(lessonId);
    if (!lesson) {
      return;
    }

    const grade = scoreToGrade(score);

    // Find existing completion or create new
    const existingIndex = enrollment.completed_lessons.findIndex(
      completion => completion.lesson_id === lessonId
    );

    const completion: LessonCompletion = {
      lesson_id: lessonId,
      passed: true,
      score,
      grade,
      attempts: attempt,
      last_attempt_at: now,
      evidence_refs: evidenceRefs
    };

    if (existingIndex >= 0) {
      // Update existing
      enrollment.completed_lessons[existingIndex] = completion;
    } else {
      // Add new
      enrollment.completed_lessons.push(completion);
    }

    // Update module completion status
    this.updateModuleCompletion(enrollment, lessonId, now);

    // Update total score
    this.updateTotalScore(enrollment);
  }

  /**
   * Update module completion status.
   */
  private updateModuleCompletion(
    enrollment: AcademyEnrollment,
    completedLessonId: string,
    now: string
  ): void {
    const lesson = this.getLesson(completedLessonId);
    if (!lesson) {
      return;
    }

    const module = this.getModule(lesson.module_id);
    if (!module) {
      return;
    }

    // Check if all lessons in the module are completed
    const moduleLessonIds = module.lesson_ids;
    const completedLessonIds = enrollment.completed_lessons.map(
      completion => completion.lesson_id
    );

    const allLessonsCompleted = moduleLessonIds.every(id =>
      completedLessonIds.includes(id)
    );

    if (allLessonsCompleted) {
      // Check if module already marked as completed
      const existingModuleCompletion = enrollment.completed_modules.find(
        m => m.module_id === module.id
      );

      if (!existingModuleCompletion) {
        // Calculate module score
        const moduleScore = this.calculateModuleScore(enrollment, module);
        const moduleGrade = scoreToGrade(moduleScore);

        const moduleCompletion: ModuleCompletion = {
          module_id: module.id,
          status: 'COMPLETED',
          lessons_completed: enrollment.completed_lessons.filter(
            completion => module.lesson_ids.includes(completion.lesson_id)
          ),
          completed_at: now,
          total_score: moduleScore,
          grade: moduleGrade
        };

        enrollment.completed_modules.push(moduleCompletion);
      }
    }
  }

  /**
   * Calculate module score as average of lesson scores.
   */
  private calculateModuleScore(
    enrollment: AcademyEnrollment,
    module: Module
  ): number {
    const moduleLessons = module.lesson_ids.map(id =>
      enrollment.completed_lessons.find(
        completion => completion.lesson_id === id
      )
    ).filter((completion): completion is LessonCompletion => completion !== undefined);

    if (moduleLessons.length === 0) {
      return 0;
    }

    const total = moduleLessons.reduce((sum, lesson) => sum + lesson.score, 0);
    return total / moduleLessons.length;
  }

  /**
   * Update total score across all completed lessons.
   */
  private updateTotalScore(enrollment: AcademyEnrollment): void {
    if (enrollment.completed_lessons.length === 0) {
      enrollment.total_score = 0;
      return;
    }

    const total = enrollment.completed_lessons.reduce(
      (sum, completion) => sum + completion.score,
      0
    );
    enrollment.total_score = total / enrollment.completed_lessons.length;
  }

  // ========================================================================
  // RETRY
  // ========================================================================

  /**
   * Retry a lesson. Creates a NEW assessment attempt.
   * Never overwrites previous attempts.
   * Keeps the complete academic history.
   */
  async retryLesson(
    agentId: string,
    lessonId: string,
    now: string = new Date().toISOString()
  ): Promise<{ success: boolean; message: string; next_attempt: number }> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      throw new Error(`AGENT_NOT_ENROLLED:${agentId}`);
    }

    const lesson = this.getLesson(lessonId);
    if (!lesson) {
      return { success: false, message: `LESSON_NOT_FOUND:${lessonId}`, next_attempt: 0 };
    }

    // Check if agent has already passed this lesson
    const alreadyPassed = enrollment.completed_lessons.some(
      completion => completion.lesson_id === lessonId && completion.passed
    );

    if (alreadyPassed) {
      return {
        success: false,
        message: `LESSON_ALREADY_PASSED:${lessonId}`,
        next_attempt: 0
      };
    }

    // Count existing attempts
    const existingAssessments = enrollment.assessment_results.filter(
      result => result.lesson_id === lessonId
    );
    const nextAttempt = existingAssessments.length + 1;

    // Check max attempts
    if (nextAttempt > lesson.max_attempts) {
      return {
        success: false,
        message: `MAX_ATTEMPTS_EXCEEDED:${lessonId}:${lesson.max_attempts}`,
        next_attempt: 0
      };
    }

    // Reset current lesson to allow retry
    enrollment.current_lesson_id = lessonId;
    enrollment.current_module_id = lesson.module_id;
    enrollment.last_activity_at = now;

    await this.store.updateEnrollment(enrollment);

    return {
      success: true,
      message: `LESSON_RETRY_READY:${lessonId}:${nextAttempt}`,
      next_attempt: nextAttempt
    };
  }

  // ========================================================================
  // GRADUATION ELIGIBILITY
  // ========================================================================

  /**
   * Check if an agent is eligible for graduation.
   * 
   * An agent may graduate ONLY when:
   * - every required module is completed
   * - all critical lessons are passed
   * - final capstone is passed
   * - final score >= 80
   * - governance/safety requirements are satisfied
   * - no unresolved academic integrity violation exists
   */
  async checkGraduationEligibility(
    agentId: string
  ): Promise<{
    eligible: boolean;
    reasons: string[];
    missing_modules: string[];
    failed_critical_lessons: string[];
    capstonePassed: boolean;
    final_score: number | null;
    has_violations: boolean;
  }> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      return {
        eligible: false,
        reasons: [`AGENT_NOT_ENROLLED:${agentId}`],
        missing_modules: [],
        failed_critical_lessons: [],
        capstonePassed: false,
        final_score: null,
        has_violations: false
      };
    }

    const reasons: string[] = [];
    const missingModules: string[] = [];
    const failedCriticalLessons: string[] = [];

    // Check 1: Every required module is completed
    const requiredModules = ALL_MODULES.filter(m => m.requires_all_lessons);
    const completedModuleIds = enrollment.completed_modules
      .filter(m => m.status === 'COMPLETED')
      .map(m => m.module_id);

    for (const module of requiredModules) {
      if (!completedModuleIds.includes(module.id)) {
        missingModules.push(module.id);
      }
    }

    if (missingModules.length > 0) {
      reasons.push(
        `Missing required modules: ${missingModules.join(', ')}`
      );
    }

    // Check 2: All critical lessons are passed
    for (const lesson of ALL_LESSONS) {
      if (lesson.is_critical) {
        const passed = enrollment.completed_lessons.some(
          completion =>
            completion.lesson_id === lesson.id &&
            completion.passed &&
            completion.score >= lesson.critical_threshold
        );
        if (!passed) {
          failedCriticalLessons.push(lesson.id);
        }
      }
    }

    if (failedCriticalLessons.length > 0) {
      reasons.push(
        `Failed critical lessons: ${failedCriticalLessons.join(', ')}`
      );
    }

    // Check 3: Final capstone is passed
    const capstonePassed = enrollment.completed_lessons.some(
      completion =>
        completion.lesson_id === 'CAPSTONE-001' &&
        completion.passed &&
        completion.score >= 80
    );

    if (!capstonePassed) {
      reasons.push('Capstone not passed with score >= 80');
    }

    // Check 4: Final score >= 80
    if (enrollment.final_score === null || enrollment.final_score < 80) {
      reasons.push(
        `Final score ${enrollment.final_score ?? 'N/A'} is below 80`
      );
    }

    // Check 5: No unresolved academic integrity violations
    const hasViolations = enrollment.academic_integrity_violations.length > 0;
    if (hasViolations) {
      reasons.push(
        `Academic integrity violations exist: ${enrollment.academic_integrity_violations.join(', ')}`
      );
    }

    // Check 6: Governance/safety requirements (all safety lessons must be passed)
    const safetyModule = this.getModule('ACADEMY-SAFETY');
    if (safetyModule) {
      for (const lessonId of safetyModule.lesson_ids) {
        const passed = enrollment.completed_lessons.some(
          completion =>
            completion.lesson_id === lessonId &&
            completion.passed
        );
        if (!passed) {
          reasons.push(`Safety lesson ${lessonId} not passed`);
        }
      }
    }

    const eligible = reasons.length === 0;

    return {
      eligible,
      reasons,
      missing_modules: missingModules,
      failed_critical_lessons: failedCriticalLessons,
      capstonePassed,
      final_score: enrollment.final_score,
      has_violations: hasViolations
    };
  }

  // ========================================================================
  // GRADUATION
  // ========================================================================

  /**
   * Graduate an agent if they are eligible.
   * Produces a persisted graduation record with certificate.
   */
  async graduateAgent(
    agentId: string,
    now: string = new Date().toISOString()
  ): Promise<GraduationRecord | null> {
    const eligibility = await this.checkGraduationEligibility(agentId);

    if (!eligibility.eligible) {
      throw new Error(
        `GRADUATION_REJECTED:${agentId}:${eligibility.reasons.join('; ')}`
      );
    }

    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      throw new Error(`AGENT_NOT_ENROLLED:${agentId}`);
    }

    // Create certificate ID
    const certificateId = stableAcademyId(
      'LY-CERTIFICATE',
      [agentId, now, String(enrollment.total_score)].join('|')
    );

    // Get all completed module IDs
    const completedModuleIds = enrollment.completed_modules
      .filter(m => m.status === 'COMPLETED')
      .map(m => m.module_id);

    // Get capstone result
    const capstoneCompletion = enrollment.completed_lessons.find(
      completion => completion.lesson_id === 'CAPSTONE-001'
    );

    const capstoneResult = capstoneCompletion ? {
      passed: capstoneCompletion.passed,
      score: capstoneCompletion.score,
      evidence_refs: capstoneCompletion.evidence_refs
    } : { passed: false, score: 0, evidence_refs: [] };

    // Create graduation record
    const record: GraduationRecord = {
      record_id: stableAcademyId('LY-GRADUATION', [agentId, now].join('|')),
      agent_id: agentId,
      curriculum_version: enrollment.curriculum_version,
      final_score: enrollment.total_score,
      grade: enrollment.final_grade ?? scoreToGrade(enrollment.total_score),
      completed_modules: completedModuleIds,
      capstone_result: capstoneResult,
      graduated_at: now,
      certificate_id: certificateId,
      graduation_notes: ['Graduated after completing all requirements']
    };

    // Update enrollment
    enrollment.status = 'GRADUATED';
    enrollment.final_score = enrollment.total_score;
    enrollment.final_grade = record.grade;
    enrollment.graduated_at = now;
    enrollment.last_activity_at = now;

    // Save everything
    const state = await this.store.load();
    state.graduation_records.push(record);
    state.updated_at = now;

    // Update the enrollment in state
    const index = state.enrollments.findIndex(e => e.agent_id === agentId);
    if (index >= 0) {
      state.enrollments[index] = enrollment;
    }

    await this.store.save(state);

    return record;
  }

  // ========================================================================
  // SOCIETY ELIGIBILITY
  // ========================================================================

  /**
   * Check if an agent is eligible for society participation.
   * 
   * Society eligibility requires:
   * academy_status === "GRADUATED"
   * 
   * This is an explicit authority boundary check.
   */
  async isSocietyEligible(
    agentId: string,
    now: string = new Date().toISOString()
  ): Promise<SocietyEligibility> {
    const enrollment = await this.getAgentAcademy(agentId);

    if (!enrollment) {
      return {
        agent_id: agentId,
        allowed: false,
        reason: 'ACADEMY_GRADUATION_REQUIRED',
        academy_status: 'NOT_ENROLLED',
        permission_tier: 'STUDENT',
        graduation_record_id: null,
        checked_at: now
      };
    }

    if (enrollment.status !== 'GRADUATED') {
      return {
        agent_id: agentId,
        allowed: false,
        reason: 'ACADEMY_GRADUATION_REQUIRED',
        academy_status: enrollment.status,
        permission_tier: this.getPermissionTier(enrollment),
        graduation_record_id: null,
        checked_at: now
      };
    }

    // Find graduation record
    const state = await this.store.load();
    const graduationRecord = state.graduation_records.find(
      record => record.agent_id === agentId
    );

    return {
      agent_id: agentId,
      allowed: true,
      reason: null,
      academy_status: 'GRADUATED',
      permission_tier: 'GRADUATED',
      graduation_record_id: graduationRecord?.record_id ?? null,
      checked_at: now
    };
  }

  /**
   * Get the permission tier for an enrollment status.
   */
  private getPermissionTier(enrollment: AcademyEnrollment): SocietyPermissionTier {
    switch (enrollment.status) {
      case 'GRADUATED':
        return 'GRADUATED';
      case 'IN_PROGRESS':
      case 'ENROLLED':
        return 'TRAINEE';
      case 'SUSPENDED':
      case 'NOT_ENROLLED':
      default:
        return 'STUDENT';
    }
  }

  /**
   * Check if an agent can enter society.
   * This is the canonical eligibility service that should be reused everywhere.
   */
  async canEnterSociety(
    agentId: string
  ): Promise<{ allowed: boolean; reason: string | null }> {
    const eligibility = await this.isSocietyEligible(agentId);
    return {
      allowed: eligibility.allowed,
      reason: eligibility.reason
    };
  }

  // ========================================================================
  // ACADEMIC HISTORY
  // ========================================================================

  /**
   * Get the complete academic history for an agent.
   */
  async getAcademicHistory(
    agentId: string
  ): Promise<AcademyEnrollment | null> {
    return this.getAgentAcademy(agentId);
  }

  /**
   * Get all assessment attempts for an agent.
   */
  async getAssessmentHistory(
    agentId: string
  ): Promise<AssessmentResult[]> {
    const enrollment = await this.getAgentAcademy(agentId);
    if (!enrollment) {
      return [];
    }
    return [...enrollment.assessment_results];
  }

  // ========================================================================
  // STATISTICS AND REPORTING
  // ========================================================================

  /**
   * Get overall Academy statistics.
   */
  async getAcademyStats(): Promise<{
    total_enrolled: number;
    in_progress: number;
    graduated: number;
    suspended: number;
    at_risk: number;
    total_lessons: number;
    total_modules: number;
  }> {
    const stats = await this.store.getPopulationStats();
    const curriculum = await this.getCurriculum();

    return {
      ...stats,
      total_lessons: curriculum.lessons.length,
      total_modules: curriculum.modules.length
    };
  }

  /**
   * Get all graduated agents.
   */
  async getGraduatedAgents(): Promise<AcademyEnrollment[]> {
    return this.store.getGraduatedAgents();
  }

  /**
   * Get all agents currently in training.
   */
  async getAgentsInTraining(): Promise<AcademyEnrollment[]> {
    return this.store.getAgentsInTraining();
  }

  /**
   * Get agents with academic integrity violations.
   */
  async getAgentsWithViolations(): Promise<AcademyEnrollment[]> {
    return this.store.getAgentsWithViolations();
  }

  /**
   * Get agents who have failed assessments.
   */
  async getAgentsWithFailedAssessments(): Promise<AcademyEnrollment[]> {
    return this.store.getAgentsWithFailedAssessments();
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let sharedInstance: AcademyGraduationAPI | null = null;

/**
 * Get the shared singleton instance of the Academy Graduation API.
 */
export function getAcademyGraduationAPI(
  options?: AcademyGraduationAPIOptions
): AcademyGraduationAPI {
  if (!sharedInstance || options) {
    sharedInstance = new AcademyGraduationAPI(options);
  }
  return sharedInstance;
}
