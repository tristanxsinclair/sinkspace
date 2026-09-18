import type {
  EngineeringProposal
} from './engineering-intelligence.js';

import {
  readWorkspaceFile,
  writeWorkspaceFile,
  workspaceDiff,
  type EngineeringWorkspace
} from './engineering-workspace.js';

function isMissingFileError(
  error: unknown
): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as {
      code?: unknown
    }).code === 'ENOENT'
  );
}

async function fileExists(
  workspace: EngineeringWorkspace,
  path: string
): Promise<boolean> {
  try {
    await readWorkspaceFile(
      workspace,
      path
    );

    return true;
  } catch (error) {
    if (
      isMissingFileError(
        error
      )
    ) {
      return false;
    }

    throw error;
  }
}

export async function applyEngineeringProposal(
  workspace: EngineeringWorkspace,
  proposal: EngineeringProposal
) {
  for (
    const mutation
    of proposal.mutations
  ) {
    const exists =
      await fileExists(
        workspace,
        mutation.path
      );

    if (
      mutation.operation ===
      'CREATE'
    ) {
      if (exists) {
        throw new Error(
          `ENGINEERING_CREATE_TARGET_EXISTS:${mutation.path}`
        );
      }

      await writeWorkspaceFile(
        workspace,
        mutation.path,
        mutation.content
      );

      continue;
    }

    if (!exists) {
      throw new Error(
        `ENGINEERING_REPLACE_TARGET_MISSING:${mutation.path}`
      );
    }

    await writeWorkspaceFile(
      workspace,
      mutation.path,
      mutation.content
    );
  }

  return workspaceDiff(
    workspace
  );
}
