import { sleep } from './sleep.ts';
import { yieldToEventLoop } from './yieldToEventLoop.ts';

import { TReadOnlyProperty } from 'scenerystack/axon';

import { InterruptedError } from '../model/solver/errors/InterruptedError.ts';

const debugSleep = false;

export const interruptableSleep = async function (
  milliseconds: number,
  interruptedProperty: TReadOnlyProperty<boolean>,
) {
  await (milliseconds === 0 ? yieldToEventLoop() : sleep(milliseconds));
  debugSleep && console.log('after sleep before interrupt check');

  if (interruptedProperty.value) {
    throw new InterruptedError();
  }
};
