import { TPatternBoard } from '../pattern-board/TPatternBoard.ts';
import { TPatternEdge } from '../pattern-board/TPatternEdge.ts';
import { TPatternFace } from '../pattern-board/TPatternFace.ts';
import { TPatternSector } from '../pattern-board/TPatternSector.ts';
import { TPatternVertex } from '../pattern-board/TPatternVertex.ts';

import assert, { assertEnabled } from '../../../workarounds/assert.ts';

// The indices with values in a (possibly sparse) array, in ascending order
const getDefinedIndices = (array: unknown[]): number[] => {
  const indices: number[] = [];
  array.forEach((value, index) => indices.push(index));
  return indices;
};

// Null if the keys are in ascending order (see getDefinedIndices), otherwise an exact-size copy
const getKeyOrder = (keys: number[]): number[] | null =>
  keys.every((key, i) => i === 0 || keys[i - 1] < key) ? null : keys.slice();

export class Embedding {
  public readonly isAutomorphism: boolean;
  public readonly isIdentityAutomorphism: boolean;

  // Target indices, indexed by source index. Faster than the maps for hot pattern matching.
  public readonly mappedVertexIndices: number[];
  public readonly mappedFaceIndices: number[];
  public readonly mappedNonExitEdgeIndices: number[];
  public readonly mappedExitEdgeIndices: number[][];
  public readonly mappedSectorIndices: number[];

  // Source indices of each map's keys, in the original map order. A large board can have tens of thousands of
  // embeddings (for every rule), so instead of keeping five Maps per embedding (most of their memory), the maps are
  // rebuilt from these when requested.
  // (null when they are in ascending order, which is common, so they can be found from the mapped indices instead)
  private readonly vertexKeyOrder: number[] | null;
  private readonly nonExitEdgeKeyOrder: number[] | null;
  private readonly exitEdgeKeyOrder: number[] | null;
  private readonly sectorKeyOrder: number[] | null;
  private readonly faceKeyOrder: number[] | null;

  // Defined if it is an automorphism
  private readonly vertexInverseMap?: Map<TPatternVertex, TPatternVertex>;
  private readonly edgeInverseMap?: Map<TPatternEdge, TPatternEdge>;
  private readonly sectorInverseMap?: Map<TPatternSector, TPatternSector>;
  private readonly faceInverseMap?: Map<TPatternFace, TPatternFace>;

  private constructor(
    public readonly sourcePatternBoard: TPatternBoard,
    public readonly targetPatternBoard: TPatternBoard,
    // TODO: consider alternate implementation with fewer objects?
    vertexMap: Map<TPatternVertex, TPatternVertex>,
    nonExitEdgeMap: Map<TPatternEdge, TPatternEdge>,
    exitEdgeMap: Map<TPatternEdge, TPatternEdge[]>,
    sectorMap: Map<TPatternSector, TPatternSector>,
    faceMap: Map<TPatternFace, TPatternFace>,
  ) {
    this.isAutomorphism = sourcePatternBoard === targetPatternBoard;

    const vertexKeys: number[] = [];
    const mappedVertexIndices: number[] = [];
    for (const [vertex, mappedVertex] of vertexMap) {
      vertexKeys.push(vertex.index);
      mappedVertexIndices[vertex.index] = mappedVertex.index;
    }
    const faceKeys: number[] = [];
    const mappedFaceIndices: number[] = [];
    for (const [face, mappedFace] of faceMap) {
      faceKeys.push(face.index);
      mappedFaceIndices[face.index] = mappedFace.index;
    }
    const nonExitEdgeKeys: number[] = [];
    const mappedNonExitEdgeIndices: number[] = [];
    for (const [edge, mappedEdge] of nonExitEdgeMap) {
      nonExitEdgeKeys.push(edge.index);
      mappedNonExitEdgeIndices[edge.index] = mappedEdge.index;
    }
    const exitEdgeKeys: number[] = [];
    const mappedExitEdgeIndices: number[][] = [];
    for (const [edge, mappedEdges] of exitEdgeMap) {
      exitEdgeKeys.push(edge.index);
      mappedExitEdgeIndices[edge.index] = mappedEdges.map((mappedEdge) => mappedEdge.index);
    }
    const sectorKeys: number[] = [];
    const mappedSectorIndices: number[] = [];
    for (const [sector, mappedSector] of sectorMap) {
      sectorKeys.push(sector.index);
      mappedSectorIndices[sector.index] = mappedSector.index;
    }

    // Copied to exact-size arrays, since arrays grown an element at a time keep spare capacity (several times the
    // size of these small arrays)
    this.vertexKeyOrder = getKeyOrder(vertexKeys);
    this.mappedVertexIndices = mappedVertexIndices.slice();
    this.faceKeyOrder = getKeyOrder(faceKeys);
    this.mappedFaceIndices = mappedFaceIndices.slice();
    this.nonExitEdgeKeyOrder = getKeyOrder(nonExitEdgeKeys);
    this.mappedNonExitEdgeIndices = mappedNonExitEdgeIndices.slice();
    this.exitEdgeKeyOrder = getKeyOrder(exitEdgeKeys);
    this.mappedExitEdgeIndices = mappedExitEdgeIndices.slice();
    this.sectorKeyOrder = getKeyOrder(sectorKeys);
    this.mappedSectorIndices = mappedSectorIndices.slice();

    if (this.isAutomorphism) {
      this.vertexInverseMap = new Map(Array.from(vertexMap).map(([key, value]) => [value, key]));
      this.sectorInverseMap = new Map(Array.from(sectorMap).map(([key, value]) => [value, key]));
      this.faceInverseMap = new Map(Array.from(faceMap).map(([key, value]) => [value, key]));

      this.edgeInverseMap = new Map([
        ...(Array.from(nonExitEdgeMap).map(([key, value]) => [value, key]) as [TPatternEdge, TPatternEdge][]),
        ...(Array.from(exitEdgeMap).map(([key, value]) => {
          assertEnabled() && assert(value.length === 1);

          return [value[0], key];
        }) as [TPatternEdge, TPatternEdge][]),
      ]);
    }

    this.isIdentityAutomorphism = this.computeIsIdentityAutomorphism();
  }

