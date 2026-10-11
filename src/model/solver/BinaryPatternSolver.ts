import { TBoard } from '../board/core/TBoard.ts';
import { TEdge } from '../board/core/TEdge.ts';
import { TFace } from '../board/core/TFace.ts';
import { getQuickBoardSpanningFaceCount } from '../board/core/getQuickBoardSpanningFaceCount.ts';
import { hasNonzeroSeparateFace } from '../board/core/hasNonzeroSeparateFace.ts';
import { TCompleteData } from '../data/combined/TCompleteData.ts';
import { TAnnotatedAction } from '../data/core/TAnnotatedAction.ts';
import { TState } from '../data/core/TState.ts';
import { TEdgeStateData } from '../data/edge-state/TEdgeStateData.ts';
import { TFaceColorData } from '../data/face-color/TFaceColorData.ts';
import { TFaceValueData } from '../data/face-value/TFaceValueData.ts';
import { TSector } from '../data/sector-state/TSector.ts';
import { TSectorStateData } from '../data/sector-state/TSectorStateData.ts';
import { ActionableRuleEmbedding } from '../pattern/collection/ActionableRuleEmbedding.ts';
import { BinaryMixedRuleGroup } from '../pattern/collection/BinaryMixedRuleGroup.ts';
import { Embedding } from '../pattern/embedding/Embedding.ts';
import { getEmbeddingTouchIndex } from '../pattern/embedding/getEmbeddingTouchIndex.ts';
import { getEmbeddings } from '../pattern/embedding/getEmbeddings.ts';
import { BoardFeatureData, getBoardFeaturePositions } from '../pattern/feature/BoardFeatureData.ts';
import { TBoardFeatureData } from '../pattern/feature/TBoardFeatureData.ts';
import { BoardPatternBoard } from '../pattern/pattern-board/BoardPatternBoard.ts';
import { TPatternBoard } from '../pattern/pattern-board/TPatternBoard.ts';
import { getPatternRuleAction } from '../pattern/solve/getPatternRuleAction.ts';
import { TSolver } from './TSolver.ts';

import assert, { assertEnabled } from '../../workarounds/assert.ts';

type Data = TFaceValueData & TEdgeStateData & TSectorStateData & TFaceColorData;

export type BinaryPatternSolverData = {
  size: number;
  getRulePatternBoard: (ruleIndex: number) => TPatternBoard;

  // undefined if not actionable, null if degenerate (getNext would stop with null)
  getActionable: (
    targetPatternBoard: TPatternBoard,
    boardData: TBoardFeatureData,
    ruleIndex: number,
    embedding: Embedding,
    embeddingIndex: number,
  ) => ActionableRuleEmbedding | null | undefined;

  ruleHasFaceColorFeatures: (ruleIndex: number) => boolean;

  // Shared between solvers for the same rules (see loadSnapshot)
  snapshots: Map<BoardPatternBoard, ScanSnapshot>;
};

// What a solver knew after its first full scan, and the feature data it was for
type ScanSnapshot = {
  verifiedCounts: number[];
  exceptionLists: number[][];
  faceValues: TBoardFeatureData['faceValues'];
  redEdgeValues: boolean[];
  blackEdgeValues: boolean[];
  sectorNotZeroValues: boolean[];
  sectorNotOneValues: boolean[];
  sectorNotTwoValues: boolean[];
  sectorOnlyOneValues: boolean[];
};

// Snapshots for each group and size (number of rules used)
const groupSnapshotsMap = new WeakMap<BinaryMixedRuleGroup, Map<number, Map<BoardPatternBoard, ScanSnapshot>>>();

// Change log entries: the kind of changed element, combined with its index (in the board pattern board)
const FACE_CHANGE = 0;
const EDGE_CHANGE = 1;
const SECTOR_CHANGE = 2;
const CHANGE_KIND_MULTIPLIER = 2 ** 24;

// Compact the change log when it gets this long
const MAX_CHANGE_LOG_LENGTH = 2 ** 16;

export class BinaryPatternSolver implements TSolver<Data, TAnnotatedAction<Data>> {
  private nextRuleIndex: number;
  private nextEmbeddingIndex: number;

  private readonly dirtyListener: () => void;

