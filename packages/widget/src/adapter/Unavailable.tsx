import { Icon } from "../ui/Icon.js";

/** Shown while the workspace has the widget turned off or unknown. */
export function Unavailable({ onClose }: { onClose: () => void }) {
  return (
    <section className="qb-widget" data-theme="auto" aria-label="Support">
      <header className="qb-header">
        <strong>Support</strong>
        <button
          type="button"
          className="qb-icon-button qb-close"
          aria-label="Close widget"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="qb-content">
        <p className="qb-empty" role="status">
          This widget is not available right now.
        </p>
      </div>
    </section>
  );
}
