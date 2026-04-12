import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { ContextMapEdge, ContextMapNode, ContextMapPriority } from '../../types/context-map';
import { attachmentRegistry } from './attachment-registry';
import { PRESET_ATTACHABLES } from './preset-attachables';
import {
  deleteEdge,
  deleteNode,
  ensureContextMap,
  exportContextDigest,
  searchNodes,
  upsertEdge,
  upsertNode,
  writeContextMap,
  syncSessionNode,
} from './store';

interface AttachRequest {
  attachableId: string;
  sessionId: string;
  injectMode?: 'system' | 'prefix' | 'suffix';
  priority?: ContextMapPriority;
}

function registerHandler(channel: string, handler: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

function isContextMapNodeType(value: unknown): value is ContextMapNode['type'] {
  return typeof value === 'string' && [
    'concept',
    'file',
    'pattern',
    'constraint',
    'goal',
    'decision',
    'reference',
    'person',
    'question',
    'instruction',
    'persona-mod',
    'context-snippet',
    'checklist',
    'session',
  ].includes(value);
}

export function registerContextMapIpcHandlers(mainWindow: BrowserWindow): void {
  registerHandler('context-map:get-all', async (_event, projectPath: string) => {
    const map = await ensureContextMap(projectPath);
    await attachmentRegistry.refresh(projectPath);
    return map;
  });

  registerHandler('context-map:upsert-node', async (_event, projectPath: string, node: Partial<ContextMapNode> & Pick<ContextMapNode, 'label' | 'type'>) => {
    const saved = await upsertNode(projectPath, node);
    await attachmentRegistry.refresh(projectPath);
    return saved;
  });

  registerHandler('context-map:delete-node', async (_event, projectPath: string, nodeId: string) => {
    await deleteNode(projectPath, nodeId);
    await attachmentRegistry.refresh(projectPath);
  });

  registerHandler('context-map:upsert-edge', async (_event, projectPath: string, edge: Partial<ContextMapEdge> & Pick<ContextMapEdge, 'from' | 'to'>) => {
    return upsertEdge(projectPath, edge);
  });

  registerHandler('context-map:delete-edge', async (_event, projectPath: string, edgeId: string) => {
    await deleteEdge(projectPath, edgeId);
  });

  registerHandler('context-map:search', async (_event, projectPath: string, query: string) => {
    return searchNodes(projectPath, query);
  });

  registerHandler('context-map:export-text', async (_event, projectPath: string, opts?: { roleId?: string; sessionId?: string; limit?: number }) => {
    return exportContextDigest(projectPath, opts);
  });

  registerHandler('context-map:upsert-session-node', async (
    _event,
    projectPath: string,
    payload: { sessionId: string; label: string; status: 'running' | 'completed' | 'stopped'; roleId?: string },
  ) => {
    return syncSessionNode(projectPath, payload);
  });

  registerHandler('context-map:preset-attachables', async () => PRESET_ATTACHABLES);

  registerHandler('attachable:attach', async (_event, projectPath: string, req: AttachRequest) => {
    if (req.injectMode || req.priority) {
      const map = await ensureContextMap(projectPath);
      const node = map.nodes.find(n => n.id === req.attachableId);
      if (node) {
        if (req.injectMode) node.injectMode = req.injectMode;
        if (req.priority) node.priority = req.priority;
        node.updatedAt = new Date().toISOString();
        await writeContextMap(projectPath, map);
      }
    }
    await attachmentRegistry.attach(projectPath, req.attachableId, req.sessionId, 'user');
    mainWindow.webContents.send('heliox:attachable-updated', {
      type: 'attached',
      attachableId: req.attachableId,
      sessionId: req.sessionId,
    });
  });

  registerHandler('attachable:detach', async (_event, projectPath: string, attachableId: string, sessionId: string) => {
    await attachmentRegistry.detach(projectPath, attachableId, sessionId);
    mainWindow.webContents.send('heliox:attachable-updated', {
      type: 'detached',
      attachableId,
      sessionId,
    });
  });

  registerHandler('attachable:update', async (_event, projectPath: string, attachableId: string, body: string) => {
    const map = await ensureContextMap(projectPath);
    const existing = map.nodes.find(n => n.id === attachableId);
    const nodeType = isContextMapNodeType(existing?.type) ? existing.type : 'instruction';
    const label = existing?.label ?? 'Attachable';
    const source = existing?.source ?? 'user';

    const node = await upsertNode(projectPath, {
      id: attachableId,
      type: nodeType,
      label,
      body,
      source,
    });
    await attachmentRegistry.refresh(projectPath);
    const sessions = (node.attachments ?? []).filter(a => a.active).map(a => a.sessionId);
    mainWindow.webContents.send('heliox:attachable-updated', {
      type: 'updated',
      attachableId,
      affectedSessions: sessions,
    });
  });

  registerHandler('attachable:list', async (_event, sessionId: string) => {
    return attachmentRegistry.listForSession(sessionId);
  });

  registerHandler('attachable:list-active', async () => {
    return attachmentRegistry.listAll();
  });
}
