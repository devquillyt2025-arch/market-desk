"use client";

/**
 * The add / edit popup for a link. Same frame as the app's other modals (TradeEntryModal, NoteModal): a frosted
 * backdrop, a plain opaque panel, focus pulled in and held there, Escape to close. Two additions: a live preview of the
 * card beside the fields, and a backdrop that won't close the popup over something you've typed - Cancel, the ×
 * and Escape still do, so you are never trapped, but a stray click can't throw your work away.
 */

import type { FormEvent, ReactNode } from "react";

import { AlertCircleIcon, GridIcon, LinkIcon, NoteIcon, PencilIcon, PlusIcon, XIcon } from "@/components/icons";
import Modal from "@/components/Modal";
import { useSettled } from "@/lib/useSettled";

import { LinkCardFace, toneStyle } from "./LinkCard";
import { hostOf, normalizeUrl, toneForGroup, type LinkFormValues } from "./linkMeta";

type LinkModalProps = {
  /** True when changing an existing link rather than adding one. */
  editing: boolean;
  values: LinkFormValues;
  onChange: (patch: Partial<LinkFormValues>) => void;
  groupNames: string[];
  error: string | null;
  saving: boolean;
  /** Something typed that a backdrop click would lose. */
  dirty: boolean;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
};

const fieldClass =
  "w-full rounded-xl border border-border bg-background/60 py-2.5 pl-10 pr-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 focus:border-accent focus:ring-4 focus:ring-accent/15 aria-[invalid=true]:border-danger-fg aria-[invalid=true]:focus:ring-danger-fg/15";

