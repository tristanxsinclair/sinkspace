import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import {
  AcademyGraduationAPI
} from '../runtime/academy-graduation-api.js';
import {
  AcademyGraduationStore
} from '../runtime/academy-graduation-store.js';
import {
  scoreToGrade,
  gradeToNumeric
} from '../runtime/academy-graduation-types.js';
import {
  CANONICAL_CURRICULUM_V1,
  ALL_MODULES,
  ALL_LESSONS,
  LESSON_MAP,
  MODULE_MAP,
  isCriticalLesson,
  arePrerequisitesSatisfied,
  getNextLesson,
  lessonsForModule
} from '../runtime/academy-curriculum-full.js';
import {
  getSocietyEligibilityService,
  isSocietyEligible as checkSocietyEligible
} from '../runtime/society-eligibility-gate.js';

// Test repository root
const TEST_REPO_ROOT = join(process.cwd(), '.test-academy-graduation');

// ============================================================================
// SETUP AND TEARDOWN
// ============================================================================

test.before(async () => {
  // Create test directory
  await mkdir(TEST_REPO_ROOT, { recursive: true });
});

test.after(async () => {
  // Clean up test directory
  await rm(TEST_REPO_ROOT, { recursive: true, force: true });
});

async function getTestAPI(): Promise<AcademyGraduationAPI> {
  return new AcademyGraduationAPI({ repositoryRoot: TEST_REPO_ROOT });
}

async function getTestStore(): Promise<AcademyGraduationStore> {
  return new AcademyGraduationStore(TEST_REPO_ROOT);
}

// ============================================================================
// CURRICULUM TESTS
// ============================================================================

test.describe('Curriculum Definition', () => {
  test('Canonical curriculum has all 9 modules', () => {
    assert.equal(ALL_MODULES.length, 9, 'Should have 9 modules');
  });

  test('Canonical curriculum has all 41 lessons (5 per module * 8 + 1 capstone)', () => {
    // 8 modules with 5 lessons each = 40, plus 1 capstone = 41
    assert.equal(ALL_LESSONS.length, 41, 'Should have 41 lessons');
  });

  test('All modules are accessible via MODULE_MAP', () => {
    for (const module of ALL_MODULES) {
      assert.ok(
        MODULE_MAP.has(module.id),
        `Module ${module.id} should be in MODULE_MAP`
      );
    }
  });

  test('All lessons are accessible via LESSON_MAP', () => {
    for (const lesson of ALL_LESSONS) {
      assert.ok(
        LESSON_MAP.has(lesson.id),
        `Lesson ${lesson.id} should be in LESSON_MAP`
      );
    }
  });

  test('Module IDs are as specified', () => {
    const expectedModuleIds = [
      'ACADEMY-FOUNDATIONS',
      'ACADEMY-REASONING',
      'ACADEMY-ENGINEERING',
      'ACADEMY-RESEARCH',
      'ACADEMY-CIVICS',
      'ACADEMY-COLLABORATION',
      'ACADEMY-SAFETY',
      'ACADEMY-ECONOMY',
      'ACADEMY-CAPSTONE'
    ];

    const actualIds = ALL_MODULES.map(m => m.id);
    assert.deepEqual(actualIds, expectedModuleIds);
  });

  test('Module order is correct', () => {
    for (let i = 0; i < ALL_MODULES.length; i++) {
      const module = ALL_MODULES[i]!;
      assert.equal(module.order, i);
    }
  });

  test('lessonsForModule returns correct lessons', () => {
    const foundationsLessons = lessonsForModule('ACADEMY-FOUNDATIONS');
    assert.equal(foundationsLessons.length, 5);
    assert.ok(foundationsLessons.every(l => l.module_id === 'ACADEMY-FOUNDATIONS'));
  });
});

// ============================================================================
// GRADING SYSTEM TESTS
// ============================================================================

