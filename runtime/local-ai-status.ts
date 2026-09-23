/**
 * Truthful local-AI probe with short-lived caching.
 *
 * The console polls the world projection every ~1.5s; probing the local
 * llama.cpp endpoint on every request would be wasteful, so probes are
 * cached for a short TTL. `UNKNOWN` is only reported before the first
 * probe completes; after that the status is a real measurement.
 */
import {
  LlamaCppLocalRuntime
} from './llama-cpp-local-runtime.js';

export interface LocalAiStatus {
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  endpoint: string | null;
  probed_at: string | null;
}

export const DEFAULT_LOCAL_AI_ENDPOINT =
  'http://127.0.0.1:18181';

const DEFAULT_TTL_MS = 15_000;

interface ProbeCache {
  status: LocalAiStatus;
  at: number;
}

let probeCache: ProbeCache | null = null;

export async function probeLocalAi(
  options: {
    endpoint?: string;
    ttlMs?: number;
    now?: () => number;
    runtime?: { health(): Promise<boolean> };
  } = {}
): Promise<LocalAiStatus> {
  const endpoint =
    options.endpoint ?? DEFAULT_LOCAL_AI_ENDPOINT;

  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  const now = options.now ?? Date.now;

  if (
    probeCache &&
    probeCache.status.endpoint === endpoint &&
    now() - probeCache.at < ttlMs
  ) {
    return probeCache.status;
  }

  const runtime =
    options.runtime ??
    new LlamaCppLocalRuntime({ baseUrl: endpoint });

  let status: 'ONLINE' | 'OFFLINE';

  try {
    status = (await runtime.health())
      ? 'ONLINE'
      : 'OFFLINE';
  } catch {
    status = 'OFFLINE';
  }

  const result: LocalAiStatus = {
    status,
    endpoint,
    probed_at: new Date(now()).toISOString()
  };

  probeCache = {
    status: result,
    at: now()
  };

  return result;
}

/** Test helper: clears the shared probe cache. */
export function resetLocalAiProbeCache(): void {
  probeCache = null;
}