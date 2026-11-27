import { BookOpen, Code2, Plug, Server } from "lucide-react";
import type { DocsSidebarSection } from "@/lib/docs/links";

export function DocsSectionIcon({
  icon,
  className,
}: {
  icon: DocsSidebarSection["icon"];
  className?: string;
}) {
  switch (icon) {
    case "server":
      return <Server aria-hidden="true" className={className} />;
    case "plug":
      return <Plug aria-hidden="true" className={className} />;
    case "code":
      return <Code2 aria-hidden="true" className={className} />;
    default:
      return <BookOpen aria-hidden="true" className={className} />;
  }
}
