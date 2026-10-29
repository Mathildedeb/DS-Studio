import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StudioError } from './store.js';
import { spawnNpm } from './npm.js';

// Serveur de dev du projet ouvert, lancé seulement au clic de l'étudiante :
// le script « dev » (ou « start ») de son package.json, dans son dossier.
export interface DevStatus {
  state: 'stopped' | 'installing' | 'starting' | 'running' | 'error';
  // Dossier node_modules absent : il faut d'abord « npm install ».
  needsInstall?: boolean;
  folder?: string;
  command?: string;
  url?: string;
  logs: string[];
}
const localUrl = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}\/?/;

export async function detectCommand(folder: string) {
  let scripts: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(path.join(folder, 'package.json'), 'utf8');
    scripts = JSON.parse(raw).scripts ?? {};
  } catch {
    return null;
  }
  for (const name of ['dev', 'start'])
    if (typeof scripts[name] === 'string')
      return { args: ['run', name], label: `npm run ${name}` };
  return null;
}

export class DevServer {
  private child?: ChildProcess;
  private status: DevStatus = { state: 'stopped', logs: [] };
  read(): DevStatus {
    return { ...this.status, logs: this.status.logs.slice(-40) };
  }
  async readFor(folder: string): Promise<DevStatus> {
    const needsInstall = await fs
      .access(path.join(folder, 'node_modules'))
      .then(() => false)
      .catch(() => true);
    return { ...this.read(), needsInstall };
  }
  // Installation des dépendances du projet, seulement au clic (5 min max).
  async install(folder: string): Promise<DevStatus> {
    this.stop();
    const status: DevStatus = {
      state: 'installing',
      folder,
      command: 'npm install',
      logs: [],
    };
    this.status = status;
    const child = await spawnNpm(['install'], {
      cwd: folder,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    }).catch((e: Error) => {
      status.logs.push(`Installation impossible : ${e.message}`);
      status.state = 'error';
      return null;
    });
    if (!child) return this.readFor(folder);
    await new Promise<void>((resolve) => {
      const onData = (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n'))
          if (line.trim()) status.logs.push(line.slice(0, 300));
        status.logs.splice(0, Math.max(0, status.logs.length - 200));
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (e) => {
        status.logs.push(`Installation impossible : ${e.message}`);
        status.state = 'error';
        resolve();
      });
      child.on('exit', (code) => {
        status.state = code ? 'error' : 'stopped';
        status.logs.push(
          code
            ? `npm install a échoué (code ${code}).`
            : 'Dépendances installées.',
        );
        resolve();
      });
    });
    return this.readFor(folder);
  }
  // Démarre et attend l'adresse locale affichée par le serveur (60 s max).
  async start(folder: string): Promise<DevStatus> {
    this.stop();
    const command = await detectCommand(folder);
    if (!command)
      throw new StudioError(
        'Aucun script « dev » ou « start » dans le package.json du projet.',
        409,
      );
    const child = await spawnNpm(command.args, {
      cwd: folder,
      // Groupe de processus à part : l'arrêt coupe aussi ses enfants.
      detached: true,
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    const status: DevStatus = {
      state: 'starting',
      folder,
      command: command.label,
      logs: [],
    };
    this.status = status;
    return new Promise((resolve) => {
      const done = () => resolve(this.read());
      const timer = setTimeout(() => {
        if (status.state === 'starting') {
          status.state = 'error';
          status.logs.push('Aucune adresse locale affichée après 60 s.');
        }
        done();
      }, 60_000);
      const onData = (chunk: Buffer) => {
        for (const line of chunk
          .toString()
          // Codes de couleur du terminal retirés.
          .replace(/\x1b\[[0-9;]*m/g, '')
          .split('\n')) {
          if (!line.trim()) continue;
          status.logs.push(line.slice(0, 300));
          if (status.logs.length > 200) status.logs.shift();
          const url = line.match(localUrl)?.[0];
          if (url && status.state === 'starting') {
            status.url = url.replace(/\/$/, '');
            status.state = 'running';
            clearTimeout(timer);
            done();
          }
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('exit', (code) => {
        if (this.child === child) this.child = undefined;
        status.state = code ? 'error' : 'stopped';
        status.logs.push(`Serveur arrêté (code ${code ?? 'signal'}).`);
        clearTimeout(timer);
        done();
      });
      child.on('error', (e) => {
        status.state = 'error';
        status.logs.push(`Lancement impossible : ${e.message}`);
        clearTimeout(timer);
        done();
      });
    });
  }
  stop() {
    const child = this.child;
    this.child = undefined;
    if (child?.pid) {
      // Sous Windows, pas de groupe de processus : « npm » tué seul laisse
      // vivre le vrai serveur (et ses sorties ouvertes). On coupe l'arbre.
      if (process.platform === 'win32')
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        }).on('error', () => child.kill());
      else
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      // Les sorties du serveur ne retiennent plus DS-Studio.
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    this.status = { state: 'stopped', logs: this.status.logs };
    return this.read();
  }
}