  private get vertexKeys(): number[] {
    return this.vertexKeyOrder ?? getDefinedIndices(this.mappedVertexIndices);
  }

  private get faceKeys(): number[] {
    return this.faceKeyOrder ?? getDefinedIndices(this.mappedFaceIndices);
  }

  private get nonExitEdgeKeys(): number[] {
    return this.nonExitEdgeKeyOrder ?? getDefinedIndices(this.mappedNonExitEdgeIndices);
  }

  private get exitEdgeKeys(): number[] {
    return this.exitEdgeKeyOrder ?? getDefinedIndices(this.mappedExitEdgeIndices);
  }

  private get sectorKeys(): number[] {
    return this.sectorKeyOrder ?? getDefinedIndices(this.mappedSectorIndices);
  }

  public static fromMaps(
    sourcePatternBoard: TPatternBoard,
    targetPatternBoard: TPatternBoard,
    // TODO: consider alternate implementation with fewer objects?
    vertexMap: Map<TPatternVertex, TPatternVertex>,
    nonExitEdgeMap: Map<TPatternEdge, TPatternEdge>,
    exitEdgeMap: Map<TPatternEdge, TPatternEdge[]>,
    sectorMap: Map<TPatternSector, TPatternSector>,
    faceMap: Map<TPatternFace, TPatternFace>,
  ) {
    return new Embedding(
      sourcePatternBoard,
      targetPatternBoard,
      vertexMap,
      nonExitEdgeMap,
      exitEdgeMap,
      sectorMap,
      faceMap,
    );
  }

  // NOTE: the get*Map() methods build a new Map each call (see the keys above), so avoid them in hot code.

  public getVertexMap(): Map<TPatternVertex, TPatternVertex> {
    return new Map(
      this.vertexKeys.map((index) => [this.sourcePatternBoard.vertices[index], this.mapVertexIndex(index)]),
    );
  }

  public getNonExitEdgeMap(): Map<TPatternEdge, TPatternEdge> {
    return new Map(
      this.nonExitEdgeKeys.map((index) => [
        this.sourcePatternBoard.edges[index],
        this.targetPatternBoard.edges[this.mappedNonExitEdgeIndices[index]],
      ]),
    );
  }

  public getExitEdgeMap(): Map<TPatternEdge, TPatternEdge[]> {
    return new Map(
      this.exitEdgeKeys.map((index) => [this.sourcePatternBoard.edges[index], this.mapExitEdgeIndex(index)]),
    );
  }

