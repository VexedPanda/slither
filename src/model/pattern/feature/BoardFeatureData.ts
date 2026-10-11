import { TEdge } from '../../board/core/TEdge.ts';
import { TFace } from '../../board/core/TFace.ts';
import { TSector } from '../../data/sector-state/TSector.ts';
import EdgeState from '../../data/edge-state/EdgeState.ts';
import { TEdgeStateData } from '../../data/edge-state/TEdgeStateData.ts';
import { TFaceColor, TFaceColorData } from '../../data/face-color/TFaceColorData.ts';
import FaceValue from '../../data/face-value/FaceValue.ts';
import { TFaceValueData } from '../../data/face-value/TFaceValueData.ts';
import { TSectorStateData } from '../../data/sector-state/TSectorStateData.ts';
import { BoardPatternBoard } from '../pattern-board/BoardPatternBoard.ts';
import { TBoardFeatureData } from './TBoardFeatureData.ts';

import assert, { assertEnabled } from '../../../workarounds/assert.ts';

export class BoardFeatureData implements TBoardFeatureData {
  public readonly faceValues: FaceValue[] = [];
  public readonly faceColors: TFaceColor[] = [];
  public readonly oppositeFaceColors: (TFaceColor | null)[] = [];
  public readonly redEdgeValues: boolean[] = [];
  public readonly blackEdgeValues: boolean[] = [];
  public readonly sectorNotZeroValues: boolean[] = [];
  public readonly sectorNotOneValues: boolean[] = [];
  public readonly sectorNotTwoValues: boolean[] = [];
  public readonly sectorOnlyOneValues: boolean[] = [];

  public constructor(
    public readonly boardPatternBoard: BoardPatternBoard,
    public readonly inputData: TFaceValueData & TEdgeStateData & TSectorStateData & TFaceColorData,
  ) {
    const positions = getBoardFeaturePositions(boardPatternBoard);

    for (const patternFace of boardPatternBoard.faces) {
      const boardFace = boardPatternBoard.getFace(patternFace);

      this.faceValues.push(boardFace ? inputData.getFaceValue(boardFace) : null);
    }
    this.updateFaceColors();

    for (let i = 0; i < positions.edges.length; i++) {
      this.updateEdgeAtIndex(positions.edges[i], i);
    }

    for (let i = 0; i < positions.sectors.length; i++) {
      this.updateSectorAtIndex(positions.sectors[i], i);
    }
  }

  // The update methods below keep this in sync with changes to inputData (from its change emitters), giving the same
  // result as constructing a new BoardFeatureData, without rebuilding everything for each change.

  public updateFaceValue(face: TFace): void {
    const index = getBoardFeaturePositions(this.boardPatternBoard).faceIndexMap.get(face)!;
    assertEnabled() && assert(index !== undefined);

    this.faceValues[index] = this.inputData.getFaceValue(face);
  }

  // Face colors can be merged/changed across the whole board, so we just recompute them
  public updateFaceColors(): void {
    const boardPatternBoard = this.boardPatternBoard;
    const inputData = this.inputData;

    for (let i = 0; i < boardPatternBoard.faces.length; i++) {
      const boardFace = boardPatternBoard.getFace(boardPatternBoard.faces[i]);

      const faceColor = boardFace ? inputData.getFaceColor(boardFace) : inputData.getOutsideColor();

      this.faceColors[i] = faceColor;
      this.oppositeFaceColors[i] = inputData.getOppositeFaceColor(faceColor);
    }
  }

  public updateEdge(edge: TEdge): void {
    const index = getBoardFeaturePositions(this.boardPatternBoard).edgeIndexMap.get(edge)!;
    assertEnabled() && assert(index !== undefined);

    this.updateEdgeAtIndex(edge, index);
  }

  public updateSector(sector: TSector): void {
    const index = getBoardFeaturePositions(this.boardPatternBoard).sectorIndexMap.get(sector)!;
    assertEnabled() && assert(index !== undefined);

    this.updateSectorAtIndex(sector, index);
  }

  private updateEdgeAtIndex(edge: TEdge, index: number): void {
    const edgeState = this.inputData.getEdgeState(edge);

    this.redEdgeValues[index] = edgeState === EdgeState.RED;
    this.blackEdgeValues[index] = edgeState === EdgeState.BLACK;
  }

  private updateSectorAtIndex(sector: TSector, index: number): void {
    const sectorState = this.inputData.getSectorState(sector);

    this.sectorNotZeroValues[index] = !sectorState.zero;
    this.sectorNotOneValues[index] = !sectorState.one;
    this.sectorNotTwoValues[index] = !sectorState.two;
    this.sectorOnlyOneValues[index] = !sectorState.zero && sectorState.one && !sectorState.two;
  }
}

// Board elements in the order of the pattern board's elements, and the reverse mapping
export type Positions = {
  edges: TEdge[];
  sectors: TSector[];
  faceIndexMap: Map<TFace, number>;
  edgeIndexMap: Map<TEdge, number>;
  sectorIndexMap: Map<TSector, number>;
};

const positionsMap = new WeakMap<BoardPatternBoard, Positions>();

export const getBoardFeaturePositions = (boardPatternBoard: BoardPatternBoard): Positions => {
  let positions = positionsMap.get(boardPatternBoard);

  if (!positions) {
    const edges = boardPatternBoard.edges.map((patternEdge) => boardPatternBoard.getEdge(patternEdge));
    const sectors = boardPatternBoard.sectors.map((patternSector) => boardPatternBoard.getSector(patternSector));

    const faceIndexMap = new Map<TFace, number>();
    boardPatternBoard.faces.forEach((patternFace, index) => {
      const face = boardPatternBoard.getFace(patternFace);
      if (face) {
        faceIndexMap.set(face, index);
      }
    });

    positions = {
      edges,
      sectors,
      faceIndexMap,
      edgeIndexMap: new Map(edges.map((edge, index) => [edge, index])),
      sectorIndexMap: new Map(sectors.map((sector, index) => [sector, index])),
    };
    positionsMap.set(boardPatternBoard, positions);
  }

  return positions;
};