function Field({ id, label, optional, icon, className = "", children }: { id: string; label: string; optional?: boolean; icon: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {optional && <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/70">optional</span>}
      </label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        {children}
      </div>
    </div>
  );
}

export function LinkModal({ editing, values, onChange, groupNames, error, saving, dirty, onSubmit, onClose }: LinkModalProps) {
  const groupName = values.group.trim() || "My Links";
  const tone = toneForGroup(groupName);
  const normalized = normalizeUrl(values.url);
  const host = normalized ? hostOf(normalized) : hostOf(values.url);
  // The preview looks the icon up only once the address has stopped changing: "n", "ns", "nse"... are not
  // sites, and each keystroke would otherwise be a request telling a third party what you are typing.
  const logoHost = useSettled(normalized ? host : "", 700);
  const errorId = "link-modal-error";
  const nameInvalid = error?.startsWith("Enter a name") ?? false;
  const urlInvalid = error?.startsWith("Enter a valid") ?? false;

  return (
    <Modal
      onClose={onClose}
      // A stray tap on the backdrop must not throw away what has been typed: only an untouched form closes that way.
      onBackdropClick={() => {
        if (!dirty && !saving) onClose();
      }}
      ariaLabelledBy="link-modal-title"
      className="sm:max-w-4xl"
    >
      <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
        {/* The popup's own accent: a lit hairline along the top edge. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />

        <div className="flex items-center gap-3 px-5 pb-1 pt-5 sm:px-7 sm:pt-6">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/25">
            {editing ? <PencilIcon className="size-5" /> : <PlusIcon className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="link-modal-title" className="text-base font-semibold tracking-tight">
              {editing ? "Edit link" : "Add a link"}
            </h2>
            <p className="text-sm text-muted-foreground">Saved to every device you use.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="grid gap-6 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="link-label" label="Name" icon={<PencilIcon className="size-4" />}>
                <input
                  id="link-label"
                  value={values.label}
                  onChange={(e) => onChange({ label: e.target.value })}
                  placeholder="e.g. Sensibull"
                  autoComplete="off"
                  // The hook's own marker (as ConfirmDialog uses): it focuses this once the popup is in place,
                  // which React's `autoFocus` doesn't reliably do inside an animated mount.
                  data-autofocus=""
                  aria-invalid={nameInvalid ? true : undefined}
                  aria-describedby={nameInvalid ? errorId : undefined}
                  className={fieldClass}
                />
              </Field>
              <Field id="link-url" label="URL" icon={<LinkIcon className="size-4" />}>
                <input
                  id="link-url"
                  value={values.url}
                  onChange={(e) => onChange({ url: e.target.value })}
                  placeholder="example.com"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={urlInvalid ? true : undefined}
                  aria-describedby={urlInvalid ? errorId : undefined}
                  className={fieldClass}
                />
              </Field>
              <Field id="link-description" label="Description" optional icon={<NoteIcon className="size-4" />} className="sm:col-span-2">
                <input
                  id="link-description"
                  value={values.description}
                  onChange={(e) => onChange({ description: e.target.value })}
                  placeholder="What this link is for"
                  autoComplete="off"
                  className={fieldClass}
                />
              </Field>
              <div className="flex flex-col gap-2.5 sm:col-span-2">
                <Field id="link-group" label="Group" optional icon={<GridIcon className="size-4" />}>
                  <input
                    id="link-group"
                    value={values.group}
                    onChange={(e) => onChange({ group: e.target.value })}
                    placeholder="My Links"
                    autoComplete="off"
                    className={fieldClass}
                  />
                </Field>
                {/* Existing groups as chips rather than a native <datalist>, whose popup is browser chrome that ignores the theme. */}
                {groupNames.length > 0 && (
                  <div role="group" aria-label="Existing groups" className="flex flex-wrap gap-2">
                    {groupNames.map((name) => {
                      const picked = values.group.trim() === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => onChange({ group: name })}
                          aria-pressed={picked}
                          style={toneStyle(toneForGroup(name))}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            picked
                              ? "border-[color-mix(in_srgb,var(--tone)_55%,transparent)] bg-[color-mix(in_srgb,var(--tone)_14%,var(--card))] text-foreground"
                              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-(--tone)" />
                          {name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* role="alert" is itself an assertive live region, so it is read out as it appears. */}
            {error && (
              <p id={errorId} role="alert" className="flex items-center gap-2 rounded-xl border border-danger-fg/30 bg-danger-fg/10 px-3.5 py-2.5 text-sm text-danger-fg">
                <AlertCircleIcon className="size-4 shrink-0" />
                {error}
              </p>
            )}
          </div>

          {/* Live preview - the same face the real card draws, so what you type is what you'll get. */}
          <aside aria-label="Preview" className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
              Live preview
            </p>
            <div
              style={toneStyle(tone)}
              className="relative isolate overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--tone)_40%,var(--border))] bg-card p-4 shadow-[0_14px_34px_-18px_color-mix(in_srgb,var(--tone)_60%,transparent)]"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[image:radial-gradient(280px_circle_at_85%_0%,color-mix(in_srgb,var(--tone)_16%,transparent),transparent_70%)]" />
              <LinkCardFace
                label={values.label}
                host={host}
                logoHost={logoHost}
                description={values.description.trim() || undefined}
                reserve="none"
                title={
                  <span className={`block text-[15px] font-semibold leading-snug ${values.label.trim() ? "" : "text-muted-foreground/70"}`}>
                    {values.label.trim() || "Link name"}
                  </span>
                }
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Goes in <span className="font-medium text-foreground">{groupName}</span>
              {groupNames.includes(groupName) ? "." : " - a new group."}
            </p>
          </aside>
        </div>

        {/* Sticks to the bottom of the panel, so Save is in reach however short the window. */}
        <div className="sticky bottom-0 mt-auto flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background/95 px-5 py-4 backdrop-blur sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex min-h-10 items-center gap-2 rounded-xl bg-accent-solid px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_8px_24px_-10px_color-mix(in_srgb,var(--accent-solid)_85%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)] transition-[filter,transform] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 active:scale-95"
          >
            {saving && (
              <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {saving ? "Saving…" : editing ? "Save changes" : "Save link"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
