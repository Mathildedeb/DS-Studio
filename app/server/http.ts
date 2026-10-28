import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { proposeSchema } from '../shared/model.js';
import { focusSchema } from '../shared/focus.js';
import { Store, StudioError } from './store.js';
import { ProjectStore } from './project.js';
import { projectSchema } from '../shared/project.js';
import { DashboardStore, readRoadmap } from './dashboard.js';
import { checklistSchema } from '../shared/dashboard.js';
import { CodexAdapter } from '../../connectors/agents/codex.js';
import { ClaudeAdapter } from '../../connectors/agents/claude.js';
import { proposeCode, type Ask } from '../../connectors/agents/coder.js';
import { CodeStore } from './code.js';
import { ConnectionStore, inspectFolder, pickFolder } from './connection.js';
import { DevServer } from './devserver.js';
import { atomicWrite, readPrivate } from './files.js';
import { readProjectTokens, writeProjectTokens } from './projectTokens.js';
import { BATCH, PublishCounter, gitStatus, publish } from './gitops.js';
import {
  figmaComponents,
  figmaImage,
  figmaNode,
  figmaVariables,
  variablesToTokens,
} from '../../connectors/figma/library.js';
import { unvalidatedAdapter } from '../../connectors/agents/unvalidated.js';
import type { AgentAdapter } from '../../connectors/agents/types.js';
import { figmaStatus } from '../../connectors/figma/contract.js';
import { FigmaReader, figmaFileKey } from '../../connectors/figma/reader.js';
import type { RecordInfo } from '../../scripts/runtime.mjs';