  // Kept up to date with the state (instead of being rebuilt for every action), created on first use
  private boardFeatureData: BoardFeatureData | null = null;
  private readonly faceValueListener: (face: TFace) => void;
  private readonly edgeStateListener: (edge: TEdge) => void;
  private readonly sectorStateListener: (sector: TSector) => void;
  private readonly faceColorsListener: () => void;

  // Incremental scanning. Whenever the state changes, we need the first actionable rule embedding (in rule order, then
  // embedding order). Rescanning every embedding of every rule after each change is slow, so per rule we track that
  // every embedding before verifiedCounts[ ruleIndex ] was found not actionable when last checked, EXCEPT:
  //   - the (sorted) embedding indices in exceptionLists[ ruleIndex ] (actionable but skipped or returned, or not
  //     re-checked yet), and
  //   - the embeddings touching anything changed since changeLog[ logIndices[ ruleIndex ] ].
  // An embedding's actionability only depends on the faces/edges/sectors it maps to, so the others can't have changed.
  // Face colors are the exception (they can change anywhere), so rules with face color features are fully rescanned
  // after face color changes. This finds exactly the same next action as checking everything in order.
  private readonly verifiedCounts: number[];
  private readonly exceptionLists: number[][];
  private readonly logIndices: number[];
  private changeLog: number[] = [];
  private readonly faceColorRuleIndices: number[] = [];
  private readonly ruleEmbeddings: (Embedding[] | undefined)[] = [];
  private hasScanned = false;

  private readonly quickSpanningCount: number;

  protected constructor(
    private readonly board: TBoard,
    private readonly boardPatternBoard: BoardPatternBoard,
    private readonly state: TState<Data>,
    private readonly binaryData: BinaryPatternSolverData,
    initialIndex = 0,
    initialEmbeddingIndex = 0,
  ) {
    this.quickSpanningCount = getQuickBoardSpanningFaceCount(board, state);

    this.nextRuleIndex = initialIndex;
    this.nextEmbeddingIndex = initialEmbeddingIndex;

    this.verifiedCounts = new Array(binaryData.size).fill(0);
    this.exceptionLists = new Array(binaryData.size).fill(null).map(() => []);
    this.logIndices = new Array(binaryData.size).fill(0);
    for (let ruleIndex = 0; ruleIndex < binaryData.size; ruleIndex++) {
      if (binaryData.ruleHasFaceColorFeatures(ruleIndex)) {
        this.faceColorRuleIndices.push(ruleIndex);
      }
    }

    this.dirtyListener = () => {
      this.nextRuleIndex = 0;
      this.nextEmbeddingIndex = 0;
    };

    const positions = getBoardFeaturePositions(boardPatternBoard);

    this.faceValueListener = (face) => {
      this.boardFeatureData?.updateFaceValue(face);
      this.changeLog.push(FACE_CHANGE * CHANGE_KIND_MULTIPLIER + positions.faceIndexMap.get(face)!);
      this.dirtyListener();
    };
    this.edgeStateListener = (edge) => {
      this.boardFeatureData?.updateEdge(edge);
      this.changeLog.push(EDGE_CHANGE * CHANGE_KIND_MULTIPLIER + positions.edgeIndexMap.get(edge)!);
      this.dirtyListener();
    };
    this.sectorStateListener = (sector) => {
      this.boardFeatureData?.updateSector(sector);
      this.changeLog.push(SECTOR_CHANGE * CHANGE_KIND_MULTIPLIER + positions.sectorIndexMap.get(sector)!);
      this.dirtyListener();
    };
    this.faceColorsListener = () => {
      this.boardFeatureData?.updateFaceColors();
      for (const ruleIndex of this.faceColorRuleIndices) {
        this.verifiedCounts[ruleIndex] = 0;
        this.exceptionLists[ruleIndex] = [];
      }
      this.dirtyListener();
    };

    this.state.faceValueChangedEmitter.addListener(this.faceValueListener);
    this.state.edgeStateChangedEmitter.addListener(this.edgeStateListener);
    this.state.sectorStateChangedEmitter.addListener(this.sectorStateListener);
    this.state.faceColorsChangedEmitter.addListener(this.faceColorsListener);
  }

  public get dirty(): boolean {
    return this.nextRuleIndex < this.binaryData.size;
  }