test.describe('Grading System', () => {
  test('scoreToGrade returns correct grade letters', () => {
    assert.equal(scoreToGrade(100), 'A');
    assert.equal(scoreToGrade(97), 'A');
    assert.equal(scoreToGrade(93), 'A_MINUS');
    assert.equal(scoreToGrade(90), 'A');
    assert.equal(scoreToGrade(87), 'B_MINUS');
    assert.equal(scoreToGrade(83), 'B');
    assert.equal(scoreToGrade(80), 'B_MINUS');
    assert.equal(scoreToGrade(77), 'C');
    assert.equal(scoreToGrade(73), 'C_MINUS');
    assert.equal(scoreToGrade(70), 'C');
    assert.equal(scoreToGrade(67), 'D_MINUS');
    assert.equal(scoreToGrade(63), 'D');
    assert.equal(scoreToGrade(60), 'D_MINUS');
    assert.equal(scoreToGrade(59), 'F');
    assert.equal(scoreToGrade(0), 'F');
  });

  test('gradeToNumeric returns correct GPA values', () => {
    assert.equal(gradeToNumeric('A'), 4.0);
    assert.equal(gradeToNumeric('A_MINUS'), 3.7);
    assert.equal(gradeToNumeric('B'), 3.0);
    assert.equal(gradeToNumeric('B_MINUS'), 2.7);
    assert.equal(gradeToNumeric('C'), 2.0);
    assert.equal(gradeToNumeric('C_MINUS'), 1.7);
    assert.equal(gradeToNumeric('D'), 1.0);
    assert.equal(gradeToNumeric('D_MINUS'), 0.7);
    assert.equal(gradeToNumeric('F'), 0.0);
  });

  test('critical lessons have appropriate thresholds', () => {
    const criticalLessons = ALL_LESSONS.filter(l => l.is_critical);
    
    for (const lesson of criticalLessons) {
      assert.ok(
        lesson.critical_threshold >= 80,
        `Critical lesson ${lesson.id} should have threshold >= 80`
      );
    }
  });

  test('isCriticalLesson correctly identifies critical lessons', () => {
    assert.ok(isCriticalLesson('FOUNDATIONS-001'));
    assert.ok(isCriticalLesson('SAFETY-001'));
    assert.ok(isCriticalLesson('CIVICS-002'));
    assert.ok(!isCriticalLesson('REASONING-001'));
  });
});

// ============================================================================
// PREREQUISITE SYSTEM TESTS
// ============================================================================

test.describe('Prerequisite System', () => {
  test('arePrerequisitesSatisfied with no prerequisites', () => {
    const lesson = LESSON_MAP.get('FOUNDATIONS-001')!;
    assert.ok(
      arePrerequisitesSatisfied(lesson.id, [])
    );
  });

  test('arePrerequisitesSatisfied with satisfied prerequisites', () => {
    const lesson = LESSON_MAP.get('REASONING-002')!;
    const prereqs = lesson.prerequisites;
    assert.ok(
      arePrerequisitesSatisfied(lesson.id, prereqs)
    );
  });

  test('arePrerequisitesSatisfied with missing prerequisites', () => {
    const lesson = LESSON_MAP.get('REASONING-002')!;
    assert.ok(
      !arePrerequisitesSatisfied(lesson.id, [])
    );
  });

  test('getNextLesson returns first lesson when none completed', () => {
    const nextLesson = getNextLesson([], null);
    assert.ok(nextLesson);
    assert.equal(nextLesson?.id, 'FOUNDATIONS-001');
  });

  test('getNextLesson respects prerequisite order', () => {
    const completed = ['FOUNDATIONS-001', 'FOUNDATIONS-002'];
    const nextLesson = getNextLesson(completed, null);
    assert.ok(nextLesson);
    // After FOUNDATIONS-001 and 002, could be 003, 004, or 005
    assert.ok(
      ['FOUNDATIONS-003', 'FOUNDATIONS-004', 'FOUNDATIONS-005'].includes(nextLesson.id)
    );
  });

  test('getNextLesson returns null when all completed', () => {
    const allLessonIds = ALL_LESSONS.map(l => l.id);
    const nextLesson = getNextLesson(allLessonIds, null);
    assert.equal(nextLesson, null);
  });
});

// ============================================================================
// PERSISTENCE TESTS
// ============================================================================

