import React from 'react';
import { Pause, Play, Plus, Repeat, SkipBack } from 'lucide-react';
import type { LanguageCode, PoseKeyframe, TimelineClipItem, TimelineMode } from '../../../shared/studio';
import type { StudioStrings } from '../../lib/i18n';

interface TimelineBarProps {
  lang: LanguageCode;
  strings: StudioStrings;
  mode: TimelineMode;
  onChangeMode: (mode: TimelineMode) => void;
  durationSec: number;
  onChangeDurationSec: (sec: number) => void;
  currentTimeSec: number;
  onSeek: (sec: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  loop: boolean;
  onToggleLoop: () => void;
  speed: number;
  onChangeSpeed: (speed: number) => void;
  clips: TimelineClipItem[];
  activeClipName: string | null;
  onSelectClipName: (name: string) => void;
  keyframes: PoseKeyframe[];
  onAddKeyframeAtCurrentTime: () => void;
  onRemoveKeyframe: (id: string) => void;
}

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec - Math.floor(sec)) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

export const TimelineBar: React.FC<TimelineBarProps> = ({
  strings,
  mode,
  onChangeMode,
  durationSec,
  onChangeDurationSec,
  currentTimeSec,
  onSeek,
  isPlaying,
  onTogglePlay,
  loop,
  onToggleLoop,
  speed,
  onChangeSpeed,
  clips,
  activeClipName,
  onSelectClipName,
  keyframes,
  onAddKeyframeAtCurrentTime,
  onRemoveKeyframe,
}) => {
  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-1)] px-3 py-2 text-xs">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSeek(0)}
            aria-label="Jump to start"
            className="rounded border border-white/10 bg-[var(--surface-2)] p-1.5 text-[var(--text-secondary)] hover:text-white"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            data-testid="timeline-play-btn"
            className="inline-flex items-center gap-1 rounded bg-[var(--accent-sakura)] px-3 py-1 text-xs font-semibold text-[#0D0F18] hover:bg-[var(--accent-sakura-strong)]"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleLoop}
            title="Loop Playback"
            className={`rounded border p-1.5 ${
              loop
                ? 'border-[var(--accent-mint)]/60 bg-[var(--accent-mint)]/15 text-[var(--accent-mint)]'
                : 'border-white/10 bg-[var(--surface-2)] text-[var(--text-muted)]'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>

          <span className="ml-1 font-mono-tech text-xs text-[var(--text-primary)]" data-testid="timeline-timecode">
            {formatTimecode(currentTimeSec)} / {formatTimecode(durationSec)}
          </span>
        </div>

        {/* Mode Toggle: Clips vs Pose keyframes only */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded border border-white/10 overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => onChangeMode('clips')}
              data-testid="mode-clips-btn"
              className={`px-2.5 py-1 ${
                mode === 'clips'
                  ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold'
                  : 'bg-[var(--surface-0)] text-[var(--text-muted)]'
              }`}
            >
              {strings.timelineClipsMode}
            </button>
            <button
              type="button"
              onClick={() => onChangeMode('pose_keyframes')}
              data-testid="mode-keyframes-btn"
              className={`px-2.5 py-1 ${
                mode === 'pose_keyframes'
                  ? 'bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)] font-semibold'
                  : 'bg-[var(--surface-0)] text-[var(--text-muted)]'
              }`}
            >
              {strings.timelineKeyframesMode}
            </button>
          </div>

          <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
            <span>Speed</span>
            <select
              value={speed}
              onChange={(e) => onChangeSpeed(Number(e.target.value))}
              className="rounded border border-white/10 bg-[var(--surface-0)] px-1.5 py-0.5 font-mono-tech text-[11px]"
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1.0×</option>
              <option value={1.5}>1.5×</option>
              <option value={2}>2.0×</option>
            </select>
          </label>

          <label className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
            <span>Len (s)</span>
            <input
              type="number"
              min={1}
              max={600}
              value={durationSec}
              onChange={(e) => onChangeDurationSec(Number(e.target.value) || 1)}
              className="w-14 rounded border border-white/10 bg-[var(--surface-0)] px-1.5 py-0.5 font-mono-tech text-[11px]"
            />
          </label>
        </div>
      </div>

      {/* Scrub Slider */}
      <input
        type="range"
        min={0}
        max={durationSec}
        step={0.03}
        value={Math.min(durationSec, currentTimeSec)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Timeline Scrub"
        data-testid="timeline-scrub-slider"
        className="w-full accent-[var(--accent-sakura)]"
      />

      {/* Active Track Strip */}
      <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {mode === 'clips' ? (
          clips.length === 0 ? (
            <span className="text-[11px] text-[var(--text-muted)]">
              No clips in track — switch to Pose keyframes only or upload an animation clip.
            </span>
          ) : (
            clips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectClipName(c.sourceClipName)}
                className={`shrink-0 rounded border px-2.5 py-1 text-[11px] ${
                  activeClipName === c.sourceClipName
                    ? 'border-[var(--accent-sakura)] bg-[var(--accent-sakura)]/20 text-[var(--accent-sakura-strong)]'
                    : 'border-white/10 bg-[var(--surface-0)] text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                {c.label} · {c.durationSec.toFixed(1)}s
              </button>
            ))
          )
        ) : (
          <>
            <button
              type="button"
              onClick={onAddKeyframeAtCurrentTime}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--accent-mint)]/50 bg-[var(--accent-mint)]/15 px-2.5 py-1 text-[11px] text-[var(--accent-mint)]"
            >
              <Plus className="h-3 w-3" /> Add Key @ {currentTimeSec.toFixed(1)}s
            </button>
            {keyframes.map((k) => (
              <div
                key={k.id}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-white/15 bg-[var(--surface-0)] px-2 py-1 text-[11px]"
              >
                <button
                  type="button"
                  onClick={() => onSeek(k.timeSec)}
                  className="font-mono-tech text-[var(--accent-sakura-strong)] hover:underline"
                >
                  {k.label} ({k.timeSec.toFixed(1)}s)
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveKeyframe(k.id)}
                  className="text-[var(--text-muted)] hover:text-red-400"
                  title="Remove keyframe"
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
