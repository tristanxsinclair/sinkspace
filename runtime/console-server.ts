import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.SINK_CONSOLE_PORT ?? 4317);

const ROOT = process.cwd();
const CONSOLE_ROOT = path.join(ROOT, 'console');
const RUN_ROOT = path.join(ROOT, '.sink', 'runs');
const PRESERVED_RUN_ROOT = path.join(ROOT, 'agents', 'runs');

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function json(
  res: http.ServerResponse,
  status: number,
  value: unknown
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });

  res.end(JSON.stringify(value, null, 2));
}

function text(
  res: http.ServerResponse,
  status: number,
  body: string,
  type = 'text/plain; charset=utf-8'
): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store'
  });

  res.end(body);
}

async function runFiles(): Promise<string[]> {
  try {
    const files = await readdir(RUN_ROOT);

    const candidates = await Promise.all(
      files
        .filter(file => file.endsWith('.json'))
        .map(async file => {
          const full = path.join(RUN_ROOT, file);
          const info = await stat(full);

          return {
            file,
            modified: info.mtimeMs
          };
        })
    );

    return candidates
      .sort((a, b) => b.modified - a.modified)
      .map(candidate => candidate.file);
  } catch {
    return [];
  }
}

async function readRun(file: string): Promise<any> {
  const safe = path.basename(file);

  if (safe !== file || !safe.endsWith('.json')) {
    throw new Error('Invalid run file.');
  }

  return JSON.parse(
    await readFile(path.join(RUN_ROOT, safe), 'utf8')
  );
}

async function latestRun(): Promise<any | null> {
  const files = await runFiles();

  if (files.length === 0) {
    return null;
  }

  return readRun(files[0]!);
}

function eventState(run: any, agentId: string): string {
  const events = Array.isArray(run?.events)
    ? run.events.filter((event: any) => event.agent_id === agentId)
    : [];

  if (
    events.some((event: any) =>
      ['RUN_FAILED', 'TASK_FAILED'].includes(event.type)
    )
  ) {
    return 'FAILED';
  }

  if (
    events.some((event: any) =>
      ['VERIFICATION_COMPLETED', 'TASK_COMPLETED'].includes(event.type)
    )
  ) {
    return 'COMPLETE';
  }

  if (
    events.some((event: any) =>
      [
        'TOOL_REQUESTED',
        'TOOL_COMPLETED',
        'ARTIFACT_CREATED',
        'EVIDENCE_ATTACHED'
      ].includes(event.type)
    )
  ) {
    return 'RUNNING';
  }

  if (
    events.some((event: any) =>
      ['AGENT_ASSIGNED', 'TASK_CREATED'].includes(event.type)
    )
  ) {
    return 'ASSIGNED';
  }

  return 'IDLE';
}

function summarizeRun(run: any): any {
  const configs = Array.isArray(run?.agent_configs)
    ? run.agent_configs
    : [];

  const agents = configs
    .filter((config: any) => config.enabled !== false)
    .map((config: any) => ({
      id: config.id,
      name: config.name,
      purpose: config.purpose,
      capabilities: config.capabilities ?? [],
      state: eventState(run, config.id)
    }));

  const verdicts = Array.isArray(run?.verification)
    ? run.verification.map((item: any) => ({
        agent:
          item.agent_id ??
          item.verifier_agent_id ??
          item.verifier ??
          'unknown',
        verdict: item.verdict ?? item.result ?? 'UNKNOWN',
        criticism:
          item.criticism ??
          item.reason ??
          item.summary ??
          null
      }))
    : [];

  return {
    run_id: run.run_id,
    status: run.status,
    adapter: run.adapter,
    commit_sha: run.commit_sha,
    created_at: run.created_at,
    completed_at: run.completed_at ?? null,

    agents,

    claims: Array.isArray(run.claims)
      ? run.claims
      : [],

    uncertainty: Array.isArray(run.uncertainty)
      ? run.uncertainty
      : [],

    errors: Array.isArray(run.errors)
      ? run.errors
      : [],

    evidence: Array.isArray(run.evidence)
      ? run.evidence
      : [],

    artifacts: Array.isArray(run.artifacts)
      ? run.artifacts.map((artifact: any) => ({
          artifact_id: artifact.artifact_id,
          agent_id: artifact.agent_id,
          task_id: artifact.task_id,
          media_type: artifact.media_type,
          sha256: artifact.sha256,
          created_at: artifact.created_at
        }))
      : [],

    events: Array.isArray(run.events)
      ? run.events
      : [],

    verdicts,

    receipt: run.receipt
      ? {
          available: true,
          digest:
            run.receipt.digest ??
            run.receipt.receipt_digest ??
            run.receipt.sha256 ??
            null
        }
      : {
          available: false,
          digest: null
        }
  };
}