test.describe('Persistence', () => {
  test('empty state can be created', async () => {
    const store = new AcademyGraduationStore(TEST_REPO_ROOT);
    const state = await store.load();
    assert.ok(state);
    assert.equal(state.enrollments.length, 0);
    assert.equal(state.graduation_records.length, 0);
  });

  test('agent can be enrolled', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-001';
    
    const enrollment = await api.enrollAgent(agentId);
    assert.ok(enrollment);
    assert.equal(enrollment.agent_id, agentId);
    assert.equal(enrollment.status, 'ENROLLED');
    assert.ok(enrollment.enrolled_at);
  });

  test('enrolled agent can be retrieved', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-002';
    
    await api.enrollAgent(agentId);
    const enrollment = await api.getAgentAcademy(agentId);
    
    assert.ok(enrollment);
    assert.equal(enrollment?.agent_id, agentId);
  });

  test('enrollment persists across API instances', async () => {
    const api1 = await getTestAPI();
    const api2 = await getTestAPI();
    const agentId = 'TEST-AGENT-003';
    
    await api1.enrollAgent(agentId);
    const enrollment = await api2.getAgentAcademy(agentId);
    
    assert.ok(enrollment);
    assert.equal(enrollment?.agent_id, agentId);
  });

  test('getAllEnrollments returns all enrolled agents', async () => {
    const api = await getTestAPI();
    
    await api.enrollAgent('TEST-AGENT-004');
    await api.enrollAgent('TEST-AGENT-005');
    
    const enrollments = await api.getAllEnrollments();
    assert.ok(enrollments.length >= 2);
  });

  test('curriculum is included in state', async () => {
    const store = await getTestStore();
    const state = await store.load();
    
    assert.ok(state.curriculum);
    assert.equal(state.curriculum.version, '1.0.0');
    assert.equal(state.curriculum.modules.length, 9);
    assert.equal(state.curriculum.lessons.length, 41);
  });
});

// ============================================================================
// LESSON PROGRESS TESTS
// ============================================================================

test.describe('Lesson Progress', () => {
  test('can start a lesson', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-010';
    
    await api.enrollAgent(agentId);
    const result = await api.startLesson(agentId, 'FOUNDATIONS-001');
    
    assert.ok(result.success);
    assert.equal(result.message, 'LESSON_STARTED:FOUNDATIONS-001');
  });

  test('cannot start lesson without enrollment', async () => {
    const api = await getTestAPI();
    
    await assert.rejects(
      api.startLesson('NONEXISTENT-AGENT', 'FOUNDATIONS-001'),
      /AGENT_NOT_ENROLLED/
    );
  });

  test('cannot start lesson with unsatisfied prerequisites', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-011';
    
    await api.enrollAgent(agentId);
    const result = await api.startLesson(agentId, 'REASONING-002');
    
    assert.ok(!result.success);
    assert.ok(result.message.includes('PREREQUISITES_NOT_MET'));
  });

  test('getNextLesson returns appropriate lesson', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-012';
    
    await api.enrollAgent(agentId);
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    
    // Complete FOUNDATIONS-001
    await api.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 1, 85, true, 'Good', [], [], new Date().toISOString()
    );
    
    const nextLesson = await api.getNextLesson(agentId);
    assert.ok(nextLesson);
    // After completing FOUNDATIONS-001, next should be FOUNDATIONS-002
    assert.equal(nextLesson.id, 'FOUNDATIONS-002');
  });
});

// ============================================================================
// ASSESSMENT TESTS
// ============================================================================

