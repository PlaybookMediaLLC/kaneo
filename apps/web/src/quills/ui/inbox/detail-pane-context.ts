import { createContext } from "react";

/** The pane controls that DetailLayout gives to the ListPane and the DetailHeader inside it. */
export interface DetailPaneControls {
  /** Hides the list pane (md and up). */
  hideList: () => void;
  /** The right panel, or null when the layout has none. */
  panel: { label: string; open: boolean; toggle: () => void } | null;
}

export const DetailPaneContext = createContext<DetailPaneControls | null>(null);
