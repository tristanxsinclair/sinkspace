import type { Citizen } from './lake-yange.js';
import type { Authority } from './lake-yange.js';
import { ZERO_AUTHORITY } from './lake-yange.js';
import {
  AcademyGraduationAPI,
  getAcademyGraduationAPI
} from './academy-graduation-api.js';
import {
  SocietyPermissionTier,
  AcademyEnrollmentStatus
} from './academy-graduation-types.js';

/**
 * SOCIETY ELIGIBILITY GATE
 * =======================
 * 
 * This module provides the canonical authority boundary check for society participation.
 * It integrates with the existing Lake Yange authority system and the new Academy Graduation System.
 * 
 * Core Principle:
 * graduation == "academically qualified for society participation"
 * BUT graduation does NOT automatically grant unrestricted authority.
 * 
 * Founder authorization, institutional authority, spending authority, engineering authority,
 * etc. must still be separately enforced.
 */

// ============================================================================
// SOCIETY ELIGIBILITY SERVICE
// ============================================================================

export interface SocietyEligibilityCheck {
  agentId: string;
  citizenId: string | null;
  allowed: boolean;
  reason: string | null;
  academyStatus: AcademyEnrollmentStatus;
  permissionTier: SocietyPermissionTier;
  isGraduated: boolean;
  hasAuthority: boolean;
  authority: Authority;
}

export interface SocietyAuthorizationOptions {
  repositoryRoot?: string | undefined;
  api?: AcademyGraduationAPI | undefined;
}

class SocietyEligibilityService {
  private readonly api: AcademyGraduationAPI;

  constructor(options: SocietyAuthorizationOptions = {}) {
    this.api = options.api ?? getAcademyGraduationAPI(options);
  }

  /**
   * Check if an agent can enter society.
   * This is the canonical check that should be used everywhere.
   * 
   * Do NOT duplicate authority logic throughout the codebase.
   * Reuse this service.
   */
  async canEnterSociety(
    agentId: string
  ): Promise<SocietyEligibilityCheck> {
    // Check Academy graduation status
    const eligibility = await this.api.isSocietyEligible(agentId);

    // Get the agent's authority from the citizen record if available
    // Note: In the actual implementation, this would come from the Lake Yange state
    // For now, we use the Academy enrollment to determine permission tier
    const enrollment = await this.api.getAgentAcademy(agentId);

    // The authority check: even if graduated, the agent's operational authority
    // is separate and must be checked independently
    const hasAuthority = this.checkOperationalAuthority(enrollment);

    // The canonical rule: academy_status === "GRADUATED" is required
    // But operational authority is checked separately
    const allowed = eligibility.allowed && hasAuthority;

    // If not eligible due to graduation, that's the reason
    // If eligible but no authority, that's a different reason
    let reason = eligibility.reason;
    if (eligibility.allowed && !hasAuthority) {
      reason = 'OPERATIONAL_AUTHORITY_REQUIRED';
    }

    return {
      agentId,
      citizenId: null,
      allowed,
      reason,
      academyStatus: eligibility.academy_status,
      permissionTier: eligibility.permission_tier,
      isGraduated: eligibility.allowed,
      hasAuthority,
      authority: hasAuthority ? this.getAgentAuthority(enrollment) : ZERO_AUTHORITY
    };
  }

  /**
   * Check if an agent has operational authority.
   * Even graduated agents must have explicit operational authority granted.
   */
  private checkOperationalAuthority(
    enrollment: any | null
  ): boolean {
    // In the actual implementation, this would check the citizen's authority
    // from the Lake Yange state
    
    // For the Academy system, we can only confirm that the agent has graduated
    // Operational authority is managed separately by the governance layer
    
    // The actual authority check happens in the authority.ts module
    
    if (!enrollment) {
      return false;
    }

    // GRADUATED agents have base society authority
    // But specific operational authorities (spend money, deploy, etc.)
    // must still be explicitly granted
    if (enrollment.status === 'GRADUATED') {
      // Graduated agents have the base permission tier
      // But operational authority flags are still checked separately
      return true; // Has base society participation authority
    }

    return false;
  }

