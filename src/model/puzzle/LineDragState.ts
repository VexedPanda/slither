import { Enumeration, EnumerationValue } from 'scenerystack/phet-core';

export default class LineDragState extends EnumerationValue {
  public static readonly NONE = new LineDragState();
  public static readonly LINE_DRAG = new LineDragState();
  public static readonly EDGE_PAINT = new LineDragState();

  public static readonly enumeration = new Enumeration(LineDragState);
}