  public getSectorMap(): Map<TPatternSector, TPatternSector> {
    return new Map(
      this.sectorKeys.map((index) => [
        this.sourcePatternBoard.sectors[index],
        this.targetPatternBoard.sectors[this.mappedSectorIndices[index]],
      ]),
    );
  }

  public getFaceMap(): Map<TPatternFace, TPatternFace> {
    return new Map(
      this.faceKeys.map((index) => [
        this.sourcePatternBoard.faces[index],
        this.targetPatternBoard.faces[this.mappedFaceIndices[index]],
      ]),
    );
  }

  private mapVertexIndex(index: number): TPatternVertex {
    return this.targetPatternBoard.vertices[this.mappedVertexIndices[index]];
  }

  private mapExitEdgeIndex(index: number): TPatternEdge[] {
    return this.mappedExitEdgeIndices[index].map((mappedIndex) => this.targetPatternBoard.edges[mappedIndex]);
  }

  public mapVertex(vertex: TPatternVertex): TPatternVertex {
    return this.mapVertexIndex(vertex.index);
  }

  public mapNonExitEdge(edge: TPatternEdge): TPatternEdge {
    return this.targetPatternBoard.edges[this.mappedNonExitEdgeIndices[edge.index]];
  }

  public mapExitEdges(edge: TPatternEdge): TPatternEdge[] {
    return this.mapExitEdgeIndex(edge.index);
  }

  public mapSector(sector: TPatternSector): TPatternSector {
    return this.targetPatternBoard.sectors[this.mappedSectorIndices[sector.index]];
  }

  public mapFace(face: TPatternFace): TPatternFace {
    return this.targetPatternBoard.faces[this.mappedFaceIndices[face.index]];
  }

  public inverseMapVertex(vertex: TPatternVertex): TPatternVertex {
    const result = this.vertexInverseMap!.get(vertex)!;
    assertEnabled() && assert(result);

    return result;
  }

  public inverseMapEdge(edge: TPatternEdge): TPatternEdge {
    const result = this.edgeInverseMap!.get(edge)!;
    assertEnabled() && assert(result);

    return result;
  }

  public inverseMapSector(sector: TPatternSector): TPatternSector {
    const result = this.sectorInverseMap!.get(sector)!;
    assertEnabled() && assert(result);

    return result;
  }

  public inverseMapFace(face: TPatternFace): TPatternFace {
    const result = this.faceInverseMap!.get(face)!;
    assertEnabled() && assert(result);

    return result;
  }

  public equals(embedding: Embedding): boolean {
    const sameMapping = (keys: number[], otherKeys: number[], mapped: number[], otherMapped: number[]) =>
      keys.length === otherKeys.length &&
      otherKeys.every((index) => index in mapped) &&
      keys.every((index) => index in otherMapped && mapped[index] === otherMapped[index]);

    return (
      sameMapping(this.vertexKeys, embedding.vertexKeys, this.mappedVertexIndices, embedding.mappedVertexIndices) &&
      sameMapping(
        this.nonExitEdgeKeys,
        embedding.nonExitEdgeKeys,
        this.mappedNonExitEdgeIndices,
        embedding.mappedNonExitEdgeIndices,
      ) &&
      this.exitEdgeKeys.length === embedding.exitEdgeKeys.length &&
      this.exitEdgeKeys.every((index) => {
        const mappedEdges = this.mappedExitEdgeIndices[index];
        const otherMappedEdges = embedding.mappedExitEdgeIndices[index];
        return (
          !!otherMappedEdges &&
          mappedEdges.length === otherMappedEdges.length &&
          mappedEdges.every((edgeIndex, i) => edgeIndex === otherMappedEdges[i])
        );
      }) &&
      sameMapping(this.sectorKeys, embedding.sectorKeys, this.mappedSectorIndices, embedding.mappedSectorIndices) &&
      sameMapping(this.faceKeys, embedding.faceKeys, this.mappedFaceIndices, embedding.mappedFaceIndices)
    );
  }

