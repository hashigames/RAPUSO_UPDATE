import React, { useState } from 'react';
import { BookOpen, Globe, Palette, Save, Download, Upload } from 'lucide-react';
import type { LanguageCode, ThemeMode } from '../../../shared/studio';
import type { StudioStrings } from '../../lib/i18n';

const LIGHTHOUSE_LOGO_URL =
  'https://files.manuscdn.com/user_upload_by_module/session_file/310519663616732802/psOLNNAmiOQEBuoh.png';

interface StudioHeaderProps {
  lang: LanguageCode;
  theme: ThemeMode;
  strings: StudioStrings;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onOpenGuide: () => void;
  onSaveProjectServer: () => void;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
  savingProject: boolean;
  statusBanner?: string | null;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  lang,
  theme,
  strings,
  projectName,
  onProjectNameChange,
  onToggleLang,
  onToggleTheme,
  onOpenGuide,
  onSaveProjectServer,
  onExportJson,
  onImportJsonFile,
  savingProject,
  statusBanner,
}) => {
  const [logoError, setLogoError] = useState(false);

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[var(--surface-1)] px-3 py-2 sm:px-4">
      {/* Brand mark: LIGHTHOUSE 橋 image + stacked RAPUSO / らぷそ (no R/ emblem) */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#F4F5F8] p-1 shadow-sm ring-1 ring-white/20"
          title="LIGHTHOUSE 橋"
        >
          {!logoError ? (
            <img
              src={LIGHTHOUSE_LOGO_URL}
              alt="LIGHTHOUSE 橋"
              className="h-full w-full object-contain"
              onError={() => setLogoError(true)}
            />
          ) : (
            <svg viewBox="0 0 36 36" className="h-full w-full" aria-label="LIGHTHOUSE 橋">
              <rect width="36" height="36" rx="4" fill="#F4F5F8" />
              <path d="M18 5 L22 14 L21 28 L15 28 L14 14 Z" fill="#131622" />
              <path d="M6 27 Q18 21 30 27" stroke="#E6A1B0" strokeWidth="2.4" fill="none" />
              <circle cx="18" cy="10" r="2.2" fill="#E6A1B0" />
            </svg>
          )}
        </div>

        <div className="flex flex-col leading-none">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-xl font-bold italic tracking-wide text-[var(--text-primary)] sm:text-2xl">
              {strings.brandName}
            </span>
            <span className="text-[11px] font-medium tracking-wider text-[var(--text-secondary)]">
              {strings.companyAttribution}
            </span>
          </div>
          <span className="mt-0.5 text-xs font-semibold tracking-wider text-[var(--accent-sakura)]">
            {strings.brandSub}
          </span>
        </div>

        <div className="hidden lg:flex items-center gap-2 ml-3 pl-3 border-l border-white/10">
          <input
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            aria-label="Project Name"
            className="w-44 rounded border border-white/10 bg-[var(--surface-0)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent-sakura)] focus:outline-none"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {statusBanner && (
          <span className="hidden xl:inline-block max-w-xs truncate text-[11px] font-mono-tech text-[var(--accent-mint)]">
            {statusBanner}
          </span>
        )}

        <button
          type="button"
          onClick={onSaveProjectServer}
          disabled={savingProject}
          className="inline-flex items-center gap-1.5 rounded border border-[var(--accent-sakura)]/50 bg-[var(--accent-sakura)]/15 px-2.5 py-1.5 text-xs font-medium text-[var(--accent-sakura-strong)] hover:bg-[var(--accent-sakura)]/25 disabled:opacity-50"
          data-testid="save-project-server-btn"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{strings.saveProjectServer}</span>
          <span className="sm:hidden">{lang === 'ja' ? '保存' : 'Save'}</span>
        </button>

        <button
          type="button"
          onClick={onExportJson}
          title={strings.exportProjectJson}
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:border-white/25 hover:text-[var(--text-primary)]"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden md:inline">JSON</span>
        </button>

        <label
          title={strings.importProjectJson}
          className="inline-flex cursor-pointer items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:border-white/25 hover:text-[var(--text-primary)]"
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{lang === 'ja' ? '読込' : 'Import'}</span>
          <input
            type="file"
            accept=".json,.rapuso.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportJsonFile(f);
              e.target.value = '';
            }}
          />
        </label>

        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'indigo' ? strings.themeIndigo : strings.themeGraphite}
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          data-testid="theme-toggle-btn"
        >
          <Palette className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">
            {theme === 'indigo' ? strings.themeIndigo : strings.themeGraphite}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleLang}
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-sakura)]/50"
          data-testid="lang-toggle-btn"
        >
          <Globe className="h-3.5 w-3.5 text-[var(--accent-sakura)]" />
          <span>{lang === 'en' ? 'EN / 日本語' : '日本語 / EN'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenGuide}
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          data-testid="guide-open-btn"
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{strings.guideButton}</span>
        </button>
      </div>
    </header>
  );
};
