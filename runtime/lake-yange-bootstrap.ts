import {
  createFoundingLakeYange
} from './lake-yange-founders.js';

import {
  LakeYangeStore
} from './lake-yange-store.js';

import {
  join
} from 'node:path';

export async function bootstrapLakeYange(
  options: {
    force?: boolean;
    foundedAt?: string;
    repositoryRoot?: string;
  } = {}
) {
  const store =
    new LakeYangeStore(
      options.repositoryRoot
        ? join(
            options.repositoryRoot,
            '.sink/lake-yange/state.json'
          )
        : undefined
    );

  if (
    !options.force &&
    await store.exists()
  ) {
    return {
      created: false,
      state:
        await store.load()
    };
  }

  const state =
    createFoundingLakeYange(
      options.foundedAt
    );

  await store.save(state);

  return {
    created: true,
    state
  };
}

const invokedDirectly =
  process.argv[1]
    ?.replace(/\\/g, '/')
    .endsWith(
      '/runtime/lake-yange-bootstrap.ts'
    );

if (invokedDirectly) {
  const result =
    await bootstrapLakeYange();

  console.log(
    JSON.stringify(
      {
        created:
          result.created,

        settlement:
          result.state
            .settlement_id,

        generation:
          result.state
            .generation,

        population:
          result.state
            .citizens.length,

        citizens:
          result.state
            .citizens.map(
              (citizen) => ({
                system_id:
                  citizen.system_id,

                name:
                  citizen.name,

                role:
                  citizen.role,

                rank:
                  citizen.rank,

                home:
                  citizen.home
              })
            )
      },
      null,
      2
    )
  );
}
