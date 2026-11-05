export type Block = {
  id: string;
  kind: "heading" | "paragraph" | "list_item" | "table_cell";
  text: string;
  page?: number;
  level?: number;
};

export type ImageRef = {
  id: string;
  storagePath: string;
  mime: string;
  width: number;
  height: number;
  alt?: string;
  page?: number;
  afterBlockId?: string;
};

export type NormalizedDocument = {
  version: 1;
  sourceKind: "text" | "pdf" | "docx" | "image";
  title: string;
  blocks: Block[];
  images: ImageRef[];
  stats: { chars: number; blocks: number; images: number; pages?: number; noExtractableText?: boolean };
};