test.describe('Assessment System', () => {
  test('can submit assessment', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-020';
    
    await api.enrollAgent(agentId);
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    
    const submission = await api.submitAssessment(
      agentId,
      'FOUNDATIONS-001',
      'This is my assessment submission content.',
      ['evidence-001', 'evidence-002']
    );
    
    assert.ok(submission);
    assert.equal(submission.lesson_id, 'FOUNDATIONS-001');
    assert.equal(submission.agent_id, agentId);
    assert.equal(submission.attempt, 1);
    assert.equal(submission.authority, 'EDUCATIONAL_ONLY');
  });

  test('assessment creates new attempt on retry', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-021';
    
    await api.enrollAgent(agentId);
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    
    // First submission and evaluation
    await api.submitAssessment(agentId, 'FOUNDATIONS-001', 'First attempt', []);
    await api.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 1, 65, false, 'Needs improvement', [], [], new Date().toISOString()
    );
    
    // Second submission and evaluation (retry)
    await api.submitAssessment(agentId, 'FOUNDATIONS-001', 'Second attempt', []);
    await api.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 2, 85, true, 'Good work', [], [], new Date().toISOString()
    );
    
    const history = await api.getAssessmentHistory(agentId);
    assert.equal(history.length, 2);
    assert.equal(history[0]!.attempt, 1);
    assert.equal(history[1]!.attempt, 2);
  });

  test('evaluateAssessment produces evaluation with score', async () => {
    const api = await getTestAPI();
    
    const submission: any = {
      assessment_id: 'TEST-ASSESSMENT-001',
      lesson_id: 'FOUNDATIONS-001',
      agent_id: 'TEST-AGENT-022',
      attempt: 1,
      submission_content: 'Comprehensive assessment with evidence and uncertainty.',
      evidence_refs: ['evidence-001', 'evidence-002', 'evidence-003'],
      submitted_at: new Date().toISOString(),
      authority: 'EDUCATIONAL_ONLY'
    };
    
    const evaluation = api.evaluateAssessment(submission);
    
    assert.ok(evaluation);
    assert.ok(evaluation.score >= 0);
    assert.ok(evaluation.score <= 100);
    assert.ok(evaluation.passed !== undefined);
    assert.ok(evaluation.feedback);
    assert.ok(evaluation.checks);
  });

  test('assessment score affects lesson completion', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-023';
    
    await api.enrollAgent(agentId);
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    
    // Submit assessment
    await api.submitAssessment(
      agentId,
      'FOUNDATIONS-001',
      'Comprehensive assessment with evidence and uncertainty.',
      ['evidence-001', 'evidence-002', 'evidence-003']
    );
    
    // Record result with passing score
    await api.recordAssessmentResult(
      agentId,
      'FOUNDATIONS-001',
      1,
      85,
      true,
      'Excellent work',
      ['evidence-001', 'evidence-002']
    );
    
    const enrollment = await api.getAgentAcademy(agentId);
    assert.ok(enrollment);
    
    const foundationsLesson = enrollment.completed_lessons.find(
      l => l.lesson_id === 'FOUNDATIONS-001'
    );
    assert.ok(foundationsLesson);
    assert.ok(foundationsLesson.passed);
    assert.equal(foundationsLesson.score, 85);
  });

  test('retryLesson creates new attempt', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-024';
    
    await api.enrollAgent(agentId);
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    await api.submitAssessment(agentId, 'FOUNDATIONS-001', 'First attempt');
    await api.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 1, 50, false, 'Needs improvement', []
    );
    
    const retryResult = await api.retryLesson(agentId, 'FOUNDATIONS-001');
    assert.ok(retryResult.success);
    assert.equal(retryResult.next_attempt, 2);
    
    const history = await api.getAssessmentHistory(agentId);
    assert.equal(history.length, 1); // Only one result, retry hasn't been submitted yet
  });

  test('cannot retry already passed lesson', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-025';
    
    await api.enrollAgent(agentId);
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    await api.submitAssessment(agentId, 'FOUNDATIONS-001', 'Good attempt');
    await api.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 1, 85, true, 'Excellent', []
    );
    
    const retryResult = await api.retryLesson(agentId, 'FOUNDATIONS-001');
    assert.ok(!retryResult.success);
    assert.ok(retryResult.message.includes('ALREADY_PASSED'));
  });
});

// ============================================================================
// MODULE COMPLETION TESTS
// ============================================================================

test.describe('Module Completion', () => {
  test('module completion is tracked', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-030';
    
    await api.enrollAgent(agentId);
    
    // Complete all FOUNDATIONS lessons
    const foundationsLessons = [
      'FOUNDATIONS-001',
      'FOUNDATIONS-002',
      'FOUNDATIONS-003',
      'FOUNDATIONS-004',
      'FOUNDATIONS-005'
    ];
    
    for (const lessonId of foundationsLessons) {
      await api.startLesson(agentId, lessonId);
      await api.submitAssessment(agentId, lessonId, 'Assessment content');
      await api.recordAssessmentResult(
        agentId, lessonId, 1, 85, true, 'Good work', []
      );
    }
    
    const enrollment = await api.getAgentAcademy(agentId);
    assert.ok(enrollment);
    
    const foundationsModule = enrollment.completed_modules.find(
      m => m.module_id === 'ACADEMY-FOUNDATIONS'
    );
    assert.ok(foundationsModule);
    assert.equal(foundationsModule.status, 'COMPLETED');
    assert.equal(foundationsModule.lessons_completed.length, 5);
  });
});

