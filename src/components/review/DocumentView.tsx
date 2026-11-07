"use client";

import { Fragment } from "react";
import type { ImageRef, NormalizedDocument } from "@/server/ingest/types";
import type { Finding } from "@/server/review/types";

function decoration(severity: Finding["severity"]) {
  if (severity === "error") return "underline decoration-wavy decoration-error";
  if (severity === "warn") return "underline decoration-dashed decoration-warn";
  return "underline decoration-dotted decoration-question";
}

function BlockText({
  text,
  findings,
  selectedId,
  onSelect,
}: {
  text: string;
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ranges = findings
    .filter((f) => f.state === "open")
    .sort((a, b) => a.start - b.start);
  const used: Finding[] = [];
  for (const f of ranges) {
    if (used.some((u) => !(f.end <= u.start || f.start >= u.end))) continue;
    used.push(f);
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const f of used) {
    if (f.start > cursor) parts.push(text.slice(cursor, f.start));
    parts.push(
      <mark
        id={`mark-${f.id}`}
        key={f.id}
        className={`cursor-pointer bg-transparent ${decoration(f.severity)} ${
          selectedId === f.id ? "outline outline-2 outline-brand" : ""
        }`}
        onClick={() => {
          onSelect(f.id);
          document.getElementById(`finding-${f.id}`)?.scrollIntoView({
            block: "nearest",
          });
        }}
      >
        {text.slice(f.start, f.end)}
      </mark>,
    );
    cursor = f.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function DocImage({ image }: { image: ImageRef }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/files/${image.storagePath}`}
      alt={image.alt ?? ""}
      width={image.width || undefined}
      height={image.height || undefined}
      className="max-w-full rounded-md border border-line"
    />
  );
}

export function DocumentView({
  doc,
  findings,
  selectedId,
  onSelect,
}: {
  doc: NormalizedDocument;
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (doc.stats.noExtractableText) {
    return (
      <p className="text-sm text-muted">
        No extractable text. Scanned PDFs need OCR (not in this version).
      </p>
    );
  }
  if (doc.sourceKind === "image" && doc.blocks.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Image stored. Text checks need text; image checks arrive with the visual audit.
        </p>
        {doc.images.map((img) => (
          <DocImage key={img.id} image={img} />
        ))}
      </div>
    );
  }

  const blockIds = new Set(doc.blocks.map((b) => b.id));
  const trailingImages = doc.images.filter(
    (img) => !img.afterBlockId || !blockIds.has(img.afterBlockId),
  );

  return (
    <div className="space-y-4 font-serif text-[1.05rem] leading-7">
      {doc.blocks.map((block) => {
        const Tag =
          block.kind === "heading"
            ? ("h2" as const)
            : block.kind === "list_item"
              ? ("li" as const)
              : ("p" as const);
        const className =
          block.kind === "heading" ? "font-sans text-xl font-semibold" : undefined;
        const images = doc.images.filter(
          (img) => img.afterBlockId === block.id,
        );
        return (
          <Fragment key={block.id}>
            <Tag id={`block-${block.id}`} className={className}>
              <BlockText
                text={block.text}
                findings={findings.filter((f) => f.blockId === block.id)}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            </Tag>
            {images.map((img) => (
              <DocImage key={img.id} image={img} />
            ))}
          </Fragment>
        );
      })}
      {trailingImages.map((img) => (
        <DocImage key={img.id} image={img} />
      ))}
    </div>
  );
}
