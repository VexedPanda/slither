import { glassPane } from './glassPane.ts';
import PuzzleNode from './puzzle/PuzzleNode.ts';

import { TinyProperty } from 'scenerystack/axon';
import { NodeOptions } from 'scenerystack/scenery';

import { TBoard } from '../model/board/core/TBoard.ts';
import { TCompleteData } from '../model/data/combined/TCompleteData.ts';
import { TState } from '../model/data/core/TState.ts';

export const debugBoardState = (board: TBoard, state: TState<TCompleteData>, options?: NodeOptions) => {
  const puzzleNode = new PuzzleNode(
    {
      board: board,
      stateProperty: new TinyProperty(state),
    },
    options,
  );
  glassPane.addChild(puzzleNode);
};