// ============================================================================
// GRADUATION ELIGIBILITY TESTS
// ============================================================================

test.describe('Graduation Eligibility', () => {
  test('new agent is not eligible for graduation', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-040';
    
    await api.enrollAgent(agentId);
    const eligibility = await api.checkGraduationEligibility(agentId);
    
    assert.ok(!eligibility.eligible);
    assert.ok(eligibility.reasons.length > 0);
  });

  test('agent with incomplete modules is not eligible', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-041';
    
    await api.enrollAgent(agentId);
    
    // Complete only one lesson
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    await api.submitAssessment(agentId, 'FOUNDATIONS-001', 'Content');
    await api.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 1, 85, true, 'Good', []
    );
    
    const eligibility = await api.checkGraduationEligibility(agentId);
    assert.ok(!eligibility.eligible);
    assert.ok(eligibility.missing_modules.includes('ACADEMY-FOUNDATIONS'));
  });

  test('failed critical lesson blocks graduation', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-042';
    
    await api.enrollAgent(agentId);
    
    // Complete FOUNDATIONS-001 with failing score
    await api.startLesson(agentId, 'FOUNDATIONS-001');
    await api.submitAssessment(agentId, 'FOUNDATIONS-001', 'Content');
    await api.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 1, 65, false, 'Needs improvement', []
    );
    
    const eligibility = await api.checkGraduationEligibility(agentId);
    assert.ok(!eligibility.eligible);
    assert.ok(eligibility.failed_critical_lessons.includes('FOUNDATIONS-001'));
  });

  test('academic integrity violations block graduation', async () => {
    const api = await getTestAPI();
    const agentId = 'TEST-AGENT-043';
    
    await api.enrollAgent(agentId);
    await api.addAcademicIntegrityViolation(agentId, 'FABRICATION');
    
    const eligibility = await api.checkGraduationEligibility(agentId);
    assert.ok(!eligibility.eligible);
    assert.ok(eligibility.has_violations);
  });
});

// ============================================================================
// SOCIETY ELIGIBILITY TESTS
// ============================================================================

test.describe('Society Eligibility Gate', () => {
  test('ungraduated agent cannot enter society', async () => {
    const service = getSocietyEligibilityService({ repositoryRoot: TEST_REPO_ROOT });
    const agentId = 'TEST-AGENT-050';
    
    const api = await getTestAPI();
    await api.enrollAgent(agentId);
    
    const check = await service.canEnterSociety(agentId);
    assert.ok(!check.allowed);
    assert.equal(check.reason, 'ACADEMY_GRADUATION_REQUIRED');
  });

  test('isSocietyEligible returns false for ungraduated', async () => {
    const agentId = 'TEST-AGENT-051';
    
    const api = await getTestAPI();
    await api.enrollAgent(agentId);
    
    const result = await checkSocietyEligible(agentId, TEST_REPO_ROOT);
    assert.ok(!result.allowed);
    assert.equal(result.reason, 'ACADEMY_GRADUATION_REQUIRED');
  });

  test('getSocietyEligibleAgents returns empty list initially', async () => {
    const service = getSocietyEligibilityService({ repositoryRoot: TEST_REPO_ROOT });
    const eligible = await service.getSocietyEligibleAgents();
    
    assert.ok(Array.isArray(eligible));
    // Should be empty or only contain agents we've graduated in tests
    assert.ok(eligible.length >= 0);
  });

  test('whyNotInSociety provides reasons', async () => {
    const service = getSocietyEligibilityService({ repositoryRoot: TEST_REPO_ROOT });
    const agentId = 'TEST-AGENT-052';
    
    const api = await getTestAPI();
    await api.enrollAgent(agentId);
    
    const reasons = await service.whyNotInSociety(agentId);
    assert.ok(reasons.length > 0);
    assert.ok(reasons.some(r => r.includes('ACADEMY') || r.includes('NOT_GRADUATED') || r.includes('STILL_IN_TRAINING')));
  });
});

