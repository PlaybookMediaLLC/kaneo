import defaultMdxComponents from "fumadocs-ui/mdx";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  Braces,
  Code,
  Download,
  GitBranch,
  Info as InfoIcon,
  KeyRound,
  Lightbulb,
  List,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plug,
  Radio,
  Rocket,
  Send,
  Server,
  Settings,
  Smartphone,
  SquareCheck,
  StickyNote,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ComponentType,
  ImgHTMLAttributes,
  ReactNode,
  SVGProps,
} from "react";
import { normalizeDocsHref } from "@/lib/docs/links";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

function GitLabIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m22 13.29-3.33-10a.42.42 0 0 0-.14-.18.38.38 0 0 0-.22-.11.39.39 0 0 0-.23.07.42.42 0 0 0-.14.18l-2.26 6.67H8.32L6.1 3.26a.42.42 0 0 0-.1-.18.38.38 0 0 0-.26-.08.39.39 0 0 0-.23.07.42.42 0 0 0-.14.18L2 13.29a.74.74 0 0 0 .27.83L12 21l9.69-6.88a.71.71 0 0 0 .31-.83Z" />
    </svg>
  );
}

function SlackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="3" height="8" x="13" y="2" rx="1.5" />
      <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" />
      <rect width="3" height="8" x="8" y="14" rx="1.5" />
      <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" />
      <rect width="8" height="3" x="14" y="13" rx="1.5" />
      <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" />
      <rect width="8" height="3" x="2" y="8" rx="1.5" />
      <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" />
    </svg>
  );
}

export const DOCS_CARD_ICONS: Record<string, IconComponent> = {
  bell: Bell,
  "book-open": BookOpen,
  bot: Bot,
  braces: Braces,
  code: Code,
  download: Download,
  "git-branch": GitBranch,
  github: GitHubIcon,
  gitlab: GitLabIcon,
  "key-round": KeyRound,
  list: List,
  mail: Mail,
  "message-circle": MessageCircle,
  "messages-square": MessagesSquare,
  plug: Plug,
  radio: Radio,
  rocket: Rocket,
  send: Send,
  server: Server,
  settings: Settings,
  slack: SlackIcon,
  smartphone: Smartphone,
  "square-check": SquareCheck,
  webhook: Webhook,
};

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith("//");
}

