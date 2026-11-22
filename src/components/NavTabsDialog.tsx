"use client";

import { useId } from "react";

import { XIcon } from "@/components/icons";
import Modal from "@/components/Modal";
import NavTabsEditor from "@/components/NavTabsEditor";

/** The tab list as a pop-up (the shared Modal: a centred card on desktop, a bottom sheet on a phone). Render it inside an AnimatePresence. */
export default function NavTabsDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();

  return (
    <Modal onClose={onClose} ariaLabelledBy={titleId} className="flex flex-col sm:max-w-md">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id={titleId} className="text-lg font-semibold leading-tight tracking-tight">
          Choose your tabs
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="px-5 py-4">
        <NavTabsEditor />
      </div>
    </Modal>
  );
}