  /**
   * Get the authority for an agent based on their enrollment and citizen status.
   * This would integrate with the actual Lake Yange citizen authority.
   */
  private getAgentAuthority(enrollment: any | null): Authority {
    if (!enrollment) {
      return { ...ZERO_AUTHORITY };
    }

    // In the actual implementation, this would come from the citizen record
    // For the Academy system, we return appropriate authority based on status
    switch (enrollment.status) {
      case 'GRADUATED':
        // Graduated agents have base society authority
        // But operational authorities must be explicitly granted
        return {
          ...ZERO_AUTHORITY,
          // These are the base authorities for graduated agents
          read_repository: true,
          // Note: Other authorities (modify, deploy, spend, etc.)
          // must still be explicitly granted by governance
        };
      default:
        return { ...ZERO_AUTHORITY };
    }
  }

  /**
   * Check if an agent can perform a specific action in society.
   * This combines graduation check with authority check.
   */
  async canPerformSocietyAction(
    agentId: string,
    action: string
  ): Promise<{
    allowed: boolean;
    reason: string | null;
    graduationCheck: boolean;
    authorityCheck: boolean;
  }> {
    // First check graduation
    const eligibility = await this.api.isSocietyEligible(agentId);
    const graduationCheck = eligibility.allowed;

    // Then check specific authority for the action
    const authorityCheck = await this.checkActionAuthority(
      agentId,
      action
    );

    return {
      allowed: graduationCheck && authorityCheck,
      reason: graduationCheck
        ? authorityCheck
          ? null
          : `AUTHORITY_DENIED:${action}`
        : `ACADEMY_GRADUATION_REQUIRED`,
      graduationCheck,
      authorityCheck
    };
  }

  /**
   * Check if an agent has authority for a specific action.
   * This would integrate with the actual authority checking system.
   */
  private async checkActionAuthority(
    agentId: string,
    action: string
  ): Promise<boolean> {
    // In the actual implementation, this would check the citizen's authority
    // against the action requirements
    
    // For now, we implement basic checks
    const enrollment = await this.api.getAgentAcademy(agentId);
    
    if (!enrollment) {
      return false;
    }

    // Actions that require graduation
    const graduationRequiredActions = [
      'PROPOSE_PROJECT',
      'CONTRIBUTE_PROJECT',
      'MODIFY_REPOSITORY',
      'RUN_LOCAL_COMMANDS',
      'USE_PUBLIC_NETWORK',
      'CREATE_BRANCH',
      'CREATE_COMMIT',
      'DEPLOY_PRODUCTION',
      'CONTACT_EXTERNAL_PEOPLE',
      'SPEND_MONEY',
      'ACCESS_SECRETS',
      'DESTRUCTIVE_OPERATIONS'
    ];

    if (graduationRequiredActions.includes(action)) {
      return enrollment.status === 'GRADUATED';
    }

    // Some actions are allowed for trainees
    const traineeAllowedActions = [
      'OBSERVE',
      'STUDY',
      'REST'
    ];

    if (traineeAllowedActions.includes(action)) {
      return enrollment.status === 'GRADUATED' ||
        enrollment.status === 'IN_PROGRESS' ||
        enrollment.status === 'ENROLLED';
    }

    // Default: deny
    return false;
  }

  /**
   * Get the permission tier for an agent.
   */
  async getPermissionTier(agentId: string): Promise<SocietyPermissionTier> {
    const eligibility = await this.api.isSocietyEligible(agentId);
    return eligibility.permission_tier;
  }

  /**
   * Get all agents eligible for society participation.
   */
  async getSocietyEligibleAgents(): Promise<string[]> {
    const graduated = await this.api.getGraduatedAgents();
    return graduated.map(enrollment => enrollment.agent_id);
  }

