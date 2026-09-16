import os from 'node:os';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

export const SystemProbeSchema = z.strictObject({
  platform: z.string().min(1),
  architecture: z.string().min(1),
  cpu_model: z.string().min(1),
  physical_cores: z.number().int().positive(),
  logical_cores: z.number().int().positive(),
  memory_bytes: z.number().int().positive(),
  os_version: z.string().min(1),
  hardware_model: z.string().min(1),
  rosetta_translated: z.boolean(),
  xmrig: z.strictObject({
    installed: z.boolean(),
    path: z.string().nullable()
  })
});

export type SystemProbe =
  z.infer<typeof SystemProbeSchema>;

async function command(
  file: string,
  args: string[]
): Promise<string | null> {
  try {
    const result = await execFileAsync(
      file,
      args,
      {
        timeout: 3000,
        maxBuffer: 128_000,
        encoding: 'utf8'
      }
    );

    return String(result.stdout).trim() || null;
  } catch {
    return null;
  }
}

async function sysctl(
  key: string
): Promise<string | null> {
  return command(
    '/usr/sbin/sysctl',
    ['-n', key]
  );
}

async function findXmrig():
  Promise<string | null> {
  const candidates = [
    '/opt/homebrew/bin/xmrig',
    '/usr/local/bin/xmrig'
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue.
    }
  }

  return command(
    '/usr/bin/which',
    ['xmrig']
  );
}

export async function probeSystem():
  Promise<SystemProbe> {
  const cpus = os.cpus();

  const physical =
    await sysctl('hw.physicalcpu');

  const hardwareModel =
    await sysctl('hw.model');

  const translated =
    await sysctl(
      'sysctl.proc_translated'
    );

  const macVersion =
    await command(
      '/usr/bin/sw_vers',
      ['-productVersion']
    );

  const xmrigPath =
    await findXmrig();

  return SystemProbeSchema.parse({
    platform: os.platform(),

    architecture: os.arch(),

    cpu_model:
      cpus[0]?.model ??
      (
        await sysctl(
          'machdep.cpu.brand_string'
        )
      ) ??
      'UNKNOWN',

    physical_cores:
      Number.parseInt(
        physical ??
        String(cpus.length),
        10
      ),

    logical_cores:
      cpus.length,

    memory_bytes:
      os.totalmem(),

    os_version:
      macVersion ??
      os.release(),

    hardware_model:
      hardwareModel ??
      'UNKNOWN',

    rosetta_translated:
      translated === '1',

    xmrig: {
      installed:
        xmrigPath !== null,

      path:
        xmrigPath
    }
  });
}
