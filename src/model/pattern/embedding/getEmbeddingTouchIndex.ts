import { Embedding } from './Embedding.ts';

// For each target face/edge/sector index, the (ascending) indices of the embeddings that map something onto it.
export type EmbeddingTouchIndex = {
  faces: number[][];
  edges: number[][];
  sectors: number[][];
};

const touchIndexMap = new WeakMap<Embedding[], EmbeddingTouchIndex>();

// memoized/cached for the arrays returned by getEmbeddings
export const getEmbeddingTouchIndex = (embeddings: Embedding[]): EmbeddingTouchIndex => {
  let touchIndex = touchIndexMap.get(embeddings);

  if (!touchIndex) {
    const result: EmbeddingTouchIndex = { faces: [], edges: [], sectors: [] };

    const add = (lists: number[][], targetIndex: number, embeddingIndex: number) => {
      const list = (lists[targetIndex] ??= []);
      if (list[list.length - 1] !== embeddingIndex) {
        list.push(embeddingIndex);
      }
    };

    embeddings.forEach((embedding, embeddingIndex) => {
      for (const face of embedding.getFaceMap().values()) {
        add(result.faces, face.index, embeddingIndex);
      }
      for (const edge of embedding.getNonExitEdgeMap().values()) {
        add(result.edges, edge.index, embeddingIndex);
      }
      for (const edges of embedding.getExitEdgeMap().values()) {
        for (const edge of edges) {
          add(result.edges, edge.index, embeddingIndex);
        }
      }
      for (const sector of embedding.getSectorMap().values()) {
        add(result.sectors, sector.index, embeddingIndex);
      }
    });

    touchIndex = result;
    touchIndexMap.set(embeddings, touchIndex);
  }

  return touchIndex;
};
