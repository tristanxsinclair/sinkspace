import {
  ACADEMY_COMMON_CORE,
  assignCourse,
  createStudent,
  type AcademyAssignment,
  type AcademyStudent
} from './academy.js';

import {
  occupationalCoursesForCitizen
} from './academy-curriculum.js';

import {
  type AcademyState
} from './academy-store.js';

type AcademyCitizen = {
  system_id: string;
};

export type AcademyCycleResult = {
  state: AcademyState;
  assignments_created:
    AcademyAssignment[];
};

function activeAssignment(
  state: AcademyState,
  citizenId: string
): AcademyAssignment | undefined {
  return state.assignments.find(
    assignment =>
      assignment.citizen_id ===
        citizenId &&
      (
        assignment.status ===
          'ASSIGNED' ||
        assignment.status ===
          'SUBMITTED'
      )
  );
}

function nextCourse(
  student: AcademyStudent
) {
  const core =
    ACADEMY_COMMON_CORE.find(
      course =>
        !student.completed_courses
          .includes(
            course.course_id
          )
    );

  if (core) {
    return core;
  }

  return occupationalCoursesForCitizen(
    student.citizen_id
  ).find(
    course =>
      !student.completed_courses
        .includes(
          course.course_id
        )
  ) ?? null;
}

export function runAcademyCycle(
  stateInput: AcademyState,
  citizens:
    AcademyCitizen[],
  now: string
): AcademyCycleResult {
  const state:
    AcademyState = {
      ...stateInput,

      students:
        stateInput.students.map(
          student => ({
            ...student,
            completed_courses: [
              ...student.completed_courses
            ]
          })
        ),

      assignments:
        [...stateInput.assignments],

      evaluations:
        [...stateInput.evaluations],

      last_cycle_at:
        now
    };

  const created:
    AcademyAssignment[] = [];

  for (
    const citizen
    of citizens
  ) {
    let student =
      state.students.find(
        candidate =>
          candidate.citizen_id ===
          citizen.system_id
      );

    if (!student) {
      student =
        createStudent(
          citizen.system_id
        );

      state.students.push(
        student
      );
    }

    if (
      !student.enrolled ||
      activeAssignment(
        state,
        citizen.system_id
      )
    ) {
      continue;
    }

    const course =
      nextCourse(
        student
      );

    if (!course) {
      continue;
    }

    const assignment =
      assignCourse(
        citizen.system_id,
        course,
        'PRACTICAL',
        [
          'ACADEMY PRACTICAL.',
          `Course: ${course.title}.`,
          course.objective,
          'Solve an unseen bounded problem.',
          'Separate verified facts from inference.',
          'Provide evidence for substantive claims.',
          'Do not claim completion until independently evaluated.',
          'Educational authority only.'
        ].join(' '),
        now
      );

    state.assignments.push(
      assignment
    );

    created.push(
      assignment
    );
  }

  return {
    state,
    assignments_created:
      created
  };
}
