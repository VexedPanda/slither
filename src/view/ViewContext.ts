import { TReadOnlyProperty, TinyEmitter } from 'scenerystack/axon';
import { Bounds2 } from 'scenerystack/dot';
import { Node } from 'scenerystack/scenery';

export class ViewContext {
  public constructor(
    public readonly layoutBoundsProperty: TReadOnlyProperty<Bounds2>,
    public readonly glassPane: Node,
    public readonly stepEmitter: TinyEmitter<[number]>,
  ) {}
}