async function serveStatic(
  res: http.ServerResponse,
  pathname: string
): Promise<void> {
  const requestPath =
    pathname === '/'
      ? '/index.html'
      : pathname;

  const relative = requestPath.replace(/^\/+/, '');
  const target = path.resolve(CONSOLE_ROOT, relative);

  if (
    target !== CONSOLE_ROOT &&
    !target.startsWith(`${CONSOLE_ROOT}${path.sep}`)
  ) {
    text(res, 403, 'Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    const ext = path.extname(target);

    res.writeHead(200, {
      'content-type':
        contentTypes[ext] ??
        'application/octet-stream',
      'cache-control': 'no-store'
    });

    res.end(body);
  } catch {
    text(res, 404, 'Not found');
  }
}

async function servePreservedArtifact(
  res: http.ServerResponse,
  pathname: string
): Promise<void> {
  const relative = pathname
    .replace(/^\/runs\//, '');

  const target = path.resolve(
    PRESERVED_RUN_ROOT,
    relative
  );

  if (
    target !== PRESERVED_RUN_ROOT &&
    !target.startsWith(
      `${PRESERVED_RUN_ROOT}${path.sep}`
    )
  ) {
    text(res, 403, 'Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    const ext = path.extname(target);

    res.writeHead(200, {
      'content-type':
        contentTypes[ext] ??
        'application/octet-stream',
      'cache-control': 'no-store'
    });

    res.end(body);
  } catch {
    text(res, 404, 'Artifact not found');
  }
}

const server = http.createServer(
  async (req, res) => {
    try {
      const url = new URL(
        req.url ?? '/',
        `http://${HOST}:${PORT}`
      );

      if (
        req.method !== 'GET' &&
        req.method !== 'HEAD'
      ) {
        text(res, 405, 'Method not allowed');
        return;
      }

      if (url.pathname === '/api/latest') {
        const run = await latestRun();

        if (!run) {
          json(res, 404, {
            error: 'No run snapshots found.'
          });
          return;
        }

        json(res, 200, summarizeRun(run));
        return;
      }

      if (url.pathname === '/api/runs') {
        const files = await runFiles();

        const runs = [];

        for (const file of files.slice(0, 20)) {
          try {
            const run = await readRun(file);

            runs.push({
              run_id: run.run_id,
              status: run.status,
              adapter: run.adapter,
              commit_sha: run.commit_sha,
              created_at: run.created_at,
              completed_at:
                run.completed_at ?? null
            });
          } catch {
            // Ignore malformed historical files here.
          }
        }

        json(res, 200, runs);
        return;
      }

      if (
        url.pathname.startsWith('/api/runs/')
      ) {
        const id = decodeURIComponent(
          url.pathname.replace('/api/runs/', '')
        );

        const run = await readRun(`${id}.json`);

        json(res, 200, summarizeRun(run));
        return;
      }

      if (url.pathname.startsWith('/runs/')) {
        await servePreservedArtifact(
          res,
          url.pathname
        );
        return;
      }

      await serveStatic(res, url.pathname);
    } catch (error) {
      json(res, 500, {
        error:
          error instanceof Error
            ? error.message
            : 'Unknown console error'
      });
    }
  }
);

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('SINK CLONES COMMAND CONSOLE');
  console.log('───────────────────────────');
  console.log(`http://${HOST}:${PORT}`);
  console.log('');
  console.log(
    'Reading real state from .sink/runs'
  );
  console.log(
    'Press Ctrl+C to stop.'
  );
  console.log('');
});