  public nextAction(): TAnnotatedAction<Data> | null {
    if (!this.dirty) {
      return null;
    }

    const boardFeatureData = (this.boardFeatureData ??= new BoardFeatureData(this.boardPatternBoard, this.state));

    const match = this.findNextMatch(boardFeatureData);

    if (match) {
      return getPatternRuleAction(this.boardPatternBoard, this.state, match.embeddedRule, match.rule, match.embedding);
    } else {
      return null;
    }
  }

  // Check to see if we can apply the rule (is there another unaffected face?)
  // E.g. https://github.com/jonathanolson/slither/issues/2
  private hasSeparateFace(match: ActionableRuleEmbedding): boolean {
    if (match.rule.patternBoard.faces.length >= this.quickSpanningCount) {
      // If the rule has the same or more faces than our quick span count, we'll need to do more checks

      const rulePatternFaces = match.rule.patternBoard.faces.map((face) => match.embedding.mapFace(face));
      const ruleFaces = new Set(
        rulePatternFaces.map((face) => this.boardPatternBoard.getFace(face)).filter((f) => f !== null) as TFace[],
      );

      return hasNonzeroSeparateFace(this.board, this.state, ruleFaces);
    }
    return true;
  }

  // The first actionable rule embedding (with a separate face) at or after the next position, the same as checking
  // every embedding in order (see the incremental scanning notes above).
  private findNextMatch(boardFeatureData: BoardFeatureData): ActionableRuleEmbedding | null {
    const targetPatternBoard = this.boardPatternBoard;
    const startRuleIndex = this.nextRuleIndex;
    const startEmbeddingIndex = this.nextEmbeddingIndex;

    this.compactChangeLog();

    this.touchedCache.clear();

    if (!this.hasScanned && startRuleIndex === 0 && startEmbeddingIndex === 0) {
      return this.findFirstMatch(boardFeatureData);
    }

    for (let ruleIndex = startRuleIndex; ruleIndex < this.binaryData.size; ruleIndex++) {
      const embeddings = this.getRuleEmbeddings(ruleIndex);
      const verifiedCount = this.verifiedCounts[ruleIndex];
      const oldExceptions = this.exceptionLists[ruleIndex];

      // Fast path: nothing to check for this rule
      if (
        verifiedCount === embeddings.length &&
        oldExceptions.length === 0 &&
        this.logIndices[ruleIndex] === this.changeLog.length &&
        !(ruleIndex === startRuleIndex && startEmbeddingIndex > 0)
      ) {
        continue;
      }

      const check = (embeddingIndex: number) =>
        this.binaryData.getActionable(
          targetPatternBoard,
          boardFeatureData,
          ruleIndex,
          embeddings[embeddingIndex],
          embeddingIndex,
        );

      // Continuing within a rule right after a match, without changes (rare): check in order, leaving what we know
      // about this rule unchanged (it is all still true, since nothing changed).
      if (ruleIndex === startRuleIndex && startEmbeddingIndex > 0) {
        for (let embeddingIndex = startEmbeddingIndex; embeddingIndex < embeddings.length; embeddingIndex++) {
          const match = check(embeddingIndex);
          if (match === undefined) {
            continue;
          } else if (match === null) {
            return this.finishDegenerate();
          } else if (this.hasSeparateFace(match)) {
            // It may be passed over by the next call, so we'll need to re-check it after changes
            if (embeddingIndex < verifiedCount) {
              this.addException(ruleIndex, embeddingIndex);
            }
            return this.finishMatch(match);
          }
        }
        continue;
      }

      const candidates = this.getCandidates(ruleIndex, embeddings);

      // Everything changed so far will be checked (or kept as exceptions), so the log index moves to now
      this.logIndices[ruleIndex] = this.changeLog.length;

      const newExceptions: number[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const embeddingIndex = candidates[i];
        const match = check(embeddingIndex);

        if (match === undefined) {
          continue;
        } else if (match === null) {
          return this.finishDegenerate();
        } else if (!this.hasSeparateFace(match)) {
          newExceptions.push(embeddingIndex);
        } else {
          // This match, and the candidates after it (not checked yet), stay as exceptions
          for (let j = i; j < candidates.length; j++) {
            newExceptions.push(candidates[j]);
          }
          this.exceptionLists[ruleIndex] = newExceptions;
          return this.finishMatch(match);
        }
      }

      // Then the embeddings not verified yet
      for (let embeddingIndex = verifiedCount; embeddingIndex < embeddings.length; embeddingIndex++) {
        const match = check(embeddingIndex);

        if (match === undefined) {
          continue;
        } else if (match === null) {
          return this.finishDegenerate();
        } else if (!this.hasSeparateFace(match)) {
          newExceptions.push(embeddingIndex);
        } else {
          newExceptions.push(embeddingIndex);
          this.exceptionLists[ruleIndex] = newExceptions;
          this.verifiedCounts[ruleIndex] = embeddingIndex + 1;
          return this.finishMatch(match);
        }
      }

      this.exceptionLists[ruleIndex] = newExceptions;
      this.verifiedCounts[ruleIndex] = embeddings.length;
    }

    this.nextRuleIndex = this.binaryData.size;
    this.nextEmbeddingIndex = 0;
    return null;
  }

