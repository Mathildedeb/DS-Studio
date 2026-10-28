import { spawn, type SpawnOptions } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { npmCli } from '../../scripts/runtime.mjs';

// npm du projet, lancé par le Node de DS-Studio : même chemin sur les trois OS
// (sous Windows, « npm » est un .cmd qu'un spawn sans shell ne trouve pas).
export async function spawnNpm(args: string[], options: SpawnOptions) {
  return spawn(process.execPath, [await npmCli(), ...args], {
    windowsHide: true,
    ...options,
  });
}

export interface TokensScript {
  state: 'ok' | 'error' | 'absent';
  detail?: string;
}
// « npm run tokens » du projet : régénère les fichiers dérivés des tokens
// (tokens.css…) que son interface charge. Sans script, rien à faire.
export async function runTokensScript(folder: string): Promise<TokensScript> {
  const scripts = await readFile(path.join(folder, 'package.json'), 'utf8')
    .then((raw) => JSON.parse(raw).scripts ?? {})
    .catch(() => ({}));
  if (typeof scripts.tokens !== 'string') return { state: 'absent' };
  let output = '';
  try {
    const child = await spawnNpm(['run', 'tokens'], {
      cwd: folder,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    const capture = (chunk: Buffer) =>
      (output = (output + chunk.toString()).slice(-2000));
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });
    return code === 0
      ? { state: 'ok' }
      : {
          state: 'error',
          detail: `npm run tokens a échoué (code ${code}) : ${output.trim().slice(-600)}`,
        };
  } catch (e) {
    return {
      state: 'error',
      detail: `npm run tokens impossible : ${(e as Error).message}`,
    };
  }
}