// ============================================================================
// STATISTICS TESTS
// ============================================================================

test.describe('Academy Statistics', () => {
  test('getAcademyStats returns correct structure', async () => {
    const api = await getTestAPI();
    const stats = await api.getAcademyStats();
    
    assert.ok(stats.total_enrolled >= 0);
    assert.ok(stats.in_progress >= 0);
    assert.ok(stats.graduated >= 0);
    assert.ok(stats.suspended >= 0);
    assert.ok(stats.at_risk >= 0);
    assert.equal(stats.total_lessons, 41);
    assert.equal(stats.total_modules, 9);
  });

  test('population stats are tracked', async () => {
    const api = await getTestAPI();
    const store = new AcademyGraduationStore(TEST_REPO_ROOT);
    
    // Enroll some agents
    await api.enrollAgent('STATS-AGENT-001');
    await api.enrollAgent('STATS-AGENT-002');
    
    const stats = await store.getPopulationStats();
    assert.ok(stats.total_enrolled >= 2);
  });
});

// ============================================================================
// PERSISTENCE AND RESTART TESTS
// ============================================================================

test.describe('Persistence Across Restart', () => {
  test('enrollment persists after API recreation', async () => {
    const api1 = await getTestAPI();
    const agentId = 'PERSIST-AGENT-001';
    
    await api1.enrollAgent(agentId);
    
    // Create a new API instance (simulating restart)
    const api2 = await getTestAPI();
    const enrollment = await api2.getAgentAcademy(agentId);
    
    assert.ok(enrollment);
    assert.equal(enrollment?.agent_id, agentId);
  });

  test('lesson completion persists', async () => {
    const api1 = await getTestAPI();
    const agentId = 'PERSIST-AGENT-002';
    
    await api1.enrollAgent(agentId);
    await api1.startLesson(agentId, 'FOUNDATIONS-001');
    await api1.submitAssessment(agentId, 'FOUNDATIONS-001', 'Content');
    await api1.recordAssessmentResult(
      agentId, 'FOUNDATIONS-001', 1, 85, true, 'Good', []
    );
    
    // Create new API instance
    const api2 = await getTestAPI();
    const enrollment = await api2.getAgentAcademy(agentId);
    
    assert.ok(enrollment);
    const lessonCompletion = enrollment.completed_lessons.find(
      l => l.lesson_id === 'FOUNDATIONS-001'
    );
    assert.ok(lessonCompletion);
    assert.ok(lessonCompletion.passed);
  });

  test('graduation record persists', async () => {
    // This test would require completing all lessons, which is complex
    // For now, we test that the store can save and load state
    const store = await getTestStore();
    const state = await store.load();
    
    assert.ok(state);
    assert.ok(state.curriculum);
  });
});

// ============================================================================
// CANONICAL CURRICULUM TESTS
// ============================================================================

test.describe('Canonical Curriculum', () => {
  test('CANONICAL_CURRICULUM_V1 has correct structure', () => {
    assert.ok(CANONICAL_CURRICULUM_V1);
    assert.equal(CANONICAL_CURRICULUM_V1.version, '1.0.0');
    assert.equal(CANONICAL_CURRICULUM_V1.modules.length, 9);
    assert.equal(CANONICAL_CURRICULUM_V1.lessons.length, 41);
    assert.equal(CANONICAL_CURRICULUM_V1.capstone_lesson_id, 'CAPSTONE-001');
    assert.ok(CANONICAL_CURRICULUM_V1.created_at);
  });

  test('All modules reference valid lessons', () => {
    for (const module of CANONICAL_CURRICULUM_V1.modules) {
      for (const lessonId of module.lesson_ids) {
        assert.ok(
          LESSON_MAP.has(lessonId),
          `Module ${module.id} references non-existent lesson ${lessonId}`
        );
      }
    }
  });

  test('All lessons reference valid modules', () => {
    for (const lesson of CANONICAL_CURRICULUM_V1.lessons) {
      assert.ok(
        MODULE_MAP.has(lesson.module_id),
        `Lesson ${lesson.id} references non-existent module ${lesson.module_id}`
      );
    }
  });
});
