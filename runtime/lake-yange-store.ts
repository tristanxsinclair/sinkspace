import {
  mkdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';

import { dirname } from 'node:path';

import {
  LakeYangeStateSchema,
  type LakeYangeState
} from './lake-yange.js';

const DEFAULT_PATH =
  '.sink/lake-yange/state.json';

export class LakeYangeStore {
  constructor(
    private readonly path =
      DEFAULT_PATH
  ) {}

  async exists(): Promise<boolean> {
    try {
      await readFile(
        this.path,
        'utf8'
      );

      return true;
    } catch {
      return false;
    }
  }

  async load():
    Promise<LakeYangeState> {
    const raw =
      await readFile(
        this.path,
        'utf8'
      );

    return LakeYangeStateSchema.parse(
      JSON.parse(raw)
    );
  }

  async save(
    input: LakeYangeState
  ): Promise<void> {
    const state =
      LakeYangeStateSchema.parse(
        input
      );

    await mkdir(
      dirname(this.path),
      {
        recursive: true
      }
    );

    const temporaryPath =
      `${this.path}.tmp`;

    await writeFile(
      temporaryPath,
      JSON.stringify(
        state,
        null,
        2
      ) + '\n',
      {
        encoding: 'utf8',
        mode: 0o600
      }
    );

    /**
     * Rename gives us a simple atomic replacement
     * on the same filesystem.
     *
     * A partially-written civilisation state should
     * never become the canonical state.
     */
    await rename(
      temporaryPath,
      this.path
    );
  }
}