  // Sorted indices of embeddings touched by changes since a log index, cached per embeddings array and log index (for
  // one scan)
  private readonly touchedCache = new Map<Embedding[], Map<number, number[]>>();

  private getTouched(embeddings: Embedding[], logIndex: number): number[] {
    let embeddingsCache = this.touchedCache.get(embeddings);
    if (!embeddingsCache) {
      embeddingsCache = new Map();
      this.touchedCache.set(embeddings, embeddingsCache);
    }
    let touched = embeddingsCache.get(logIndex);
    if (!touched) {
      const touchIndex = getEmbeddingTouchIndex(embeddings);
      const changes = new Set(this.changeLog.slice(logIndex));
      const touchedSet = new Set<number>();
      for (const change of changes) {
        const kind = Math.floor(change / CHANGE_KIND_MULTIPLIER);
        const lists =
          kind === FACE_CHANGE ? touchIndex.faces
          : kind === EDGE_CHANGE ? touchIndex.edges
          : touchIndex.sectors;
        const list = lists[change - kind * CHANGE_KIND_MULTIPLIER];
        if (list) {
          for (const embeddingIndex of list) {
            touchedSet.add(embeddingIndex);
          }
        }
      }
      touched = [...touchedSet].sort((a, b) => a - b);
      embeddingsCache.set(logIndex, touched);
    }
    return touched;
  }

  private getRuleEmbeddings(ruleIndex: number): Embedding[] {
    return (this.ruleEmbeddings[ruleIndex] ??= getEmbeddings(
      this.binaryData.getRulePatternBoard(ruleIndex),
      this.boardPatternBoard,
    ));
  }

  // The exceptions and the touched embeddings before verifiedCount, merged in order (to re-check)
  private getCandidates(ruleIndex: number, embeddings: Embedding[]): number[] {
    const verifiedCount = this.verifiedCounts[ruleIndex];
    const exceptions = this.exceptionLists[ruleIndex];
    const touched = verifiedCount > 0 ? this.getTouched(embeddings, this.logIndices[ruleIndex]) : [];

    const candidates: number[] = [];
    let i = 0;
    let j = 0;
    while (true) {
      const a = i < exceptions.length ? exceptions[i] : Number.POSITIVE_INFINITY;
      const b = j < touched.length && touched[j] < verifiedCount ? touched[j] : Number.POSITIVE_INFINITY;
      if (a === Number.POSITIVE_INFINITY && b === Number.POSITIVE_INFINITY) {
        break;
      }
      const next = Math.min(a, b);
      candidates.push(next);
      if (a === next) {
        i++;
      }
      if (b === next) {
        j++;
      }
    }
    return candidates;
  }

