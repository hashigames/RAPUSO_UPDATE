import React from 'react';
import { FolderOpen, Info, RefreshCw, Trash2 } from 'lucide-react';
import type { LanguageCode, NamedPose, PortableProjectManifest } from '../../../shared/studio';
import type { StudioStrings } from '../../lib/i18n';

interface AssetLibraryWorkspaceProps {
  lang: LanguageCode;
  strings: StudioStrings;
  serverProjects: PortableProjectManifest[];
  savedPoses: NamedPose[];
  onLoadProject: (proj: PortableProjectManifest) => void;
  onDeleteServerProject: (id: string) => Promise<void>;
  onRefreshProjects: () => Promise<void>;
  onApplySavedPose: (pose: NamedPose) => void;
}

export const AssetLibraryWorkspace: React.FC<AssetLibraryWorkspaceProps> = ({
  lang,
  strings,
  serverProjects,
  savedPoses,
  onLoadProject,
  onDeleteServerProject,
  onRefreshProjects,
  onApplySavedPose,
}) => {
  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-0)] p-4 lg:p-6">
      <div className="mx-auto max-w-5xl space-y-5 text-xs">
        <div className="rounded-lg border border-white/10 bg-[var(--surface-1)] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold tracking-wide text-[var(--text-primary)]">
              {strings.nav.assets}
            </h2>
            <button
              type="button"
              onClick={() => void onRefreshProjects()}
              className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
          <div className="flex items-start gap-2 rounded border border-white/10 bg-[var(--surface-0)] p-2.5 text-[11px] text-[var(--text-secondary)]">
            <Info className="h-4 w-4 text-[var(--accent-mint)] shrink-0 mt-0.5" />
            <span>{strings.persistenceDisclosure}</span>
          </div>
        </div>

        {/* Saved Server Projects */}
        <div className="rounded-lg border border-white/10 bg-[var(--surface-1)] p-4 space-y-3">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {lang === 'ja' ? '保存済みスタジオプロジェクト' : 'Saved Studio Projects'} ({serverProjects.length})
          </h3>
          {serverProjects.length === 0 ? (
            <div className="rounded border border-dashed border-white/15 p-6 text-center text-[var(--text-muted)]">
              {lang === 'ja'
                ? 'サーバー保存されたプロジェクトはまだありません。ヘッダーの保存ボタンから保存できます。'
                : 'No server-saved projects yet. Use "Save Project to Studio Server" in the header to persist your scene.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {serverProjects.map((proj) => (
                <div
                  key={proj.id}
                  className="flex items-center justify-between rounded border border-white/10 bg-[var(--surface-0)] p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[var(--text-primary)]">{proj.name}</div>
                    <div className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                      {proj.timelineMode} · {proj.timelineDurationSec}s · {new Date(proj.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onLoadProject(proj)}
                      className="inline-flex items-center gap-1 rounded border border-[var(--accent-mint)]/50 bg-[var(--accent-mint)]/15 px-2.5 py-1 text-[11px] text-[var(--accent-mint)]"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Load
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteServerProject(proj.id)}
                      className="text-[var(--text-muted)] hover:text-red-400"
                      title="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Named Pose Snapshots */}
        <div className="rounded-lg border border-white/10 bg-[var(--surface-1)] p-4 space-y-3">
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">
            {lang === 'ja' ? '保存済みポーズスナップショット' : 'Saved Pose Snapshots'} ({savedPoses.length})
          </h3>
          {savedPoses.length === 0 ? (
            <div className="text-[var(--text-muted)]">
              Save named poses inside Pose & Drawing to reuse them across scenes.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {savedPoses.map((pose) => (
                <button
                  key={pose.id}
                  type="button"
                  onClick={() => onApplySavedPose(pose)}
                  className="rounded border border-white/10 bg-[var(--surface-0)] px-3 py-1.5 text-left hover:border-[var(--accent-sakura)]/60"
                >
                  <div className="font-medium text-[var(--text-primary)]">{pose.name}</div>
                  <div className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                    {Object.keys(pose.boneRotations).length} bones · {pose.source || 'manual'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
