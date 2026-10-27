import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  atelierIds,
  atelierLayoutSchema,
  checklistSchema,
  clodoSchema,
  defaultClodo,
  defaultPreview,
  previewSchema,
  type PreviewConfig,
  defaultAtelierLayout,
  defaultLayout,
  layoutSchema,
  roadmapSchema,
  widgetIds,
  type Checklist,
  type ClodoPosition,
} from '../shared/dashboard.js';
import { atomicWrite, readPrivate } from './files.js';
import { StudioError } from './store.js';

// Anciennes tailles (V1 du tableau de bord) converties en colonnes.
const legacySpans: Record<string, number> = { s: 4, m: 8, l: 12 };
const boards = {
  dashboard: {
    file: 'dashboard.json',
    schema: layoutSchema,
    ids: widgetIds as readonly string[],
    fallback: defaultLayout,
  },
  atelier: {
    file: 'atelier.json',
    schema: atelierLayoutSchema,
    ids: atelierIds as readonly string[],
    fallback: defaultAtelierLayout,
  },
};
export type BoardName = keyof typeof boards;

// Dispositions et checklist : état privé du poste, comme le brief.
export class DashboardStore {
  private queue: Promise<unknown> = Promise.resolve();
  private checklistFile: string;
  constructor(
    private directory: string,
    private root: string,
  ) {
    this.checklistFile = path.join(directory, 'checklist.json');
  }
  async read(name: BoardName) {
    const board = boards[name];
    try {
      const raw = JSON.parse(
        await readPrivate(path.join(this.directory, board.file), 16000),
      );
      // Les vues retirées d'une version précédente sont ignorées, pas refusées.
      const widgets = Array.isArray(raw?.widgets)
        ? raw.widgets
            .filter((w: { id?: string }) => board.ids.includes(w?.id ?? ''))
            .map(({ size, ...w }: { size?: string; span?: number }) =>
              size && w.span === undefined
                ? { ...w, span: legacySpans[size] }
                : w,
            )
        : raw?.widgets;
      return board.schema.parse({ ...raw, widgets });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return board.fallback;
      throw new StudioError(
        'Disposition invalide. Original préservé ; disposition par défaut affichée.',
        500,
      );
    }
  }
  async readChecklist(): Promise<Checklist> {
    try {
      return checklistSchema.parse(
        JSON.parse(await readPrivate(this.checklistFile, 64000)),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new StudioError('Checklist invalide. Original préservé.', 500);
      const roadmap = await readRoadmap(this.root);
      return roadmap.checklist.flatMap(({ group, items }) =>
        items.map((label) => ({ id: randomUUID(), group, label, done: false })),
      );
    }
  }
  private write<T>(file: string, value: T) {
    const work = this.queue.then(async () => {
      await atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
      return value;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  save(name: BoardName, layout: unknown) {
    const board = boards[name];
    return this.write(
      path.join(this.directory, board.file),
      board.schema.parse(layout),
    );
  }
  async readClodo(): Promise<ClodoPosition> {
    try {
      return clodoSchema.parse(
        JSON.parse(
          await readPrivate(path.join(this.directory, 'clodo.json'), 1000),
        ),
      );
    } catch {
      return defaultClodo;
    }
  }
  saveClodo(position: unknown) {
    return this.write(
      path.join(this.directory, 'clodo.json'),
      clodoSchema.parse(position),
    );
  }
  async readPreview(): Promise<PreviewConfig> {
    try {
      return previewSchema.parse(
        JSON.parse(
          await readPrivate(path.join(this.directory, 'preview.json'), 20_000),
        ),
      );
    } catch {
      return defaultPreview;
    }
  }
  savePreview(config: unknown) {
    return this.write(
      path.join(this.directory, 'preview.json'),
      previewSchema.parse(config),
    );
  }
  saveChecklist(checklist: Checklist) {
    return this.write(this.checklistFile, checklistSchema.parse(checklist));
  }
}
export async function readRoadmap(root: string) {
  try {
    return roadmapSchema.parse(
      JSON.parse(
        await readPrivate(
          path.join(root, 'workspace', 'roadmap.json'),
          200_000,
        ),
      ),
    );
  } catch {
    throw new StudioError(
      'Roadmap absente ou invalide (workspace/roadmap.json). Le reste de l’atelier fonctionne.',
      500,
    );
  }
}
