import type { ReactNode } from "react";

/** Tiny markdown subset for Pepe replies — no extra dependency. */
export function PepeMarkdown({ text }: { text: string }) {
  const blocks = String(text ?? "").split(/\n{2,}/);
  return (
    <div className="pepe-md space-y-2 text-[14px] leading-relaxed text-cream">
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} block={block} />
      ))}
    </div>
  );
}

function MarkdownBlock({ block }: { block: string }) {
  const lines = block.split("\n");
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return (
      <ul className="list-disc pl-5 space-y-1">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
        ))}
      </ul>
    );
  }
  return <p className="whitespace-pre-wrap">{inline(block)}</p>;
}

function inline(src: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) parts.push(src.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded bg-black/30 px-1 text-[12px]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        parts.push(
          <a
            key={key++}
            href={safeHref(link[2])}
            target="_blank"
            rel="noreferrer"
            className="text-brass-light underline underline-offset-2"
          >
            {link[1]}
          </a>,
        );
      }
    }
    last = m.index + token.length;
  }
  if (last < src.length) parts.push(src.slice(last));
  return parts;
}

function safeHref(href: string): string {
  if (/^https?:\/\//i.test(href) || href.startsWith("/")) return href;
  return "#";
}
