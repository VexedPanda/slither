import { TBoard } from '../board/core/TBoard.ts';
import { TEdge } from '../board/core/TEdge.ts';
import { TState } from '../data/core/TState.ts';
import EdgeState from '../data/edge-state/EdgeState.ts';
import { TEdgeStateData } from '../data/edge-state/TEdgeStateData.ts';
import { TFaceValueData } from '../data/face-value/TFaceValueData.ts';

// Most recent loops are checked first, and the oldest are dropped past this.
const MAX_SOLUTIONS = 200;

type KnownSolution = {
  key: string;
  edges: Set<TEdge>;
  faceEdgeCounts: Uint8Array; // number of the loop's edges around each face (by face index)
};

/**
 * Loops found by earlier SAT solves on a board. If two of them are valid solutions for a state, that state has multiple
 * solutions, so generation can skip the (much slower) SAT solve that would tell it the same thing.
 *
 * "Valid" here is stricter than (a subset of) what satSolve accepts, so this never claims multiple solutions when
 * satSolve would find fewer than two (ignoring its iteration limit).
 */
export class KnownSolutions {
  private readonly solutions: KnownSolution[] = [];
  private readonly keys = new Set<string>();
  private readonly edgeIndexMap: Map<TEdge, number>;

  private constructor(private readonly board: TBoard) {
    this.edgeIndexMap = new Map(board.edges.map((edge, index) => [edge, index]));
  }

  public add(solutions: TEdge[][]): void {
    for (const solution of solutions) {
      const key = solution
        .map((edge) => this.edgeIndexMap.get(edge)!)
        .sort((a, b) => a - b)
        .join(',');

      if (!this.keys.has(key)) {
        const edges = new Set(solution);
        const faceEdgeCounts = new Uint8Array(this.board.faces.length);
        this.board.faces.forEach((face, faceIndex) => {
          faceEdgeCounts[faceIndex] = face.edges.filter((edge) => edges.has(edge)).length;
        });

        this.keys.add(key);
        this.solutions.push({ key, edges, faceEdgeCounts });

        if (this.solutions.length > MAX_SOLUTIONS) {
          this.keys.delete(this.solutions.shift()!.key);
        }
      }
    }
  }

  public hasMultipleSolutions(state: TState<TEdgeStateData & TFaceValueData>): boolean {
    const faceIndices: number[] = [];
    const faceValues: number[] = [];
    this.board.faces.forEach((face, faceIndex) => {
      const faceValue = state.getFaceValue(face);
      if (faceValue !== null) {
        faceIndices.push(faceIndex);
        faceValues.push(faceValue);
      }
    });
    if (!faceIndices.length) {
      return false;
    }

    const blackEdges = this.board.edges.filter((edge) => state.getEdgeState(edge) === EdgeState.BLACK);
    const redEdges = this.board.edges.filter((edge) => state.getEdgeState(edge) === EdgeState.RED);

    let count = 0;
    for (let i = this.solutions.length - 1; i >= 0; i--) {
      const solution = this.solutions[i];
      const faceEdgeCounts = solution.faceEdgeCounts;

      let isValid = true;
      let touchesValue = false;
      for (let j = 0; j < faceIndices.length; j++) {
        const faceEdgeCount = faceEdgeCounts[faceIndices[j]];
        if (faceEdgeCount !== faceValues[j]) {
          isValid = false;
          break;
        }
        touchesValue ||= faceEdgeCount > 0;
      }

      // satSolve only counts loops that touch a face with a value
      isValid =
        isValid &&
        touchesValue &&
        blackEdges.every((edge) => solution.edges.has(edge)) &&
        redEdges.every((edge) => !solution.edges.has(edge));

      if (isValid && ++count >= 2) {
        return true;
      }
    }
    return false;
  }

  private static readonly boardMap = new WeakMap<TBoard, KnownSolutions>();

  public static get(board: TBoard): KnownSolutions {
    let knownSolutions = KnownSolutions.boardMap.get(board);
    if (!knownSolutions) {
      knownSolutions = new KnownSolutions(board);
      KnownSolutions.boardMap.set(board, knownSolutions);
    }
    return knownSolutions;
  }
}
