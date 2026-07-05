import { mkdir, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createSandboxNetwork, type SandboxNetworkMock } from './network';
import {
  createPerformanceVfs,
  type InitialVfsFiles,
  PF_WORKSPACE_ROOT,
  type PerformanceVfs,
  type VfsSnapshot,
} from './vfs';
import type { PFGeneratedArtifact } from '../types';

export interface PerformanceSandboxOptions {
  initialFiles?: InitialVfsFiles;
  networkMocks?: SandboxNetworkMock[];
}

export interface PerformanceSandbox {
  rootDir: typeof PF_WORKSPACE_ROOT;
  fileSystem: PerformanceVfs;
  fetch: ReturnType<typeof createSandboxNetwork>['fetch'];
  snapshot: () => VfsSnapshot;
  destroy: () => void;
}

export interface ExportSandboxArtifactsInput {
  runId: string;
  outputDir: string;
  vfsSnapshot: VfsSnapshot;
}

export interface ExportSandboxArtifactsResult {
  artifactsDir: string;
  files: PFGeneratedArtifact[];
}

function artifactRelativePath(vfsPath: string): string {
  if (vfsPath === PF_WORKSPACE_ROOT) return '.';
  if (vfsPath.startsWith(`${PF_WORKSPACE_ROOT}/`)) {
    return vfsPath.slice(PF_WORKSPACE_ROOT.length + 1);
  }
  return vfsPath.replace(/^\/+/, '');
}

function resolveArtifactPath(artifactsDir: string, vfsPath: string): string {
  const root = resolve(artifactsDir);
  const target = resolve(root, artifactRelativePath(vfsPath));
  const targetRelative = relative(root, target);
  if (targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
    throw new Error(`Refusing to export VFS path outside artifact root: ${vfsPath}`);
  }
  return target;
}

export async function exportSandboxArtifacts(
  input: ExportSandboxArtifactsInput,
): Promise<ExportSandboxArtifactsResult> {
  const artifactsDir = resolve(input.outputDir, 'artifacts', input.runId);
  const files: PFGeneratedArtifact[] = [];

  await mkdir(artifactsDir, { recursive: true });

  for (const [vfsPath, content] of Object.entries(input.vfsSnapshot).sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    const artifactPath = resolveArtifactPath(artifactsDir, vfsPath);
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, content, 'utf-8');
    files.push({
      vfsPath,
      artifactPath,
      fileUrl: pathToFileURL(artifactPath).href,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
    });
  }

  return { artifactsDir, files };
}

export function createPerformanceSandbox(
  options: PerformanceSandboxOptions = {},
): PerformanceSandbox {
  const fileSystem = createPerformanceVfs(options.initialFiles);
  const network = createSandboxNetwork(options.networkMocks);

  return {
    rootDir: PF_WORKSPACE_ROOT,
    fileSystem,
    fetch: network.fetch,
    snapshot: () => fileSystem.snapshot(),
    destroy: () => {
      fileSystem.destroy();
      network.destroy();
    },
  };
}
