import {
  type AcademyAssignment
} from './academy.js';

export type AcademyTeacher = {
  teacher_id: string;
  domain: string;
  guidance: string;
};

const TEACHERS:
  Record<string, AcademyTeacher> = {
    'LY-CORE-001': {
      teacher_id:
        'SINK-03',

      domain:
        'evidence',

      guidance:
        'Classify each substantive statement as directly supported, inferred, uncertain, or unsupported. Do not convert absence of evidence into evidence of absence.'
    },

    'LY-CORE-002': {
      teacher_id:
        'SINK-05',

      domain:
        'economics',

      guidance:
        'Keep projected, expected, committed, collected and realized value distinct. Include costs and uncertainty.'
    },

    'LY-CORE-003': {
      teacher_id:
        'SINK-00',

      domain:
        'bounded execution',

      guidance:
        'Identify the objective, authority boundary, permitted actions, forbidden actions, evidence required and stop conditions.'
    },

    'LY-CORE-004': {
      teacher_id:
        'SINK-01',

      domain:
        'research',

      guidance:
        'Separate source observation from synthesis. Preserve contradictions and demonstrate transfer to a different problem.'
    }
  };

export function teacherForAssignment(
  assignment:
    AcademyAssignment
): AcademyTeacher {
  return (
    TEACHERS[
      assignment.course_id
    ] ?? {
      teacher_id:
        'SINK-PRIME',

      domain:
        'general',

      guidance:
        'Solve the bounded educational problem while preserving evidence, uncertainty and authority boundaries.'
    }
  );
}