  // The first scan of a solver. Consecutive solvers (e.g. difficulty checks during generation) usually start from
  // similar states, so we start from what the last solver for the same rules knew after its first scan (if any),
  // treating every difference in the feature data as a change. We then check everything (instead of stopping at the
  // first match), so that every rule is verified and we can save that knowledge for the next solver. Everything gets
  // checked at least once during a solver's lifetime anyway.
  private findFirstMatch(boardFeatureData: BoardFeatureData): ActionableRuleEmbedding | null {
    this.hasScanned = true;
    this.loadSnapshot(boardFeatureData);

    let firstMatch: ActionableRuleEmbedding | null = null;

    for (let ruleIndex = 0; ruleIndex < this.binaryData.size; ruleIndex++) {
      const embeddings = this.getRuleEmbeddings(ruleIndex);
      const candidates = this.getCandidates(ruleIndex, embeddings);

      const newExceptions: number[] = [];
      const checkEmbedding = (embeddingIndex: number): boolean => {
        const match = this.binaryData.getActionable(
          this.boardPatternBoard,
          boardFeatureData,
          ruleIndex,
          embeddings[embeddingIndex],
          embeddingIndex,
        );

        if (match === undefined) {
          return true;
        } else if (match === null) {
          // Degenerate: if it comes before the first match, the original scan would stop here
          if (!firstMatch) {
            return false;
          }
        } else if (!firstMatch && this.hasSeparateFace(match)) {
          firstMatch = match;
        }

        // Every other actionable embedding is an exception (to re-check later)
        newExceptions.push(embeddingIndex);
        return true;
      };

      for (const embeddingIndex of candidates) {
        if (!checkEmbedding(embeddingIndex)) {
          return this.finishDegenerate();
        }
      }
      for (let embeddingIndex = this.verifiedCounts[ruleIndex]; embeddingIndex < embeddings.length; embeddingIndex++) {
        if (!checkEmbedding(embeddingIndex)) {
          return this.finishDegenerate();
        }
      }

      this.exceptionLists[ruleIndex] = newExceptions;
      this.verifiedCounts[ruleIndex] = embeddings.length;
      this.logIndices[ruleIndex] = this.changeLog.length;
    }

    this.saveSnapshot(boardFeatureData);

    if (firstMatch) {
      return this.finishMatch(firstMatch);
    } else {
      this.nextRuleIndex = this.binaryData.size;
      this.nextEmbeddingIndex = 0;
      return null;
    }
  }

  private loadSnapshot(boardFeatureData: BoardFeatureData): void {
    const snapshot = this.binaryData.snapshots.get(this.boardPatternBoard);
    if (!snapshot) {
      return;
    }

    for (let ruleIndex = 0; ruleIndex < this.binaryData.size; ruleIndex++) {
      this.verifiedCounts[ruleIndex] = snapshot.verifiedCounts[ruleIndex];
      this.exceptionLists[ruleIndex] = snapshot.exceptionLists[ruleIndex].slice();
      this.logIndices[ruleIndex] = this.changeLog.length;
    }

    // Face colors aren't comparable between states
    for (const ruleIndex of this.faceColorRuleIndices) {
      this.verifiedCounts[ruleIndex] = 0;
      this.exceptionLists[ruleIndex] = [];
    }

    // Every difference counts as a change
    for (let i = 0; i < snapshot.faceValues.length; i++) {
      if (snapshot.faceValues[i] !== boardFeatureData.faceValues[i]) {
        this.changeLog.push(FACE_CHANGE * CHANGE_KIND_MULTIPLIER + i);
      }
    }
    for (let i = 0; i < snapshot.redEdgeValues.length; i++) {
      if (
        snapshot.redEdgeValues[i] !== boardFeatureData.redEdgeValues[i] ||
        snapshot.blackEdgeValues[i] !== boardFeatureData.blackEdgeValues[i]
      ) {
        this.changeLog.push(EDGE_CHANGE * CHANGE_KIND_MULTIPLIER + i);
      }
    }
    for (let i = 0; i < snapshot.sectorNotZeroValues.length; i++) {
      if (
        snapshot.sectorNotZeroValues[i] !== boardFeatureData.sectorNotZeroValues[i] ||
        snapshot.sectorNotOneValues[i] !== boardFeatureData.sectorNotOneValues[i] ||
        snapshot.sectorNotTwoValues[i] !== boardFeatureData.sectorNotTwoValues[i] ||
        snapshot.sectorOnlyOneValues[i] !== boardFeatureData.sectorOnlyOneValues[i]
      ) {
        this.changeLog.push(SECTOR_CHANGE * CHANGE_KIND_MULTIPLIER + i);
      }
    }

  }

  private saveSnapshot(boardFeatureData: BoardFeatureData): void {
    this.binaryData.snapshots.set(this.boardPatternBoard, {
      verifiedCounts: this.verifiedCounts.slice(),
      exceptionLists: this.exceptionLists.map((exceptions) => exceptions.slice()),
      faceValues: boardFeatureData.faceValues.slice(),
      redEdgeValues: boardFeatureData.redEdgeValues.slice(),
      blackEdgeValues: boardFeatureData.blackEdgeValues.slice(),
      sectorNotZeroValues: boardFeatureData.sectorNotZeroValues.slice(),
      sectorNotOneValues: boardFeatureData.sectorNotOneValues.slice(),
      sectorNotTwoValues: boardFeatureData.sectorNotTwoValues.slice(),
      sectorOnlyOneValues: boardFeatureData.sectorOnlyOneValues.slice(),
    });
  }

