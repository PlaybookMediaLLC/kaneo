import { createRoot } from "react-dom/client";
import { WidgetHost } from "./WidgetHost.js";
import "../ui/styles.css";
import "./host.css";

// Browser entry for the iframe page that the API serves at /api/quills-public/{workspace}/widget.
// The workspace comes from that path, so the page reflects no server-side input.
const pathname = location.pathname;
const directWidget = /\/widget\/?$/.test(pathname);
const base = directWidget
  ? pathname.replace(/\/widget\/?$/, "")
  : pathname.replace(/\/+$/, "");

createRoot(document.getElementById("root")!).render(
  <WidgetHost
    base={base}
    widgetProxied={!directWidget}
    params={new URLSearchParams(location.search)}
  />,
);
