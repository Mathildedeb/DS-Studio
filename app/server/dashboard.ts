import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  checklistSchema,
  defaultLayout,
  layoutSchema,
  roadmapSchema,
  widgetIds,
  type Checklist,
  type Layout,
} from '../shared/dashboard.js';
import { atomicWrite, readPrivate } from './files.js';
import { StudioError } from './store.js';

// Disposition et checklist : état privé du poste, comme le brief.
export class DashboardStore {
  private queue: Promise<unknown> = Promise.resolve();
  private layoutFile: string;
  private checklistFile: string;
  constructor(
    directory: string,
    private root: string,
  ) {
    this.layoutFile = path.join(directory, 'dashboard.json');
    this.checklistFile = path.join(directory, 'checklist.json');
  }
  async read(): Promise<Layout> {
    try {
      const raw = JSON.parse(await readPrivate(this.layoutFile, 16000));
      // Les widgets retirés d'une version précédente sont ignorés, pas refusés.
      const known: string[] = [...widgetIds];
      return layoutSchema.parse({
        ...raw,
        widgets: Array.isArray(raw?.widgets)
          ? raw.widgets.filter((w: { id?: string }) => known.includes(w?.id!))
          : raw?.widgets,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaultLayout;
      throw new StudioError(
        'Disposition du tableau de bord invalide. Original préservé ; disposition par défaut affichée.',
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
  save(layout: Layout) {
    return this.write(this.layoutFile, layoutSchema.parse(layout));
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