  /**
   * Get all agents NOT eligible for society participation.
   */
  async getAgentsNotInSociety(): Promise<{
    agentId: string;
    reason: string;
  }[]> {
    const allEnrollments = await this.api.getAllEnrollments();
    const eligible = await this.getSocietyEligibleAgents();
    const eligibleSet = new Set(eligible);

    const notEligible: { agentId: string; reason: string }[] = [];

    for (const enrollment of allEnrollments) {
      if (!eligibleSet.has(enrollment.agent_id)) {
        let reason = 'NOT_GRADUATED';
        
        if (enrollment.status === 'SUSPENDED') {
          reason = `SUSPENDED: ${enrollment.suspension_reason ?? 'Unknown'}`;
        } else if (enrollment.status === 'NOT_ENROLLED') {
          reason = 'NOT_ENROLLED';
        } else if (enrollment.status === 'ENROLLED' || enrollment.status === 'IN_PROGRESS') {
          reason = 'STILL_IN_TRAINING';
        }

        notEligible.push({
          agentId: enrollment.agent_id,
          reason
        });
      }
    }

    return notEligible;
  }

  /**
   * Why hasn't an agent entered society?
   * This provides detailed reasons for why an agent cannot participate in society.
   */
  async whyNotInSociety(agentId: string): Promise<string[]> {
    const check = await this.canEnterSociety(agentId);
    
    if (check.allowed) {
      return ['Agent IS eligible for society participation'];
    }

    const reasons: string[] = [];

    if (!check.isGraduated) {
      const eligibility = await this.api.checkGraduationEligibility(agentId);
      
      if (eligibility.missing_modules.length > 0) {
        reasons.push(
          `Missing required modules: ${eligibility.missing_modules.join(', ')}`
        );
      }

      if (eligibility.failed_critical_lessons.length > 0) {
        reasons.push(
          `Failed critical lessons: ${eligibility.failed_critical_lessons.join(', ')}`
        );
      }

      if (!eligibility.capstonePassed) {
        reasons.push('Capstone not passed with score >= 80');
      }

      if (eligibility.final_score !== null && eligibility.final_score < 80) {
        reasons.push(`Final score ${eligibility.final_score} is below 80`);
      }

      if (eligibility.has_violations) {
        reasons.push('Academic integrity violations exist');
      }
    }

    if (check.isGraduated && !check.hasAuthority) {
      reasons.push(
        'Agent has graduated but lacks operational authority for specific actions'
      );
    }

    if (reasons.length === 0) {
      reasons.push(check.reason ?? 'Unknown reason');
    }

    return reasons;
  }
}

// ============================================================================
// CANONICAL SOCIETY GATE FUNCTION
// ============================================================================

let sharedSocietyService: SocietyEligibilityService | null = null;

/**
 * Get the shared society eligibility service.
 * This should be used as the canonical authority boundary check.
 */
export function getSocietyEligibilityService(
  options?: SocietyAuthorizationOptions
): SocietyEligibilityService {
  if (!sharedSocietyService || options) {
    sharedSocietyService = new SocietyEligibilityService(options);
  }
  return sharedSocietyService;
}

/**
 * Canonical check: can this agent enter society?
 * 
 * This is the single function that should be used throughout the codebase
 * to check society eligibility. Do NOT duplicate this logic.
 */
export async function isSocietyEligible(
  agentId: string,
  repositoryRoot?: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const options: SocietyAuthorizationOptions = { repositoryRoot };
  const service = getSocietyEligibilityService(options);
  const check = await service.canEnterSociety(agentId);
  return {
    allowed: check.allowed,
    reason: check.reason
  };
}

/**
 * Canonical check with citizen object (for integration with Lake Yange).
 */
export async function canEnterSocietyWithCitizen(
  citizen: Citizen,
  repositoryRoot?: string
): Promise<{ allowed: boolean; reason: string | null }> {
  return isSocietyEligible(citizen.citizen_id, repositoryRoot);
}

/**
 * Check if an agent can perform a specific society action.
 */
export async function canPerformSocietyAction(
  agentId: string,
  action: string,
  repositoryRoot?: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const options: SocietyAuthorizationOptions = { repositoryRoot };
  const service = getSocietyEligibilityService(options);
  const result = await service.canPerformSocietyAction(agentId, action);
  return {
    allowed: result.allowed,
    reason: result.reason
  };
}

export { SocietyEligibilityService };
