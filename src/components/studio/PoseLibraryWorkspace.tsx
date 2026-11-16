import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import type { LanguageCode } from '../../../shared/studio';
import type { PoseCategory, PoseLibraryRecord } from '../../../shared/pose-raster';
import type { StudioStrings } from '../../lib/i18n';
import {
  deletePoseLibraryRecord,
  listPoseLibrary,
  reclassifyPoseLibraryRecord,
  updatePoseLibraryRecord,
  uploadPoseLibraryFile,
} from '../../lib/api';

interface UploadQueueItem {
  localId: string;
  file: File;
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  reservationId?: string;
  error?: string;
}

interface PoseLibraryWorkspaceProps {
  lang: LanguageCode;
  strings: StudioStrings;
  onUsePoseInStudio: (pose: PoseLibraryRecord) => void;
}

export const PoseLibraryWorkspace: React.FC<PoseLibraryWorkspaceProps> = ({
  lang,
  strings,
  onUsePoseInStudio,
}) => {
  const [items, setItems] = useState<PoseLibraryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | PoseCategory>('all');
  const [loading, setLoading] = useState(false);
  const [storageNotice, setStorageNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [autoClassify, setAutoClassify] = useState(true);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const listAbortRef = useRef<AbortController | null>(null);
  const uploadAbortMap = useRef<Map<string, AbortController>>(new Map());

  const refreshList = useCallback(
    async (targetPage = page, targetSearch = search, targetCategory = category) => {
      listAbortRef.current?.abort();
      const ctrl = new AbortController();
      listAbortRef.current = ctrl;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await listPoseLibrary({
          search: targetSearch,
          category: targetCategory,
          page: targetPage,
          pageSize: 12,
          signal: ctrl.signal,
        });
        if (!ctrl.signal.aborted) {
          setItems(res.items);
          setTotal(res.total);
          setPage(res.page);
          setTotalPages(res.totalPages);
          setStorageNotice(res.storageNotice);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setErrorMsg((err as Error).message);
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [page, search, category]
  );

  useEffect(() => {
    void refreshList(page, search, category);
    return () => listAbortRef.current?.abort();
  }, [page, search, category]);

  const runQueueItem = async (qItem: UploadQueueItem) => {
    const ctrl = new AbortController();
    uploadAbortMap.current.set(qItem.localId, ctrl);
    setQueue((prev) =>
      prev.map((x) => (x.localId === qItem.localId ? { ...x, status: 'uploading', error: undefined } : x))
    );

    try {
      const { reservationId } = await uploadPoseLibraryFile({
        file: qItem.file,
        reservationId: qItem.reservationId,
        autoClassify,
        signal: ctrl.signal,
      });
      setQueue((prev) =>
        prev.map((x) => (x.localId === qItem.localId ? { ...x, status: 'done', reservationId } : x))
      );
      void refreshList(1, search, category);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setQueue((prev) =>
          prev.map((x) => (x.localId === qItem.localId ? { ...x, status: 'cancelled' } : x))
        );
      } else {
        setQueue((prev) =>
          prev.map((x) =>
            x.localId === qItem.localId ? { ...x, status: 'error', error: (err as Error).message } : x
          )
        );
      }
    } finally {
      uploadAbortMap.current.delete(qItem.localId);
    }
  };

  const handleBatchUpload = async (files: File[]) => {
    const valid = files.filter((f) => /^image\/(png|jpeg|webp)$/i.test(f.type));
    if (valid.length === 0) {
      setErrorMsg('Select PNG, JPEG, or WebP images (max 12 MiB per image).');
      return;
    }

    const newItems: UploadQueueItem[] = valid.map((f) => ({
      localId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      status: 'queued',
    }));

    setQueue((prev) => [...newItems, ...prev].slice(0, 20));
    for (const item of newItems) {
      await runQueueItem(item);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--surface-0)] p-4 lg:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        {/* Header & Upload Dropzone */}
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-[var(--surface-1)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 max-w-2xl">
            <h2 className="font-display text-xl font-bold tracking-wide text-[var(--text-primary)]">
              {strings.nav.poseLibrary}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {strings.poseLibraryNotice}
            </p>
            {storageNotice && (
              <p className="font-mono-tech text-[11px] text-[var(--text-muted)]">{storageNotice}</p>
            )}
          </div>

          <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded bg-[var(--accent-sakura)] px-4 py-2 text-xs font-semibold text-[#0D0F18] hover:bg-[var(--accent-sakura-strong)]">
              <Upload className="h-4 w-4" />
              <span>{strings.poseLibraryUploadTitle}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                data-testid="pose-library-upload-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length > 0) void handleBatchUpload(files);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={autoClassify}
                onChange={(e) => setAutoClassify(e.target.checked)}
                className="accent-[var(--accent-sakura)]"
              />
              <span>Auto-suggest Girl / Boy / Unsorted (Gemini Vision)</span>
            </label>
          </div>
        </div>

        {/* Upload Queue */}
        {queue.length > 0 && (
          <div className="rounded border border-white/10 bg-[var(--surface-1)] p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Upload Queue ({queue.length})</span>
              <button
                type="button"
                onClick={() => setQueue((q) => q.filter((x) => x.status === 'uploading' || x.status === 'queued'))}
                className="text-[11px] text-[var(--text-muted)] hover:text-white"
              >
                Clear Completed
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {queue.map((q) => (
                <div
                  key={q.localId}
                  className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[var(--surface-0)] px-2.5 py-1.5 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[var(--text-primary)]">{q.file.name}</div>
                    <div className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                      {q.status === 'uploading'
                        ? 'Uploading & checking…'
                        : q.status === 'error'
                        ? q.error
                        : q.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {q.status === 'uploading' && (
                      <button
                        type="button"
                        onClick={() => uploadAbortMap.current.get(q.localId)?.abort()}
                        className="text-[var(--accent-amber)] hover:text-white"
                        title="Cancel upload"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                    {(q.status === 'error' || q.status === 'cancelled') && (
                      <button
                        type="button"
                        onClick={() => void runQueueItem(q)}
                        className="text-[var(--accent-mint)] hover:underline"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'girl', 'boy', 'unsorted'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategory(cat);
                  setPage(1);
                }}
                data-testid={`pose-filter-${cat}`}
                className={`rounded border px-3 py-1.5 text-xs font-medium ${
                  category === cat
                    ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)]'
                    : 'border-white/10 bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                {strings.categories[cat]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={strings.poseLibrarySearchPlaceholder}
                className="w-52 rounded border border-white/10 bg-[var(--surface-1)] py-1.5 pl-8 pr-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-sakura)] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => void refreshList(page, search, category)}
              className="rounded border border-white/10 bg-[var(--surface-1)] p-1.5 text-[var(--text-secondary)] hover:text-white"
              title="Refresh list"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded border border-red-400/50 bg-red-500/10 p-3 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        {/* Pose Grid */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-[var(--surface-1)] py-16 text-center">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {lang === 'ja'
                ? 'この条件に一致する2Dポーズはまだ登録されていません。'
                : 'No 2D pose references match this filter yet.'}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {lang === 'ja'
                ? '右上のボタンからPNG/JPEG/WebP画像をアップロードしてください。'
                : 'Upload PNG, JPEG, or WebP pose drawings above to build your library.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((pose) => (
              <div
                key={pose.id}
                className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[var(--surface-1)]"
                data-testid={`pose-card-${pose.id}`}
              >
                <div className="relative aspect-[4/5] bg-[#090b10]">
                  <img
                    src={pose.imageUrl}
                    alt={pose.name}
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                  <span className="absolute right-2 top-2 rounded bg-black/75 px-2 py-0.5 font-mono-tech text-[10px] uppercase text-[var(--accent-sakura-strong)] border border-white/15">
                    {pose.category}
                  </span>
                </div>

                <div className="flex flex-1 flex-col justify-between gap-2 p-3 text-xs">
                  <div className="space-y-1.5">
                    {editingId === pose.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full rounded border border-[var(--accent-sakura)] bg-[var(--surface-0)] px-1.5 py-0.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const updated = await updatePoseLibraryRecord(pose.id, { name: editName });
                            setItems((prev) => prev.map((x) => (x.id === pose.id ? updated : x)));
                            setEditingId(null);
                          }}
                          className="text-[11px] font-semibold text-[var(--accent-mint)]"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(pose.id);
                            setEditName(pose.name);
                          }}
                          title="Click to rename"
                          className="truncate font-semibold text-[var(--text-primary)] hover:text-[var(--accent-sakura)] text-left"
                        >
                          {pose.name}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <select
                        value={pose.category}
                        aria-label={`Category for ${pose.name}`}
                        onChange={async (e) => {
                          const updated = await updatePoseLibraryRecord(pose.id, {
                            category: e.target.value as PoseCategory,
                          });
                          setItems((prev) => prev.map((x) => (x.id === pose.id ? updated : x)));
                        }}
                        className="flex-1 rounded border border-white/10 bg-[var(--surface-2)] px-1.5 py-1 text-[11px]"
                      >
                        <option value="girl">Girl</option>
                        <option value="boy">Boy</option>
                        <option value="unsorted">Unsorted</option>
                      </select>
                      <button
                        type="button"
                        title="AI Re-classify suggestion (uses Gemini Vision)"
                        onClick={async () => {
                          const updated = await reclassifyPoseLibraryRecord(pose.id);
                          setItems((prev) => prev.map((x) => (x.id === pose.id ? updated : x)));
                        }}
                        className="rounded border border-white/10 bg-[var(--surface-2)] p-1 text-[var(--accent-sakura)] hover:border-[var(--accent-sakura)]/50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {pose.aiConfidenceNote && (
                      <p className="line-clamp-2 text-[10px] text-[var(--text-muted)]">
                        {pose.aiConfidenceNote}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                    <button
                      type="button"
                      onClick={() => onUsePoseInStudio(pose)}
                      className="flex-1 rounded bg-[var(--accent-sakura)]/20 border border-[var(--accent-sakura)]/50 px-2 py-1 text-[11px] font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/30"
                    >
                      {lang === 'ja' ? 'ポーズに使用' : 'Use Pose'}
                    </button>

                    {confirmDeleteId === pose.id ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await deletePoseLibraryRecord(pose.id);
                          setConfirmDeleteId(null);
                          void refreshList(page, search, category);
                        }}
                        className="text-[10px] font-semibold text-red-400 hover:underline"
                      >
                        Confirm
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(pose.id)}
                        title="Remove from library"
                        className="text-[var(--text-muted)] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs text-[var(--text-secondary)]">
          <span className="font-mono-tech">
            Total: {total} · Page {page} / {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-2.5 py-1 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-1)] px-2.5 py-1 disabled:opacity-40"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
