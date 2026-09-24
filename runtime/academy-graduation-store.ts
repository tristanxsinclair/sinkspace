import {
  mkdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AcademyGraduationStateSchema,
  type AcademyGraduationState,
  type Curriculum
} from './academy-graduation-types.js';
import {
  CANONICAL_CURRICULUM_V1
} from './academy-curriculum-full.js';
import {
  AcademyEnrollmentSchema,
  type AcademyEnrollment,
  createEnrollment
} from './academy-graduation-types.js';

/**
 * Academy Graduation State Store
 * 
 * Provides persistent storage for the Academy Graduation System state.
 * This is separate from the existing AcademyState which handles assignments.
 */


/**
 * Create an empty graduation state with the canonical curriculum.
 */
export function emptyGraduationState(): AcademyGraduationState {
  return AcademyGraduationStateSchema.parse({
    schema_version: 1,
    curriculum: CANONICAL_CURRICULUM_V1,
    enrollments: [],
    graduation_records: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
}

/**
 * Path to the graduation state file.
 */
export function graduationStatePath(
  repositoryRoot: string
): string {
  return join(
    repositoryRoot,
    '.sink',
    'lake-yange',
    'academy',
    'graduation-state.json'
  );
}

/**
 * Load the graduation state from disk.
 */
export async function loadGraduationState(
  repositoryRoot: string
): Promise<AcademyGraduationState> {
  const path = graduationStatePath(repositoryRoot);

  try {
    const raw = await readFile(path, 'utf8');
    return AcademyGraduationStateSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return emptyGraduationState();
    }
    throw error;
  }
}

/**
 * Save the graduation state to disk.
 */
export async function saveGraduationState(
  repositoryRoot: string,
  state: AcademyGraduationState
): Promise<void> {
  const validated = AcademyGraduationStateSchema.parse(state);
  const path = graduationStatePath(repositoryRoot);

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  const temporary = `${path}.tmp`;

  await writeFile(
    temporary,
    `${JSON.stringify(validated, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600
    }
  );

  await rename(temporary, path);
}

/**
 * Academy Graduation Store - manages persisted graduation state
 */
export class AcademyGraduationStore {
  constructor(
    private readonly repositoryRoot: string = process.cwd()
  ) {}

  async load(): Promise<AcademyGraduationState> {
    return loadGraduationState(this.repositoryRoot);
  }

  async save(state: AcademyGraduationState): Promise<void> {
    await saveGraduationState(this.repositoryRoot, state);
  }

  /**
   * Get the curriculum from the store.
   */
  async getCurriculum(): Promise<Curriculum> {
    const state = await this.load();
    return state.curriculum;
  }

  /**
   * Enroll a new agent in the Academy.
   */
  async enrollAgent(
    agentId: string,
    now: string = new Date().toISOString()
  ): Promise<AcademyEnrollment> {
    const state = await this.load();

    // Check if already enrolled
    const existing = state.enrollments.find(
      enrollment => enrollment.agent_id === agentId
    );

    if (existing) {
      // If suspended, reactivate
      if (existing.status === 'SUSPENDED') {
        existing.status = 'ENROLLED';
        existing.suspension_reason = null;
        existing.last_activity_at = now;
        state.updated_at = now;
        await this.save(state);
        return existing;
      }
      return existing;
    }

    const enrollment = createEnrollment(
      agentId,
      state.curriculum.version,
      now
    );

    state.enrollments.push(enrollment);
    state.updated_at = now;

    await this.save(state);

    return enrollment;
  }

  /**
   * Get the enrollment for a specific agent.
   */
  async getEnrollment(
    agentId: string
  ): Promise<AcademyEnrollment | null> {
    const state = await this.load();
    return state.enrollments.find(
      enrollment => enrollment.agent_id === agentId
    ) ?? null;
  }

  /**
   * Get all enrollments.
   */
  async getAllEnrollments(): Promise<AcademyEnrollment[]> {
    const state = await this.load();
    return [...state.enrollments];
  }

  /**
   * Update an agent's enrollment.
   */
  async updateEnrollment(
    enrollment: AcademyEnrollment
  ): Promise<void> {
    const state = await this.load();

    const index = state.enrollments.findIndex(
      e => e.agent_id === enrollment.agent_id
    );

    if (index < 0) {
      throw new Error(
        `ENROLLMENT_NOT_FOUND:${enrollment.agent_id}`
      );
    }

    state.enrollments[index] = AcademyEnrollmentSchema.parse(enrollment);
    state.updated_at = new Date().toISOString();

    await this.save(state);
  }

  /**
   * Get all graduated agents.
   */
  async getGraduatedAgents(): Promise<AcademyEnrollment[]> {
    const state = await this.load();
    return state.enrollments.filter(
      enrollment => enrollment.status === 'GRADUATED'
    );
  }

  /**
   * Get all agents currently in training.
   */
  async getAgentsInTraining(): Promise<AcademyEnrollment[]> {
    const state = await this.load();
    return state.enrollments.filter(
      enrollment =>
        enrollment.status === 'ENROLLED' ||
        enrollment.status === 'IN_PROGRESS'
    );
  }

  /**
   * Get agents with academic integrity violations.
   */
  async getAgentsWithViolations(): Promise<AcademyEnrollment[]> {
    const state = await this.load();
    return state.enrollments.filter(
      enrollment => enrollment.academic_integrity_violations.length > 0
    );
  }

  /**
   * Get agents who have failed assessments.
   */
  async getAgentsWithFailedAssessments(): Promise<AcademyEnrollment[]> {
    const state = await this.load();
    return state.enrollments.filter(enrollment =>
      enrollment.assessment_results.some(result => !result.passed)
    );
  }

  /**
   * Get the population statistics.
   */
  async getPopulationStats(): Promise<{
    total_enrolled: number;
    in_progress: number;
    graduated: number;
    suspended: number;
    at_risk: number;
  }> {
    const enrollments = await this.getAllEnrollments();

    return {
      total_enrolled: enrollments.length,
      in_progress: enrollments.filter(
        e => e.status === 'ENROLLED' || e.status === 'IN_PROGRESS'
      ).length,
      graduated: enrollments.filter(e => e.status === 'GRADUATED').length,
      suspended: enrollments.filter(e => e.status === 'SUSPENDED').length,
      at_risk: enrollments.filter(
        e =>
          e.academic_integrity_violations.length > 0 ||
          e.assessment_results.some(r => !r.passed)
      ).length
    };
  }
}
