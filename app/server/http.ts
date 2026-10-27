import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { proposeSchema } from '../shared/model.js';
import { Store, StudioError } from './store.js';
import { ProjectStore } from './project.js';
import { projectSchema } from '../shared/project.js';
import { DashboardStore, readRoadmap } from './dashboard.js';
import { checklistSchema } from '../shared/dashboard.js';
import { CodexAdapter } from '../../connectors/agents/codex.js';
import { ClaudeAdapter } from '../../connectors/agents/claude.js';
import { proposeCode, type Ask } from '../../connectors/agents/coder.js';
import { CodeStore } from './code.js';
import { unvalidatedAdapter } from '../../connectors/agents/unvalidated.js';
import type { AgentAdapter } from '../../connectors/agents/types.js';
import { figmaStatus } from '../../connectors/figma/contract.js';
import { FigmaReader } from '../../connectors/figma/reader.js';
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
  const { root, store } = options;
  const adapters: Record<string, AgentAdapter> = {
    codex: options.agent ?? new CodexAdapter(),
    claude: options.claude ?? new ClaudeAdapter(),
    gemini: unvalidatedAdapter('gemini'),
  };
  const project = new ProjectStore(store.directory);
  const dashboard = new DashboardStore(store.directory, root);
  const code = new CodeStore(root, store.directory);
  const claudeCli = new ClaudeAdapter();
  const ask: Ask = options.ask ?? ((...a) => claudeCli.ask(...a));
  const figma = options.figma ?? new FigmaReader(undefined);
  const csrf = randomBytes(32).toString('hex');
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
      `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${options.dev ? ' ws://127.0.0.1:*' : ''}; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`,
    );
    try {
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
          if (url.pathname === '/api/figma') {
            // Fichier : lien du brief privé, sinon lien Figma de la roadmap.
            const brief = (await project.read()).project.figmaUrl;
            const fromRoadmap = await readRoadmap(root)
              .then(
                (r) => r.links.find((l) => l.url.includes('figma.com'))?.url,
              )
              .catch(() => undefined);
            return send(200, await figma.status(brief || fromRoadmap));
          }
          if (url.pathname === '/api/clodo')
            return send(200, await dashboard.readClodo());
          if (url.pathname === '/api/code/last')
            return send(200, await code.last());
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
          return send(200, await store.commit(b.id));
        }
        // Code : Clodo propose, l'étudiante valide le diff, le serveur écrit.
        if (url.pathname === '/api/clodo')
          return send(200, await dashboard.saveClodo(body));
        if (url.pathname === '/api/code/apply') {
          const b = z.object({ id: z.string().uuid() }).strict().parse(body);
          return send(200, await code.apply(b.id));
        }
        if (url.pathname === '/api/code/revert') {
          const b = z.object({ id: z.string().uuid() }).strict().parse(body);
          return send(200, await code.revert(b.id));
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
            return send(
              200,
              await proposeCode(
                ask,
                code,
                b.message,
                b.history,
                controller.signal,
              ),
            );
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
