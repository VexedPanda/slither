import { assert } from 'scenerystack/assert';

export default (predicate: unknown, ...messages: unknown[]): void => assert!(predicate, ...messages);

export const assertEnabled = (): boolean => !!assert;
