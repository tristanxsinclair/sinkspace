import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { ControlError } from './security.js';
const exec = promisify(execFile);
export interface RepositoryReader {
  readonly root: string;
  pin(): Promise<string>;
  inventory(commit: string): Promise<string[]>;
  read(commit: string, path: string): Promise<string>;
}
export const PERMITTED_FILES = Object.freeze(['README.md','package.json','.github/workflows/static.yml','.github/workflows/ci.yml','dist/index.html','dist/app.js','dist/styles.css','dist/release.json','dist/404.html','dist/robots.txt','dist/sitemap.xml','dist/mark.svg']);
export class GitRepository implements RepositoryReader {
  private constructor(public readonly root: string) {}
  static async open(root: string): Promise<GitRepository> {
    const resolved = await realpath(root);
    const repo = new GitRepository(resolved);
    const actual = (await repo.git(['rev-parse','--show-toplevel'])).trim();
    if (await realpath(actual) !== resolved) throw new ControlError('REPOSITORY_ROOT_REQUIRED');
    return repo;
  }
  private async git(args: string[]): Promise<string> {
    try {
      const result = await exec('git', ['--no-pager', ...args], {cwd: this.root, timeout: 5000, maxBuffer: 2_000_000,
        env: {PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1'}, encoding: 'utf8'});
      return result.stdout;
    } catch { throw new ControlError('TOOL_FAILURE', 'Git read failed or exceeded the fixed timeout/output limit.'); }
  }
  private checkCommit(commit: string): void { if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new ControlError('INVALID_COMMIT'); }
  async pin(): Promise<string> { const sha = (await this.git(['rev-parse','HEAD'])).trim(); this.checkCommit(sha); return sha; }
  async inventory(commit: string): Promise<string[]> {
    this.checkCommit(commit); return (await this.git(['ls-tree','-r','--name-only','-z',commit])).split('\0').filter(Boolean);
  }
  async read(commit: string, path: string): Promise<string> {
    this.checkCommit(commit);
    if (!PERMITTED_FILES.includes(path)) throw new ControlError('PATH_DENIED');
    // Read immutable Git blobs, never working-tree paths or symlink targets. No shell, hooks, checkout, or repo scripts.
    const entry = (await this.git(['ls-tree',commit,'--',path])).trim();
    if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(entry)) throw new ControlError('NOT_REGULAR_TRACKED_FILE');
    return this.git(['show',`${commit}:${path}`]);
  }
}
