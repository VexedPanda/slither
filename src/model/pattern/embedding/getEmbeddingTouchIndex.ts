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
      embedding.mappedFaceIndices.forEach((faceIndex) => add(result.faces, faceIndex, embeddingIndex));
      embedding.mappedNonExitEdgeIndices.forEach((edgeIndex) => add(result.edges, edgeIndex, embeddingIndex));
      embedding.mappedExitEdgeIndices.forEach((edgeIndices) => {
        for (const edgeIndex of edgeIndices) {
          add(result.edges, edgeIndex, embeddingIndex);
        }
      });
      embedding.mappedSectorIndices.forEach((sectorIndex) => add(result.sectors, sectorIndex, embeddingIndex));
    });

    touchIndex = result;
    touchIndexMap.set(embeddings, touchIndex);
  }

  return touchIndex;
};
