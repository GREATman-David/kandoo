import { useEffect, useRef, useState } from 'react';
import { Keyboard, type View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How far a screen must lift its bottom edge to stay above the on-screen
 * keyboard. Android draws the app edge-to-edge, so `adjustResize` no longer
 * shrinks the window and the keyboard simply covers whatever sits at the
 * bottom — on Home, the very field the user is typing into.
 *
 * Attach `ref` to the screen's root view and add `lift` as bottom padding. The
 * lift is measured, not assumed: it is the overlap between the root view and
 * the keyboard, so it is right whether or not a tab bar sits below the screen,
 * and it is 0 on a device whose window still resizes by itself.
 */
export function useKeyboardLift(opts: { inModal?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  const ref = useRef<View>(null);
  const [lift, setLift] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardOpen(true);
      const keyboardTop = event.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _width, height) => {
        setLift(Math.max(0, Math.round(y + height - keyboardTop)));
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardOpen(false);
      setLift(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // A Modal's window starts below the status bar, so the measurement above
  // comes out short by that much. Erring high only adds a little space above
  // the keyboard; erring low would hide the line being typed.
  const extra = opts.inModal && lift > 0 ? insets.top : 0;
  return { ref, lift: lift + extra, keyboardOpen };
}