  public toString(): string {
    const vertexMap = this.getVertexMap();
    const nonExitEdgeMap = this.getNonExitEdgeMap();
    const exitEdgeMap = this.getExitEdgeMap();
    const sectorMap = this.getSectorMap();
    const faceMap = this.getFaceMap();
    return (
      `Embedding(\n` +
      `  vertexMap: ${[...vertexMap].map((pair) => `${pair[0].index} ${pair[0].isExit ? '->' : '=>'} ${pair[1].index}`).join(', ')}\n` +
      `  nonExitEdgeMap: ${[...nonExitEdgeMap].map((pair) => `${pair[0].index} => ${pair[1].index}`).join(', ')}\n` +
      `  exitEdgeMap: ${[...exitEdgeMap].map((pair) => `${pair[0].index} => [${pair[1].map((edge) => edge.index).join(', ')}]`).join(', ')}\n` +
      `  sectorMap: ${[...sectorMap].map((pair) => `${pair[0].index} => ${pair[1].index}`).join(', ')}\n` +
      `  faceMap: ${[...faceMap].map((pair) => `${pair[0].index} ${pair[0].isExit ? '->' : '=>'} ${pair[1].index}`).join(', ')}\n` +
      `)`
    );
  }

  private computeIsIdentityAutomorphism(): boolean {
    if (this.sourcePatternBoard !== this.targetPatternBoard) {
      return false;
    }

    return (
      this.vertexKeys.every((index) => this.mappedVertexIndices[index] === index) &&
      this.nonExitEdgeKeys.every((index) => this.mappedNonExitEdgeIndices[index] === index) &&
      this.exitEdgeKeys.every(
        (index) => this.mappedExitEdgeIndices[index].length === 1 && this.mappedExitEdgeIndices[index][0] === index,
      ) &&
      this.sectorKeys.every((index) => this.mappedSectorIndices[index] === index) &&
      this.faceKeys.every((index) => this.mappedFaceIndices[index] === index)
    );
  }

  public serialize(): SerializedEmbedding {
    return {
      vertexMapping: this.sourcePatternBoard.vertices.map((vertex) => {
        assertEnabled() && assert(vertex.index in this.mappedVertexIndices);

        return this.mappedVertexIndices[vertex.index];
      }),
      edgeMapping: this.sourcePatternBoard.edges.map((edge) => {
        if (edge.isExit) {
          assertEnabled() && assert(edge.index in this.mappedExitEdgeIndices);

          return [...this.mappedExitEdgeIndices[edge.index]];
        } else {
          assertEnabled() && assert(edge.index in this.mappedNonExitEdgeIndices);

          return this.mappedNonExitEdgeIndices[edge.index];
        }
      }),
      sectorMapping: this.sourcePatternBoard.sectors.map((sector) => {
        assertEnabled() && assert(sector.index in this.mappedSectorIndices);

        return this.mappedSectorIndices[sector.index];
      }),
      faceMapping: this.sourcePatternBoard.faces.map((face) => {
        assertEnabled() && assert(face.index in this.mappedFaceIndices);

        return this.mappedFaceIndices[face.index];
      }),
    };
  }

  public static deserialize(
    sourcePatternBoard: TPatternBoard,
    targetPatternBoard: TPatternBoard,
    serialized: SerializedEmbedding,
  ): Embedding {
    return new Embedding(
      sourcePatternBoard,
      targetPatternBoard,
      new Map(
        sourcePatternBoard.vertices.map((vertex) => [
          vertex,
          targetPatternBoard.vertices[serialized.vertexMapping[vertex.index]],
        ]),
      ),
      new Map(
        sourcePatternBoard.edges
          .filter((edge) => !edge.isExit)
          .map((edge) => [edge, targetPatternBoard.edges[serialized.edgeMapping[edge.index] as number]]),
      ),
      new Map(
        sourcePatternBoard.edges
          .filter((edge) => edge.isExit)
          .map((edge) => [
            edge,
            (serialized.edgeMapping[edge.index] as number[]).map((index) => targetPatternBoard.edges[index]),
          ]),
      ),
      new Map(
        sourcePatternBoard.sectors.map((sector) => [
          sector,
          targetPatternBoard.sectors[serialized.sectorMapping[sector.index]],
        ]),
      ),
      new Map(
        sourcePatternBoard.faces.map((face) => [face, targetPatternBoard.faces[serialized.faceMapping[face.index]]]),
      ),
    );
  }
}

export type SerializedEmbedding = {
  vertexMapping: number[];
  edgeMapping: (number | number[])[];
  sectorMapping: number[];
  faceMapping: number[];
};
