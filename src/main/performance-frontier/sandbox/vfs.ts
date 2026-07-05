import { Volume } from 'memfs';
import { dirname, posix } from 'path';
import type { McpFileSystem } from '../../harness-engine/mcp-adapter';

export const PF_WORKSPACE_ROOT = '/workspace' as const;

export type VfsSnapshot = Record<string, string>;

export interface PerformanceVfs extends McpFileSystem {
  snapshot: () => VfsSnapshot;
  destroy: () => void;
}

export type InitialVfsFiles = Record<string, string>;

function toWorkspacePath(path: string): string {
  const normalized = path.startsWith('/') ? path : posix.join(PF_WORKSPACE_ROOT, path);
  return posix.normalize(normalized);
}

export function createPerformanceVfs(initialFiles: InitialVfsFiles = {}): PerformanceVfs {
  const volume = new Volume();
  volume.mkdirSync(PF_WORKSPACE_ROOT, { recursive: true });

  const files = Object.fromEntries(
    Object.entries(initialFiles).map(([path, content]) => [toWorkspacePath(path), content]),
  );
  volume.fromJSON(files);

  return {
    mkdir: (path, options) => volume.promises.mkdir(path, options),
    readdir: (path) => volume.promises.readdir(path) as Promise<string[]>,
    readFile: (path, encoding) => volume.promises.readFile(path, encoding) as Promise<string>,
    stat: async (path) => {
      const entryStat = await volume.promises.stat(path);
      return {
        isDirectory: () => entryStat.isDirectory(),
        isFile: () => entryStat.isFile(),
        size: Number(entryStat.size),
      };
    },
    writeFile: async (path, content, encoding) => {
      await volume.promises.mkdir(dirname(path), { recursive: true });
      await volume.promises.writeFile(path, content, { encoding });
    },
    snapshot: () => {
      const raw = volume.toJSON(PF_WORKSPACE_ROOT);
      const snapshot: VfsSnapshot = {};
      for (const [path, content] of Object.entries(raw)) {
        if (content !== null) snapshot[path] = content;
      }
      return snapshot;
    },
    destroy: () => volume.reset(),
  };
}
