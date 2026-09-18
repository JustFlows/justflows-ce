export interface BlockNode {
  id: string;
  type: string;
  version: number;
  props: Record<string, unknown>;
  children?: BlockNode[];
}

export interface BlockDocument {
  version: 1;
  blocks: BlockNode[];
}