function DocsLink({
  href = "",
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const resolved = normalizeDocsHref(href);

  if (
    !resolved ||
    resolved.startsWith("#") ||
    resolved.startsWith("mailto:") ||
    resolved.startsWith("tel:")
  ) {
    return (
      <a href={resolved} className={className} {...props}>
        {children}
      </a>
    );
  }

  if (isExternalHref(resolved)) {
    return (
      <a
        href={resolved}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        {...props}
      >
        {children}
      </a>
    );
  }

  if (resolved === "/openapi.json" || resolved.startsWith("/docs/raw/")) {
    return (
      <a href={resolved} className={className} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link href={resolved} className={className} {...props}>
      {children}
    </Link>
  );
}

function DocsImage({
  src,
  alt = "",
  className,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const resolvedSrc =
    typeof src === "string" && src.startsWith("/images/") ? `/docs${src}` : src;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Docs MDX screenshots use paired light/dark <img> elements with arbitrary dimensions.
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      className={cn("rounded-lg border border-border", className)}
      {...props}
    />
  );
}

function CardGroup({
  cols = 2,
  children,
  className,
}: {
  cols?: number;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 grid grid-cols-1 gap-3",
        cols === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Card({
  title,
  icon,
  href,
  children,
  className,
}: {
  title: string;
  icon?: string;
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = icon ? DOCS_CARD_ICONS[icon] : undefined;
  const normalizedHref = href ? normalizeDocsHref(href) : undefined;
  const external = normalizedHref ? isExternalHref(normalizedHref) : false;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {Icon ? (
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
              <Icon className="size-4" />
            </span>
          ) : null}
          <span className="font-heading font-semibold text-sm text-foreground">
            {title}
          </span>
        </div>
        {normalizedHref ? (
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
          />
        ) : null}
      </div>
      {children ? (
        <div className="mt-2 text-sm text-muted-foreground leading-relaxed [&>p]:m-0">
          {children}
        </div>
      ) : null}
    </>
  );

  const cardClassName = cn(
    "group block rounded-lg border border-border bg-card p-4 text-card-foreground no-underline transition-colors",
    normalizedHref &&
      "hover:border-foreground/20 hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
    className,
  );

  if (!normalizedHref) {
    return <div className={cardClassName}>{content}</div>;
  }

  if (external) {
    return (
      <a
        data-card=""
        href={normalizedHref}
        target="_blank"
        rel="noopener noreferrer"
        className={cardClassName}
      >
        {content}
      </a>
    );
  }

  return (
    <Link data-card="" href={normalizedHref} className={cardClassName}>
      {content}
    </Link>
  );
}

function Frame({
  caption,
  children,
}: {
  caption?: string;
  children?: ReactNode;
}) {
  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border border-border bg-muted/40 p-2">
      <div className="overflow-hidden rounded-lg [&_img]:m-0 [&_img]:w-full [&_img]:border-0 [&_img]:rounded-lg">
        {children}
      </div>
      {caption ? (
        <figcaption className="px-2 pt-2.5 pb-1 text-center text-xs text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Steps({ children }: { children?: ReactNode }) {
  return (
    <div className="fd-steps my-6 space-y-6 border-s border-border ps-6">
      {children}
    </div>
  );
}

function Step({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="fd-step relative">
      {title ? (
        <h3 className="mt-0 mb-2 font-heading font-semibold text-base text-foreground">
          {title}
        </h3>
      ) : null}
      <div className="prose-no-margin text-sm leading-relaxed">{children}</div>
    </div>
  );
}

type CalloutKind = "note" | "info" | "tip" | "warning";

const CALLOUT_STYLES: Record<
  CalloutKind,
  {
    label: string;
    Icon: IconComponent;
    container: string;
    icon: string;
  }
> = {
  note: {
    label: "Note",
    Icon: StickyNote,
    container: "border-border bg-muted/60 text-foreground",
    icon: "text-muted-foreground",
  },
  info: {
    label: "Info",
    Icon: InfoIcon,
    container: "border-info/30 bg-info/8 text-foreground",
    icon: "text-info-foreground",
  },
  tip: {
    label: "Tip",
    Icon: Lightbulb,
    container: "border-success/30 bg-success/8 text-foreground",
    icon: "text-success-foreground",
  },
  warning: {
    label: "Warning",
    Icon: AlertTriangle,
    container: "border-warning/35 bg-warning/10 text-foreground",
    icon: "text-warning-foreground",
  },
};

function DocsCallout({
  kind,
  children,
}: {
  kind: CalloutKind;
  children?: ReactNode;
}) {
  const style = CALLOUT_STYLES[kind];
  const Icon = style.Icon;
  return (
    <div
      role="note"
      aria-label={style.label}
      className={cn(
        "my-6 flex gap-3 rounded-lg border p-4 text-sm leading-relaxed",
        style.container,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", style.icon)}
      />
      <div className="min-w-0 flex-1 prose-no-margin [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}

function Note({ children }: { children?: ReactNode }) {
  return <DocsCallout kind="note">{children}</DocsCallout>;
}

function Info({ children }: { children?: ReactNode }) {
  return <DocsCallout kind="info">{children}</DocsCallout>;
}

function Tip({ children }: { children?: ReactNode }) {
  return <DocsCallout kind="tip">{children}</DocsCallout>;
}

function Warning({ children }: { children?: ReactNode }) {
  return <DocsCallout kind="warning">{children}</DocsCallout>;
}

export const docsMdxComponents = {
  ...defaultMdxComponents,
  a: DocsLink,
  img: DocsImage,
  CardGroup,
  Card,
  Frame,
  Steps,
  Step,
  Note,
  Info,
  Tip,
  Warning,
};
