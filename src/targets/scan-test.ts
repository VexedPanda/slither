import '../main.css';

import { enableAssert } from 'scenerystack/assert';
import { NumberProperty, PatternStringProperty, Property, StringProperty } from 'scenerystack/axon';
import { Bounds2 } from 'scenerystack/dot';
import { platform } from 'scenerystack/phet-core';
import { AlignBox, AnimatedPanZoomListener, Display, Font, Node, Text, VBox } from 'scenerystack/scenery';
import { TextPushButton } from 'scenerystack/sun';

import scanURL from '../scan/scanURL.ts';

// import scanFaceValues from './scan/scanFaceValues';

const opencvURL = localStorage.getItem('opencv-url');
if (opencvURL) {
  scanURL(opencvURL);

  // ( async () => {
  //   const text = await scanFaceValues( opencvURL );
  //   console.log( 'tesseract text:', text );
  // } )();
}

enableAssert();

const scene = new Node();

const rootNode = new Node({
  renderer: 'svg',
  children: [scene],
});

const buttonPressPatternString = new StringProperty('Button presses: {{count}}');

const font = new Font({
  family: 'sans-serif',
  size: 25,
});

const display = new Display(rootNode, {
  allowWebGL: true,
  allowBackingScaleAntialiasing: true,
  allowSceneOverflow: false,
  accessibility: true,
  backgroundColor: '#eee',

  // assumeFullWindow: true,
  // listenToOnlyElement: false

  assumeFullWindow: false,
  listenToOnlyElement: true,
});
// document.body.appendChild( display.domElement );

const zoomListener = new AnimatedPanZoomListener(scene);
display.addInputListener(zoomListener);

const layoutBoundsProperty = new Property(new Bounds2(0, 0, window.innerWidth, window.innerHeight));

const countProperty = new NumberProperty(0);

const mainBox = new VBox({
  spacing: 10,
  children: [
    new TextPushButton('Test', {
      font: font,
      listener: () => {
        countProperty.value++;
      },
    }),
    new Text(new PatternStringProperty(buttonPressPatternString, { count: countProperty }), {
      font: font,
    }),
  ],
});

scene.addChild(
  new AlignBox(mainBox, {
    alignBoundsProperty: layoutBoundsProperty,
    xAlign: 'center',
    yAlign: 'top',
    margin: 20,
  }),
);

display.initializeEvents();

let resizePending = true;
const resize = () => {
  resizePending = false;

  const layoutBounds = new Bounds2(0, 0, window.innerWidth, window.innerHeight);
  display.setWidthHeight(layoutBounds.width, layoutBounds.height);
  layoutBoundsProperty.value = layoutBounds;

  if (platform.mobileSafari) {
    window.scrollTo(0, 0);
  }

  // zoomListener.setTargetScale( scale );
  zoomListener.setTargetBounds(layoutBounds);
  zoomListener.setPanBounds(layoutBounds);
};

const resizeListener = () => {
  resizePending = true;
};
window.addEventListener('resize', resizeListener);
window.addEventListener('orientationchange', resizeListener);
window.visualViewport && window.visualViewport.addEventListener('resize', resizeListener);
resize();

display.updateOnRequestAnimationFrame((dt) => {
  if (resizePending) {
    resize();
  }

  zoomListener.step(dt);
});
