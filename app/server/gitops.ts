import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StudioError } from './store.js';

// Publication du projet ouvert : jamais sur main, toujours sur une branche
// de travail design/…, et seulement après l'accord de l'étudiante dans le
// chat. L'authentification est celle de Git sur sa machine.
export interface GitStatus {
  branch: string | null;
  remote: string | null;
  files: { path: string; state: string }[];
  ahead: number;
  // Branche principale : la publication créera d'abord une branche de travail.
  protected: boolean;
}
const run = (folder: string, args: string[], timeout = 15_000) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      'git',
      ['-c', 'core.fsmonitor=false', '-C', folder, ...args],
      {
        timeout,
        maxBuffer: 2_000_000,
        // Jamais de question bloquante : sans identifiants, le push échoue net.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, out, err) =>
        error
          ? reject(new Error((err || error.message).trim().slice(-600)))
          : resolve(out.trim()),
    ),
  );
const mainBranches = new Set(['main', 'master', 'develop', 'production']);
// Fichiers qui ne doivent jamais partir sur GitHub.
const sensitive =
  /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12)|id_rsa.*|node_modules\/.*|\.ds-studio\/.*)$/;

export async function gitStatus(folder: string): Promise<GitStatus> {
  let raw: string;
  try {
    raw = await run(folder, ['status', '--porcelain=v1', '-b', '-uall']);
  } catch {
    throw new StudioError('Ce dossier n’est pas un dépôt Git.', 409);
  }
  const [head, ...lines] = raw.split('\n');
  const branch =
    head?.match(/^## (?:No commits yet on )?([^.\s]+)/)?.[1] ?? null;
  const remote = await run(folder, ['remote', 'get-url', 'origin']).catch(
    () => '',
  );
  // Branche jamais poussée : ses commits restent à publier.
  const hasCommits = !head?.startsWith('## No commits yet');
  const ahead = head?.includes('...')
    ? Number(head.match(/ahead (\d+)/)?.[1] ?? 0)
    : remote && hasCommits && !mainBranches.has(branch ?? '')
      ? 1
      : 0;
  return {
    branch,
    remote: remote.replace(/\/\/[^@/]+@/, '//') || null,
    files: lines
      .filter(Boolean)
      .slice(0, 200)
      .map((l) => ({ state: l.slice(0, 2).trim(), path: l.slice(3) })),
    ahead,
    protected: !branch || mainBranches.has(branch),
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'maj';

export async function publish(folder: string, message: string) {
  const status = await gitStatus(folder);
  const risky = status.files.filter((f) => sensitive.test(f.path));
  if (risky.length)
    throw new StudioError(
      `Publication refusée : fichiers sensibles modifiés (${risky
        .map((f) => f.path)
        .join(', ')}). Ajoutez-les au .gitignore.`,
      409,
    );
  if (!status.files.length && !status.ahead)
    throw new StudioError('Rien à publier : aucun changement.', 409);
  let branch = status.branch!;
  // Sur la branche principale : une branche de travail emporte les changements.
  if (status.protected) {
    const day = new Date().toISOString().slice(0, 10);
    branch = `design/${day}-${slug(message)}`;
    await run(folder, ['switch', '-c', branch]);
  }
  // Les fichiers générés depuis les tokens (tokens.css…) suivent le JSON.
  const scripts = await readFile(path.join(folder, 'package.json'), 'utf8')
    .then((raw) => JSON.parse(raw).scripts ?? {})
    .catch(() => ({}));
  if (typeof scripts.tokens === 'string')
    await new Promise<void>((resolve) =>
      execFile('npm', ['run', 'tokens'], { cwd: folder, timeout: 60_000 }, () =>
        resolve(),
      ),
    );
  const files = (await gitStatus(folder)).files;
  if (files.length) {
    await run(folder, ['add', '-A']);
    try {
      await run(folder, ['commit', '-m', message.slice(0, 500)], 60_000);
    } catch (e) {
      throw new StudioError(`Commit impossible : ${(e as Error).message}`, 409);
    }
  }
  if (!status.remote)
    return {
      branch,
      commit: await run(folder, ['rev-parse', '--short', 'HEAD']),
      pushed: false,
    };
  try {
    await run(folder, ['push', '-u', 'origin', branch], 120_000);
  } catch (e) {
    throw new StudioError(
      `Commit fait sur ${branch}, mais push refusé : ${(e as Error).message}`,
      502,
    );
  }
  return {
    branch,
    commit: await run(folder, ['rev-parse', '--short', 'HEAD']),
    pushed: true,
  };
}
