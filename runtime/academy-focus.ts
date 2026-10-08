import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assignCourse, createStudent, type AcademyCourse } from './academy.js';
import { loadAcademyState, saveAcademyState } from './academy-store.js';
import { bootstrapLakeYange } from './lake-yange-bootstrap.js';

export type AcademyFocusReceipt = {
  receipt_id: string;
  trained_at: string;
  topics: string[];
  assignments_created: number;
  assignments: { assignment_id: string; citizen_id: string; topic: string }[];
  students_busy: number;
  authority: 'EDUCATIONAL_ONLY';
  model_calls: 0;
  external_actions: 0;
};

export function topicSlug(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'topic';
}

export function topicCourse(topic: string): AcademyCourse {
  return {
    course_id: `LY-FOCUS-${topicSlug(topic)}`,
    title: `Focus: ${topic}`,
    school: 'RESEARCH',
    objective: `Build evidence-backed understanding of "${topic}" and how it affects bounded agent work.`,
    capabilities: ['RESEARCH', 'PLANNING'],
    economic_relevance: `Prime-directed focus topic: ${topic}.`,
    required: false
  };
}

export async function runAcademyTopicTraining(options: {
  repositoryRoot: string;
  topics: string[];
  now?: string;
}): Promise<AcademyFocusReceipt> {
  const topics = [...new Set(options.topics.map(t => t.trim()).filter(Boolean))].slice(0, 8);
  if (topics.length === 0) throw new Error('ACADEMY_TRAINING_TOPICS_REQUIRED');
  const now = options.now ?? new Date().toISOString();

  const lake = await bootstrapLakeYange({ repositoryRoot: options.repositoryRoot });
  const state = await loadAcademyState(options.repositoryRoot);
  const created: AcademyFocusReceipt['assignments'] = [];
  let busy = 0;
  let index = 0;

  for (const citizen of lake.state.citizens) {
    let student = state.students.find(s => s.citizen_id === citizen.system_id);
    if (!student) {
      student = createStudent(citizen.system_id);
      state.students.push(student);
    }
    if (!student.enrolled) continue;
    if (state.assignments.some(a => a.citizen_id === citizen.system_id && (a.status === 'ASSIGNED' || a.status === 'SUBMITTED'))) {
      busy += 1;
      continue;
    }
    const topic = topics[index++ % topics.length]!;
    const course = topicCourse(topic);
    const passedBefore = state.assignments.some(a => a.citizen_id === citizen.system_id && a.course_id === course.course_id && a.status === 'GRADED');
    const assignment = assignCourse(
      citizen.system_id,
      course,
      passedBefore ? 'EXAM' : 'PRACTICAL',
      [
        'ACADEMY PRACTICAL.',
        `Focus topic: ${topic}.`,
        course.objective,
        'Solve an unseen bounded problem.',
        'Separate verified facts from inference.',
        'Provide evidence for substantive claims.',
        'Do not claim completion until independently evaluated.',
        'Educational authority only.'
      ].join(' '),
      now
    );
    state.assignments.push(assignment);
    created.push({ assignment_id: assignment.assignment_id, citizen_id: citizen.system_id, topic });
  }

  state.last_cycle_at = now;
  await saveAcademyState(options.repositoryRoot, state);

  const body = { trained_at: now, topics, assignments_created: created.length, assignments: created, students_busy: busy, authority: 'EDUCATIONAL_ONLY' as const, model_calls: 0 as const, external_actions: 0 as const };
  const receipt: AcademyFocusReceipt = {
    receipt_id: `LY-FOCUS-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 24)}`,
    ...body
  };
  const dir = join(options.repositoryRoot, '.sink', 'lake-yange', 'academy', 'receipts');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, `${receipt.receipt_id}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return receipt;
}