export async function createStudioServer(options: {
  root: string;
  store: Store;
  agent?: AgentAdapter;
  claude?: AgentAdapter;
  ask?: Ask;
  figma?: FigmaReader;
  dev?: boolean;
  control?: { record: RecordInfo; stop: () => void };
}) {
  const { root } = options;
  // Données communes (connexion, brief, tableau de bord) dans base ; tokens,
  // historique et Preview dans un dossier par projet ouvert.
  const base = options.store;
  let store = base;
  const adapters: Record<string, AgentAdapter> = {
    codex: options.agent ?? new CodexAdapter(),
    claude: options.claude ?? new ClaudeAdapter(),
    gemini: unvalidatedAdapter('gemini'),
  };
  const project = new ProjectStore(store.directory);
  const dashboard = new DashboardStore(store.directory, root);
  const code = new CodeStore(root, store.directory);
  const connection = new ConnectionStore(store.directory);
  const publishCounter = new PublishCounter(store.directory);
  // Une modification validée de plus dans le projet ouvert.
  const countChange = async () => {
    const project = (await connection.status()).project;
    if (project) await publishCounter.add(project.folder);
  };
  // Clodo écrit dans le projet ouvert, et seulement dedans ; sans projet, il
  // garde son périmètre historique sur l'interface de DS-Studio.
  const projectCode = new Map<string, CodeStore>();
  const devServer = new DevServer();
  const projectStores = new Map<string, Store>();
  const useProject = async (folder: string | undefined) => {
    if (!folder) return void (store = base);
    const cached = projectStores.get(folder);
    if (cached) return void (store = cached);
    const projects = path.join(base.directory, 'projects');
    const firstEver = !(await fs.stat(projects).catch(() => undefined));
    const dir = path.join(
      projects,
      createHash('sha256').update(folder).digest('hex').slice(0, 16),
    );
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    // Premier projet ouvert : il reprend le DS déjà construit, rien n'est perdu.
    if (firstEver)
      for (const name of ['state.json', 'state.previous.json', 'preview.json'])
        await fs
          .copyFile(path.join(base.directory, name), path.join(dir, name))
          .catch(() => undefined);
    const next = base.sibling(dir);
    await next.init();
    projectStores.set(folder, next);
    store = next;
  };
  await useProject((await connection.status()).project?.folder);
  // Fichier Figma : celui du projet ouvert, sinon le brief, sinon la roadmap.
  const figmaUrl = async () =>
    (await connection.read()).figmaUrl ||
    (await project.read()).project.figmaUrl ||
    (await readRoadmap(root)
      .then((r) => r.links.find((l) => l.url.includes('figma.com'))?.url)
      .catch(() => undefined));
  const workspace = async () => {
    const project = (await connection.status()).project;
    if (!project) return { code, project: undefined };
    let scoped = projectCode.get(project.folder);
    if (!scoped) {
      scoped = new CodeStore(project.folder, store.directory, true);
      projectCode.set(project.folder, scoped);
    }
    return { code: scoped, project: project.name };
  };
  const claudeCli = new ClaudeAdapter();
  const ask: Ask = options.ask ?? ((...a) => claudeCli.ask(...a));
  const figma = options.figma ?? new FigmaReader(undefined);
  const csrf = randomBytes(32).toString('hex');
  // Code d'appairage du plugin Figma : affiché dans DS-Studio, collé dans le
  // plugin, gardé sur ce poste ; on peut le renouveler pour couper l'accès.
  const pluginFile = path.join(base.directory, 'plugin.json');
  const pluginToken = async (renew = false) => {
    if (!renew) {
      const saved = await readPrivate(pluginFile, 1000)
        .then((raw) => String(JSON.parse(raw).token ?? ''))
        .catch(() => '');
      if (/^[0-9a-f]{32}$/.test(saved)) return saved;
    }
    const token = randomBytes(16).toString('hex');
    await atomicWrite(pluginFile, JSON.stringify({ token }) + '\n');
    return token;
  };
  const pluginAllowed = async (given: unknown) => {
    const expected = Buffer.from(await pluginToken());
    const sent = Buffer.from(typeof given === 'string' ? given : '');
    return sent.length === expected.length && timingSafeEqual(sent, expected);
  };
  let busy = false;
  const active = new Set<AbortController>();
  const vite = options.dev
    ? await (
        await import('vite')
      ).createServer({
        root,
        server: { middlewareMode: true, host: '127.0.0.1' },
        appType: 'spa',
      })
    : null;
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const origin = `http://127.0.0.1:${port}`;
    const send = (status: number, value: unknown) => {
      if (!res.destroyed) {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(value));
      }
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${options.dev ? ' ws://127.0.0.1:*' : ''}; frame-src 'self' http://localhost:* http://127.0.0.1:*; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`,
    );
    try {
      // Plugin Figma : seule entrée acceptée depuis une autre origine (« null »,
      // l'iframe du plugin), en lecture seule, avec le code d'appairage.
      // Figma n'accepte que « localhost » dans le manifeste du plugin : cette
      // route seule accepte aussi cet hôte, toujours sur la boucle locale.
      if (
        req.url?.split('?')[0] === '/api/plugin/sync' &&
        (req.headers.host === `127.0.0.1:${port}` ||
          req.headers.host === `localhost:${port}`)
      ) {
        res.setHeader('Access-Control-Allow-Origin', 'null');
        res.setHeader('Access-Control-Allow-Headers', 'X-DS-Plugin');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }
        if (
          req.method !== 'GET' ||
          !(await pluginAllowed(req.headers['x-ds-plugin']))
        )
          throw new StudioError('Code d’appairage du plugin invalide.', 403);
        const saved = await connection.read();
        const state = store.snapshot();
        return send(200, {
          project: (await connection.status()).project?.name ?? null,
          figmaFileKey: figmaFileKey(saved.figmaUrl) ?? null,
          revision: state.revision,
          tokens: state.tokens,
        });
      }
      if (req.headers.host !== `127.0.0.1:${port}`)
        throw new StudioError(
          'Hôte refusé. Utilisez l’adresse 127.0.0.1 affichée au démarrage.',
          403,
        );
      if (req.headers.origin && req.headers.origin !== origin)
        throw new StudioError('Origine non autorisée.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw new StudioError('Requête externe refusée.', 403);
      const url = new URL(req.url ?? '/', origin);
      if (url.pathname.startsWith('/_studio/')) {
        const control = options.control;
        if (
          !control ||
          req.headers['x-studio-control'] !== control.record.token
        )
          throw new StudioError('Contrôle privé refusé.', 403);
        const { token: _token, ...identity } = control.record;
        if (url.pathname === '/_studio/health' && req.method === 'GET')
          return send(200, identity);
        if (url.pathname === '/_studio/stop' && req.method === 'POST') {
          send(200, identity);
          setImmediate(control.stop);
          return;
        }
        throw new StudioError('Route inconnue.', 404);
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET') {
          if (url.pathname === '/api/bootstrap')
            return send(200, {
              csrf,
              figma: figmaStatus,
              agents: [],
            });
          if (url.pathname === '/api/agents')
            return send(
              200,
              await Promise.all(
                Object.values(adapters).map(async (a) => ({
                  id: a.id,
                  ...(await a.status()),
                })),
              ),
            );
          if (url.pathname === '/api/project')
            return send(200, await project.read());
          if (url.pathname === '/api/figma')
            return send(200, await figma.status(await figmaUrl()));
          // Lecture Figma du projet ouvert : composants, nœud, rendu, variables.
          if (url.pathname === '/api/project-tokens') {
            const project = (await connection.status()).project;
            if (!project)
              throw new StudioError('Ouvrez d’abord un projet.', 409);
            return send(200, await readProjectTokens(project.folder));
          }
          if (url.pathname === '/api/figma/components')
            return send(200, await figmaComponents(figma, await figmaUrl()));
          if (url.pathname === '/api/figma/node')
            return send(
              200,
              await figmaNode(
                figma,
                await figmaUrl(),
                url.searchParams.get('id') ?? '',
              ),
            );
          if (url.pathname === '/api/figma/variables') {
            const read = await figmaVariables(figma, await figmaUrl());
            return send(200, { ...read, ...variablesToTokens(read.items) });
          }
          if (url.pathname === '/api/figma/image') {
            const png = await figmaImage(
              figma,
              await figmaUrl(),
              url.searchParams.get('id') ?? '',
            );
            res.writeHead(200, { 'Content-Type': 'image/png' });
            return res.end(png);
          }
          if (url.pathname === '/api/clodo')
            return send(200, await dashboard.readClodo());
          if (url.pathname === '/api/preview')
            return send(200, await dashboard.readPreview(store.directory));
          if (url.pathname === '/api/connection')
            return send(200, await connection.status());
          if (url.pathname === '/api/plugin/pairing')
            return send(200, {
              token: await pluginToken(),
              manifest: path.join(root, 'figma-plugin', 'manifest.json'),
            });
          if (url.pathname === '/api/git/status') {
            const project = (await connection.status()).project;
            if (!project)
              throw new StudioError('Ouvrez d’abord un projet.', 409);
            return send(200, {
              ...(await gitStatus(project.folder)),
              pending: await publishCounter.get(project.folder),
              batch: BATCH,
            });
          }
          if (url.pathname === '/api/project-dev') {
            const project = (await connection.status()).project;
            return send(
              200,
              project
                ? await devServer.readFor(project.folder)
                : devServer.read(),
            );
          }
          if (url.pathname === '/api/code/last')
            return send(200, await (await workspace()).code.last());
          if (url.pathname === '/api/roadmap')
            return send(200, await readRoadmap(root));
          if (url.pathname === '/api/dashboard')
            return send(200, await dashboard.read('dashboard'));
          if (url.pathname === '/api/atelier')
            return send(200, await dashboard.read('atelier'));
          if (url.pathname === '/api/checklist')
            return send(200, await dashboard.readChecklist());
          if (url.pathname === '/api/state') return send(200, store.snapshot());
          if (url.pathname === '/api/export')
            return send(200, store.snapshot().tokens);
          throw new StudioError('Route inconnue.', 404);
        }
        if (req.method !== 'POST')
          throw new StudioError('Méthode non autorisée.', 405);
        if (req.headers['x-ds-studio'] !== csrf)
          throw new StudioError(
            'Validation de session manquante. Rechargez la page.',
            403,
          );
        if (!req.headers['content-type']?.startsWith('application/json'))
          throw new StudioError('JSON requis.', 415);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 128_000)
            throw new StudioError('Requête trop volumineuse.', 413);
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new StudioError('JSON invalide.');
        }
        if (url.pathname === '/api/project') {
          const b = z
            .object({ base: z.string().max(64), project: projectSchema })
            .strict()
            .parse(body);
          return send(200, await project.save(b.base, b.project));
        }
        if (url.pathname === '/api/dashboard')
          return send(200, await dashboard.save('dashboard', body));
        if (url.pathname === '/api/atelier')
          return send(200, await dashboard.save('atelier', body));
        if (url.pathname === '/api/checklist')
          return send(
            200,
            await dashboard.saveChecklist(checklistSchema.parse(body)),
          );
        if (url.pathname === '/api/proposals') {
          const b = proposeSchema.parse(body);
          return send(200, store.propose(b.revision, b.changes));
        }
        if (url.pathname === '/api/import') {
          const b = z
            .object({
              revision: z.number().int().nonnegative(),
              tokens: z.unknown(),
            })
            .strict()
            .parse(body);
          return send(200, store.proposeImport(b.revision, b.tokens));
        }
        if (url.pathname === '/api/undo') {
          const b = z
            .object({
              revision: z.number().int().nonnegative(),
              id: z.string().uuid(),
            })
            .strict()
            .parse(body);
          return send(200, store.proposeUndo(b.revision, b.id));
        }
        if (url.pathname === '/api/commit') {
          const b = z.object({ id: z.string().uuid() }).strict().parse(body);
          const next = await store.commit(b.id);
          // Projet ouvert : le token validé part aussi dans son fichier DTCG.
          const project = (await connection.status()).project;
          if (project && store !== base)
            await writeProjectTokens(project.folder, next.tokens).catch((e) =>
              console.error('Écriture des tokens du projet impossible :', e),
            );
          await countChange();
          return send(200, next);
        }
        // Code : Clodo propose, l'étudiante valide le diff, le serveur écrit.
        if (url.pathname === '/api/clodo')
          return send(200, await dashboard.saveClodo(body));
        if (url.pathname === '/api/preview')
          return send(200, await dashboard.savePreview(body, store.directory));
        // Projet ouvert : dossier Git local et fichier Figma, choisis par l'étudiante.
        if (url.pathname === '/api/connection') {
          const before = (await connection.read()).folder;
          const saved = await connection.save(body);
          // Autre projet : son propre DS, et le serveur de dev de l'ancien s'arrête.
          if (saved.project?.folder !== before) {
            devServer.stop();
            await useProject(saved.project?.folder);
          }
          return send(200, saved);
        }
        // Serveur de dev du projet ouvert : lancé et arrêté au clic, jamais seul.
        if (url.pathname === '/api/project-dev/start') {
          const project = (await connection.status()).project;
          if (!project) throw new StudioError('Ouvrez d’abord un projet.', 409);
          return send(200, await devServer.start(project.folder));
        }
        if (url.pathname === '/api/project-dev/install') {
          const project = (await connection.status()).project;
          if (!project) throw new StudioError('Ouvrez d’abord un projet.', 409);
          return send(200, await devServer.install(project.folder));
        }
        // Tokens du projet ajoutés ou mis à jour par le diff habituel ; les
        // tokens déjà présents dans DS-Studio ne sont jamais supprimés ici.
        if (url.pathname === '/api/project-tokens/import') {
          const b = z
            .object({ revision: z.number().int().nonnegative() })
            .strict()
            .parse(body);
          const project = (await connection.status()).project;
          if (!project) throw new StudioError('Ouvrez d’abord un projet.', 409);
          const { tokens } = await readProjectTokens(project.folder);
          return send(
            200,
            store.proposeImport(b.revision, {
              ...store.snapshot().tokens,
              ...tokens,
            }),
          );
        }
        if (url.pathname === '/api/plugin/pairing/renew')
          return send(200, {
            token: await pluginToken(true),
            manifest: path.join(root, 'figma-plugin', 'manifest.json'),
          });
        // Commit et push du projet ouvert, après l'accord donné dans le chat.
        if (url.pathname === '/api/git/publish') {
          const b = z
            .object({ message: z.string().trim().min(1).max(500) })
            .strict()
            .parse(body);
          const project = (await connection.status()).project;
          if (!project) throw new StudioError('Ouvrez d’abord un projet.', 409);
          const pending = await publishCounter.get(project.folder);
          if (pending < BATCH)
            throw new StudioError(
              `Pas encore : ${pending}/${BATCH} modifications validées. La publication est proposée à ${BATCH}.`,
              409,
            );
          const done = await publish(project.folder, b.message);
          // Push refusé : le compteur reste plein, on pourra réessayer.
          await publishCounter.reset(project.folder);
          return send(200, done);
        }
        if (url.pathname === '/api/project-dev/stop')
          return send(200, devServer.stop());
        if (url.pathname === '/api/connection/pick')
          return send(200, { folder: await pickFolder() });
        // Vérifications avant enregistrement : rien n'est écrit.
        if (url.pathname === '/api/connection/inspect') {
          const b = z
            .object({ folder: z.string().min(1).max(1000) })
            .strict()
            .parse(body);
          return send(200, await inspectFolder(b.folder));
        }
        if (url.pathname === '/api/connection/figma') {
          const b = z
            .object({ url: z.string().max(500) })
            .strict()
            .parse(body);
          return send(200, await figma.status(b.url));
        }
        if (url.pathname === '/api/code/apply') {
          const b = z.object({ id: z.string().uuid() }).strict().parse(body);
          const applied = await (await workspace()).code.apply(b.id);
          await countChange();
          return send(200, applied);
        }
        if (url.pathname === '/api/code/revert') {
          const b = z.object({ id: z.string().uuid() }).strict().parse(body);
          return send(200, await (await workspace()).code.revert(b.id));
        }
        if (url.pathname === '/api/code') {
          const b = z
            .object({
              message: z.string().trim().min(1).max(8000),
              history: z
                .array(
                  z
                    .object({
                      role: z.enum(['user', 'assistant']),
                      text: z.string().max(12000),
                    })
                    .strict(),
                )
                .max(10),
              focus: focusSchema.optional(),
            })
            .strict()
            .parse(body);
          if (busy)
            throw new StudioError('Une demande IA est déjà en cours.', 429);
          busy = true;
          const controller = new AbortController();
          active.add(controller);
          const cancel = () => controller.abort();
          res.once('close', cancel);
          try {
            const scope = await workspace();
            const { changes, ...reply } = await proposeCode(
              ask,
              scope.code,
              b.message,
              b.history,
              controller.signal,
              b.focus,
              store.snapshot().tokens,
              scope.project,
              // Figma lu par le serveur, seulement si un fichier est relié.
              figma.hasToken && (await figmaUrl())
                ? {
                    components: await figmaComponents(
                      figma,
                      await figmaUrl(),
                    ).catch(() => []),
                    node: async (id) => figmaNode(figma, await figmaUrl(), id),
                  }
                : undefined,
            );
            // Clodo a choisi des tokens : même diff et même validation qu'à la main.
            const tokenProposal = changes?.length
              ? store.propose(store.snapshot().revision, changes, 'claude')
              : null;
            return send(200, { ...reply, tokenProposal });
          } finally {
            busy = false;
            active.delete(controller);
            res.off('close', cancel);
          }
        }
        if (url.pathname === '/api/agent') {
          const b = z
            .object({
              agent: z.enum(['codex', 'claude', 'gemini']),
              message: z.string().trim().min(1).max(8000),
              revision: z.number().int().nonnegative(),
              history: z
                .array(
                  z
                    .object({
                      role: z.enum(['user', 'assistant']),
                      text: z.string().max(12000),
                    })
                    .strict(),
                )
                .max(10),
              focus: focusSchema.optional(),
            })
            .strict()
            .parse(body);
          if (b.revision !== store.snapshot().revision)
            throw new StudioError(
              'DS modifié depuis votre dernier affichage. Réessayez.',
              409,
            );
          if (busy)
            throw new StudioError('Une demande IA est déjà en cours.', 429);
          busy = true;
          const controller = new AbortController();
          active.add(controller);
          const cancel = () => controller.abort();
          res.once('close', cancel);
          try {
            const context = async (name: string) => {
              const file = path.join(root, 'workspace', name);
              const stat = await fs.lstat(file);
              if (stat.isSymbolicLink() || stat.size > 32_000)
                throw new StudioError(
                  `Contexte ${name} refusé (lien ou taille).`,
                );
              return fs.readFile(file, 'utf8');
            };
            const reply = await adapters[b.agent].reply(
              b.message,
              {
                tokens: store.snapshot().tokens,
                brief:
                  (await context('PFE.md')) +
                  '\nBrief privé DS-Studio :\n' +
                  JSON.stringify((await project.read()).project) +
                  // Roadmap résumée, sans liens : facultative si le fichier manque.
                  '\nRoadmap PFE :\n' +
                  (await readRoadmap(root)
                    .then((r) =>
                      JSON.stringify({
                        project: r.project,
                        steps: r.steps.map(
                          ({ title, phase, status, start, end }) => ({
                            title,
                            phase,
                            status,
                            start,
                            end,
                          }),
                        ),
                      }),
                    )
                    .catch(() => 'indisponible')),
                rules: await context('DESIGN_RULES.md'),
                history: b.history,
                focus: b.focus,
              },
              controller.signal,
            );
            const proposal = reply.changes.length
              ? store.propose(
                  b.revision,
                  reply.changes,
                  b.agent === 'claude' ? 'claude' : 'codex',
                )
              : null;
            return send(200, { message: reply.message, proposal });
          } finally {
            busy = false;
            active.delete(controller);
            res.off('close', cancel);
          }
        }
        throw new StudioError('Route inconnue.', 404);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD')
        throw new StudioError('Méthode non autorisée.', 405);
      if (vite) {
        const allowed = [
          '/app/client/',
          '/app/shared/',
          '/node_modules/',
          '/@vite/',
          '/@id/',
        ];
        if (
          url.pathname !== '/' &&
          url.pathname !== '/index.html' &&
          !allowed.some((prefix) => url.pathname.startsWith(prefix))
        )
          throw new StudioError('Source privée non distribuée.', 403);
        vite.middlewares(req, res);
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('..') || pathname.includes('\\'))
        throw new StudioError('Chemin refusé.', 403);
      let file: string;
      if (pathname.startsWith('/assets/'))
        file = path.join(root, 'dist', pathname);
      else if (pathname === '/' || pathname === '/index.html')
        file = path.join(root, 'dist', 'index.html');
      else throw new StudioError('Fichier introuvable.', 404);
      const data = await fs.readFile(file);
      const ext = path.extname(file);
      res.setHeader(
        'Content-Type',
        (
          {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.svg': 'image/svg+xml',
          } as Record<string, string>
        )[ext] ?? 'application/octet-stream',
      );
      res.end(data);
    } catch (error) {
      if (error instanceof z.ZodError)
        return send(400, {
          error:
            'Données invalides : ' +
            error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
        });
      if (error instanceof StudioError)
        return send(error.status, { error: error.message });
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return send(404, {
          error: 'Fichier introuvable. Exécutez npm run build avant npm start.',
        });
      return send(500, { error: urlSafeMessage(error) });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {
    server,
    close: async () => {
      for (const c of active) c.abort();
      devServer.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await vite?.close();
    },
  };
}
function urlSafeMessage(error: unknown) {
  // Les erreurs agent sont rédigées dans l'adaptateur, jamais de stderr brut ni de stack.
  const message = (error as Error).message ?? '';
  if (
    /^(CLI |Codex |Claude Code |Version non|Échec Codex|Échec Claude Code|Délai CLI|Demande interrompue|Le CLI|Réponse CLI|Réponse Claude Code|Passage |Fichier |Chemin refusé|Trop de modifications|Aucune modification|claude non|gemini non|Impossible de démarrer)/.test(
      message,
    )
  )
    return message;
  return 'Opération impossible. Aucune validation automatique. Vérifiez les données et relancez si nécessaire.';
}