  private addException(ruleIndex: number, embeddingIndex: number): void {
    const exceptions = this.exceptionLists[ruleIndex];
    if (!exceptions.includes(embeddingIndex)) {
      exceptions.push(embeddingIndex);
      exceptions.sort((a, b) => a - b);
    }
  }

  private finishMatch(match: ActionableRuleEmbedding): ActionableRuleEmbedding {
    // If called again immediately, we will only start searching from here (find a new embedding)
    this.nextRuleIndex = match.ruleIndex;
    this.nextEmbeddingIndex = match.embeddingIndex + 1;

    return match;
  }

  // Matches the original behavior of stopping. Rare, so we just forget what we know.
  private finishDegenerate(): null {
    this.nextRuleIndex = this.binaryData.size;
    this.nextEmbeddingIndex = 0;

    this.verifiedCounts.fill(0);
    for (let ruleIndex = 0; ruleIndex < this.binaryData.size; ruleIndex++) {
      this.exceptionLists[ruleIndex] = [];
    }

    return null;
  }

  // Drops change log entries that no rule still needs
  private compactChangeLog(): void {
    if (this.changeLog.length > MAX_CHANGE_LOG_LENGTH) {
      let minLogIndex = this.changeLog.length;
      for (let ruleIndex = 0; ruleIndex < this.binaryData.size; ruleIndex++) {
        if (this.verifiedCounts[ruleIndex] > 0) {
          minLogIndex = Math.min(minLogIndex, this.logIndices[ruleIndex]);
        }
      }
      this.changeLog = this.changeLog.slice(minLogIndex);
      for (let ruleIndex = 0; ruleIndex < this.binaryData.size; ruleIndex++) {
        this.logIndices[ruleIndex] = Math.max(0, this.logIndices[ruleIndex] - minLogIndex);
      }
    }
  }

  public clone(equivalentState: TState<Data>): BinaryPatternSolver {
    return new BinaryPatternSolver(
      this.board,
      this.boardPatternBoard,
      equivalentState,
      this.binaryData,
      this.nextRuleIndex,
    );
  }

  public dispose(): void {
    this.state.faceValueChangedEmitter.removeListener(this.faceValueListener);
    this.state.edgeStateChangedEmitter.removeListener(this.edgeStateListener);
    this.state.sectorStateChangedEmitter.removeListener(this.sectorStateListener);
    this.state.faceColorsChangedEmitter.removeListener(this.faceColorsListener);
  }

  public static fromGroup(
    board: TBoard,
    boardPatternBoard: BoardPatternBoard,
    state: TState<TCompleteData>,
    group: BinaryMixedRuleGroup,
    size = group.size,
  ): BinaryPatternSolver {
    assertEnabled() && assert(size <= group.size);

    const highlanderOverride = (ruleIndex: number) => group.isRuleIndexHighlander(ruleIndex);

    return new BinaryPatternSolver(board, boardPatternBoard, state, {
      size: size,
      getRulePatternBoard: (ruleIndex) => group.collection.getRulePatternBoard(ruleIndex),
      getActionable: (targetPatternBoard, boardData, ruleIndex, embedding, embeddingIndex) => {
        return group.collection.getActionableEmbeddedRuleFromData(
          targetPatternBoard,
          boardData,
          ruleIndex,
          embedding,
          embeddingIndex,
          highlanderOverride,
        );
      },
      ruleHasFaceColorFeatures: (ruleIndex) => group.collection.ruleHasFaceColorFeatures(ruleIndex),
      snapshots: getSnapshots(group, size),
    });
  }
}

const getSnapshots = (group: BinaryMixedRuleGroup, size: number): Map<BoardPatternBoard, ScanSnapshot> => {
  let sizeMap = groupSnapshotsMap.get(group);
  if (!sizeMap) {
    sizeMap = new Map();
    groupSnapshotsMap.set(group, sizeMap);
  }
  let snapshots = sizeMap.get(size);
  if (!snapshots) {
    snapshots = new Map();
    sizeMap.set(size, snapshots);
  }
  return snapshots;
};
