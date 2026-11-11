import { createRoot } from "react-dom/client";
import { WidgetHost } from "./WidgetHost.js";
import "../ui/styles.css";
import "./host.css";

// Browser entry for the iframe page that the API serves at /api/quills-public/{workspace}/widget.
// The workspace comes from that path, so the page reflects no server-side input.
createRoot(document.getElementById("root")!).render(
  <WidgetHost
    base={location.pathname.replace(/\/widget$/, "")}
    params={new URLSearchParams(location.search)}
  />,
);
