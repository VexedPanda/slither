import { currentTheme } from './Theme.ts';

import { Property } from 'scenerystack/axon';
import { EmptySelfOptions, optionize } from 'scenerystack/phet-core';
import { AquaRadioButtonGroup, AquaRadioButtonGroupItem, AquaRadioButtonGroupOptions } from 'scenerystack/sun';

export type UIAquaRadioButtonGroupOptions = AquaRadioButtonGroupOptions;

export class UIAquaRadioButtonGroup<T> extends AquaRadioButtonGroup<T> {
  public constructor(
    property: Property<T>,
    items: AquaRadioButtonGroupItem<T>[],
    providedOptions?: AquaRadioButtonGroupOptions,
  ) {
    const options = optionize<AquaRadioButtonGroupOptions, EmptySelfOptions>()(
      {
        spacing: 8,
        radioButtonOptions: {
          selectedColor: currentTheme.uiButtonBaseColorProperty,
          deselectedColor: currentTheme.uiBackgroundColorProperty,
          stroke: currentTheme.uiForegroundColorProperty,
        },
      },
      providedOptions,
    );

    super(property, items, options);
  }
}
