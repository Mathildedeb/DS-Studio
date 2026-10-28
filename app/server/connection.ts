import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, readPrivate } from './files.js';
import { StudioError } from './store.js';
import { figmaFileKey } from '../../connectors/figma/reader.js';
import {
  connectionSchema,
  type Connection,
  type ConnectionStatus,
  type FolderInfo,
} from '../shared/connection.js';

// Commandes en lecture seule, sans shell ; fsmonitor coupé pour qu'un dépôt
// inconnu ne puisse rien lancer pendant l'inspection.
const run = (cmd: string, args: string[], timeout = 5000) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout, maxBuffer: 100_000 }, (error, out) =>
      error ? reject(error) : resolve(out.trim()),
    ),
  );
const git = (folder: string, ...args: string[]) =>
  run('git', ['-c', 'core.fsmonitor=false', '-C', folder, ...args]);

export async function inspectFolder(folder: string): Promise<FolderInfo> {
  if (!path.isAbsolute(folder))
    throw new StudioError(
      'Chemin complet attendu, par exemple /chemin/vers/mon-projet.',
    );
  let real: string;
  try {
    real = await fs.realpath(folder);
  } catch {
    throw new StudioError('Dossier introuvable.');
  }
  if (!(await fs.stat(real)).isDirectory())
    throw new StudioError('Ce chemin n’est pas un dossier.');
  let info: FolderInfo['git'] = null;
  try {
    await git(real, 'rev-parse', '--show-toplevel');
    const remote = await git(real, 'remote', 'get-url', 'origin').catch(
      () => '',
    );
    const branch = await git(real, 'branch', '--show-current').catch(() => '');
    info = {
      // Un nom et un jeton glissés dans l'URL du dépôt ne sont jamais renvoyés.
      remote: remote.replace(/\/\/[^@/]+@/, '//') || null,
      branch: branch || null,
    };
  } catch {
    info = null;
  }
  return { folder: real, name: path.basename(real), git: info };
}

export class ConnectionStore {
  private file: string;
  constructor(directory: string) {
    this.file = path.join(directory, 'connection.json');
  }
  async read(): Promise<Connection> {
    try {
      return connectionSchema.parse(
        JSON.parse(await readPrivate(this.file, 5000)),
      );
    } catch {
      return {};
    }
  }
  async status(): Promise<ConnectionStatus> {
    const saved = await this.read();
    if (!saved.folder) return { saved };
    try {
      return { saved, project: await inspectFolder(saved.folder) };
    } catch (e) {
      return { saved, folderError: (e as Error).message };
    }
  }
  async save(input: unknown) {
    const connection = connectionSchema.parse(input);
    if (connection.figmaUrl && !figmaFileKey(connection.figmaUrl))
      throw new StudioError(
        'Lien Figma attendu : https://www.figma.com/design/…',
      );
    if (connection.folder)
      connection.folder = (await inspectFolder(connection.folder)).folder;
    await atomicWrite(this.file, JSON.stringify(connection, null, 2) + '\n');
    return this.status();
  }
}

// Sélecteur de dossier natif de macOS, ouvert à la demande de l'étudiante.
// Annulé : null. Ailleurs que sur macOS, le chemin se colle à la main.
export async function pickFolder(): Promise<string | null> {
  if (process.platform !== 'darwin')
    throw new StudioError(
      'Sélecteur indisponible sur ce système : collez le chemin du dossier.',
      501,
    );
  try {
    const picked = await run(
      'osascript',
      [
        '-e',
        'POSIX path of (choose folder with prompt "Dossier de votre projet")',
      ],
      300_000,
    );
    return picked.replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}
