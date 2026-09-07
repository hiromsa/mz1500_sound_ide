import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  sanitizeTreeForStorage, 
  saveWorkspaceFolder, 
  loadWorkspaceFolder, 
  clearWorkspaceFolder 
} from '../workspaceStorage';
import type { FileItem } from '../../view/FileExplorer';

describe('workspaceStorage', () => {
  const dummyTree: FileItem[] = [
    {
      id: 'root-1',
      name: 'my_project',
      isFolder: true,
      isOpen: true,
      children: [
        {
          id: 'file-1',
          name: 'song.mml',
          isFolder: false,
          content: 'C D E F G',
          file: new File(['C D E F G'], 'song.mml'),
        },
      ],
    },
  ];

  it('sanitizeTreeForStorage correctly strips File objects and retains content', () => {
    const sanitized = sanitizeTreeForStorage(dummyTree);
    expect(sanitized[0].name).toBe('my_project');
    expect(sanitized[0].children?.[0].name).toBe('song.mml');
    expect(sanitized[0].children?.[0].content).toBe('C D E F G');
    expect((sanitized[0].children?.[0] as any).file).toBeUndefined();
  });

  describe('localStorage fallback operations', () => {
    let mockStorage: Record<string, string> = {};

    beforeEach(() => {
      mockStorage = {};
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, val: string) => { mockStorage[key] = val; },
        removeItem: (key: string) => { delete mockStorage[key]; },
        clear: () => { mockStorage = {}; },
      });
      // indexedDB を未定義にして localStorage フォールバックを強制検証
      vi.stubGlobal('indexedDB', undefined);
    });

    it('saves and loads workspace folder via fallback', async () => {
      await saveWorkspaceFolder('my_project', dummyTree);
      const loaded = await loadWorkspaceFolder();
      expect(loaded).not.toBeNull();
      expect(loaded?.folderName).toBe('my_project');
      expect(loaded?.tree[0].name).toBe('my_project');
      expect(loaded?.tree[0].children?.[0].content).toBe('C D E F G');
    });

    it('clears workspace folder via fallback', async () => {
      await saveWorkspaceFolder('my_project', dummyTree);
      await clearWorkspaceFolder();
      const loaded = await loadWorkspaceFolder();
      expect(loaded).toBeNull();
    });
  });
});
