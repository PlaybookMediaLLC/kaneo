import { evaluate } from "@mdx-js/mdx";
import {
  rehypeCode,
  remarkGfm,
  remarkHeading,
} from "fumadocs-core/mdx-plugins";
import type { TOCItemType } from "fumadocs-core/toc";
import type { ComponentType } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { normalizeDocsHref } from "./links";
import type { DocsPageRecord } from "./source";

export interface CompiledDocsMdx {
  body: ComponentType<{ components?: Record<string, unknown> }>;
  toc: TOCItemType[];
}

interface MdastAttribute {
  type?: string;
  name?: string;
  value?: unknown;
}

interface MdastNode {
  type?: string;
  name?: string;
  url?: string;
  lang?: string | null;
  attributes?: MdastAttribute[];
  children?: MdastNode[];
}

const CODE_LANG_ALIASES: Record<string, string> = {
  env: "dotenv",
};

function remarkNormalizeDocsContent() {
  return (tree: MdastNode) => {
    const visit = (node: MdastNode) => {
      if (node.type === "link" && typeof node.url === "string") {
        node.url = normalizeDocsHref(node.url);
      } else if (
        node.type === "image" &&
        typeof node.url === "string" &&
        node.url.startsWith("/images/")
      ) {
        node.url = `/docs${node.url}`;
      } else if (
        (node.type === "mdxJsxFlowElement" ||
          node.type === "mdxJsxTextElement") &&
        node.name === "img" &&
        Array.isArray(node.attributes)
      ) {
        for (const attr of node.attributes) {
          if (
            attr.type === "mdxJsxAttribute" &&
            attr.name === "src" &&
            typeof attr.value === "string" &&
            attr.value.startsWith("/images/")
          ) {
            attr.value = `/docs${attr.value}`;
          }
        }
      } else if (
        node.type === "code" &&
        typeof node.lang === "string" &&
        Object.hasOwn(CODE_LANG_ALIASES, node.lang.toLowerCase())
      ) {
        node.lang = CODE_LANG_ALIASES[node.lang.toLowerCase()];
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}

// Reuse a single rehypeCode transformer so Shiki initializes one singleton highlighter
// across all compiled docs pages instead of creating a new highlighter per page.
let sharedRehypeCodeTransformer: ReturnType<typeof rehypeCode> | null = null;

function rehypeSharedDocsCode(this: ThisParameterType<typeof rehypeCode>) {
  if (!sharedRehypeCodeTransformer) {
    sharedRehypeCodeTransformer = rehypeCode.call(this, {
      themes: {
        light: "min-light",
        dark: "min-dark",
      },
      fallbackLanguage: "plaintext",
    });
  }
  return sharedRehypeCodeTransformer;
}

const compiledCache = new Map<string, Promise<CompiledDocsMdx>>();

export function compileDocsMdx(
  page: Pick<DocsPageRecord, "slug" | "body">,
): Promise<CompiledDocsMdx> {
  const existing = compiledCache.get(page.slug);
  if (existing) return existing;

  const promise = (async (): Promise<CompiledDocsMdx> => {
    let extractedToc: TOCItemType[] = [];

    const captureTocPlugin = () => {
      return (_tree: unknown, file: { data?: { toc?: TOCItemType[] } }) => {
        extractedToc = Array.isArray(file.data?.toc) ? file.data.toc : [];
      };
    };

    const evaluated = await evaluate(page.body, {
      ...jsxRuntime,
      remarkPlugins: [
        remarkGfm,
        remarkNormalizeDocsContent,
        remarkHeading,
        captureTocPlugin,
      ],
      rehypePlugins: [rehypeSharedDocsCode],
    });

    return {
      body: evaluated.default as ComponentType<{
        components?: Record<string, unknown>;
      }>,
      toc: extractedToc,
    };
  })();

  compiledCache.set(page.slug, promise);
  return promise;
}
