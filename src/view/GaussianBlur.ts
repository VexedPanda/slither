import { toSVGNumber } from 'scenerystack/dot';
import { CanvasContextWrapper, Filter, svgns } from 'scenerystack/scenery';

// Adapted from scenery's GaussianBlur filter (MIT, University of Colorado Boulder), which scenerystack does not export
export class GaussianBlur extends Filter {
  public constructor(
    private readonly standardDeviation: number,
    filterRegionPercentage = 15,
  ) {
    super();

    this.filterRegionPercentageIncrease = filterRegionPercentage;
  }

  public getCSSFilterString(): string {
    return `blur(${toSVGNumber(this.standardDeviation)}px)`;
  }

  public applySVGFilter(svgFilter: SVGFilterElement, inName: string, resultName?: string): void {
    const feGaussianBlur = document.createElementNS(svgns, 'feGaussianBlur');
    feGaussianBlur.setAttribute('stdDeviation', toSVGNumber(this.standardDeviation));
    feGaussianBlur.setAttribute('edgeMode', 'none'); // Don't pad things!
    feGaussianBlur.setAttribute('in', inName);
    if (resultName) {
      feGaussianBlur.setAttribute('result', resultName);
    }
    svgFilter.appendChild(feGaussianBlur);
  }

  public override isDOMCompatible(): boolean {
    return true;
  }

  public override isSVGCompatible(): boolean {
    return true;
  }

  public applyCanvasFilter(wrapper: CanvasContextWrapper): void {
    throw new Error('unimplemented');
  }
}
