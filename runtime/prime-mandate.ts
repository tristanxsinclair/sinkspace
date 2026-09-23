import {
  createFounderMandate,
  type FounderMandate
} from './founder-mandate.js';

import {
  FounderMandateStore
} from './founder-mandate-store.js';

export type PrimeMandateInterpretation =
  | {
      status: 'NOT_MANDATE_ACTION';
      reply: null;
    }
  | {
      status: 'REGISTER_MANDATE_FILE';
      relative_path: string;
      reply: string;
    }
  | {
      status: 'REGISTER_MANDATE';
      original_text: string;
      reply: string;
    }
  | {
      status: 'NEEDS_MANDATE_TEXT';
      reply: string;
    };

const REGISTER_PREFIX =
  /^\s*register\s+(?:founder\s+)?mandate\s*:\s*/i;

export function interpretPrimeMandateAction(
  rawInput: string
): PrimeMandateInterpretation {
  const input =
    rawInput.trim();
  const fileMatch =
    input.match(
      /^register\s+mandate\s+file\s*:\s*(.+)$/i
    );

  if (fileMatch) {
    const relativePath =
      fileMatch[1]?.trim();

    if (!relativePath) {
      return {
        status: 'NEEDS_MANDATE_TEXT',
        reply:
          'The Mandate Register requires a repository-relative mandate file.'
      };
    }

    return {
      status:
        'REGISTER_MANDATE_FILE',

      relative_path:
        relativePath,

      reply:
        'Canonical Founder Mandate artifact is ready for registration.'
    };
  }


  if (
    !/^register\s+(?:founder\s+)?mandate\b/i
      .test(input)
  ) {
    return {
      status: 'NOT_MANDATE_ACTION',
      reply: null
    };
  }

  if (!REGISTER_PREFIX.test(input)) {
    return {
      status: 'NEEDS_MANDATE_TEXT',
      reply:
        'Use: register mandate: <constitutional text>. Registration records the mandate but grants no execution authority.'
    };
  }

  const originalText =
    input.replace(
      REGISTER_PREFIX,
      ''
    ).trim();

  if (!originalText) {
    return {
      status: 'NEEDS_MANDATE_TEXT',
      reply:
        'The Mandate Register requires the original constitutional text.'
    };
  }

  return {
    status: 'REGISTER_MANDATE',
    original_text: originalText,
    reply:
      'Founder Mandate is ready for registration.'
  };
}

export async function registerPrimeFounderMandate(
  repositoryRoot: string,
  originalText: string
): Promise<FounderMandate> {
  const mandate =
    createFounderMandate(
      originalText
    );

  const store =
    new FounderMandateStore(
      `${repositoryRoot}/.sink/lake-yange/mandates`
    );

  await store.save(mandate);

  return mandate;
}

export function founderMandateRegisteredReply(
  mandate: FounderMandate
): string {
  return [
    'FOUNDER_MANDATE_REGISTERED',
    `Mandate ID: ${mandate.mandate_id}`,
    `Status: ${mandate.status}`,
    `Original text SHA-256: ${mandate.original_text_sha256}`,
    'The original constitutional text has been persisted.',
    'Registration does not imply implementation, approval, verification or execution.',
    'Execution authority granted: NO.'
  ].join('\n');
}

/**
 * Register a canonical Founder Mandate source artifact.
 *
 * Constitutional boundary:
 * - docs/lake-yange/*.txt only
 * - repository-contained path only
 * - bounded size
 * - read-only source access
 * - registration grants zero execution authority
 */
export async function registerPrimeFounderMandateFile(
  repositoryRoot: string,
  relativePath: string
): Promise<FounderMandate> {
  const {
    readFile,
    realpath
  } = await import('node:fs/promises');

  const {
    resolve,
    relative,
    sep
  } = await import('node:path');

  const normalized =
    relativePath.trim();

  if (
    !/^docs\/lake-yange\/[A-Za-z0-9._-]+\.txt$/
      .test(normalized)
  ) {
    throw new Error(
      'FOUNDER_MANDATE_FILE_NOT_ALLOWED'
    );
  }

  const root =
    await realpath(repositoryRoot);

  const candidate =
    resolve(root, normalized);

  const actual =
    await realpath(candidate);

  const containment =
    relative(root, actual);

  if (
    containment.startsWith(`..${sep}`) ||
    containment === '..' ||
    containment.startsWith('/') ||
    containment === ''
  ) {
    throw new Error(
      'FOUNDER_MANDATE_FILE_OUTSIDE_REPOSITORY'
    );
  }

  const raw =
    await readFile(
      actual,
      'utf8'
    );

  const bytes =
    Buffer.byteLength(
      raw,
      'utf8'
    );

  if (
    bytes < 1 ||
    bytes > 32_768
  ) {
    throw new Error(
      'FOUNDER_MANDATE_FILE_SIZE_INVALID'
    );
  }

  const originalText =
    raw.trim();

  const mandate =
    createFounderMandate(
      originalText,
      {
        title:
          originalText
            .split('\n')[0]
            ?.trim() ||
          'Founder Mandate',

        evidenceRefs: [
          `repo:${normalized}`
        ]
      }
    );

  const store =
    new FounderMandateStore(
      `${root}/.sink/lake-yange/mandates`
    );

  await store.save(mandate);

  return mandate;
}
