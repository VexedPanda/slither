import { TEmitter } from 'scenerystack/axon';

export interface TAnyData {
  anyStateChangedEmitter: TEmitter;
}

export type TAnyStateListener = () => void;
