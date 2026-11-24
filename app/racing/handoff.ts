// Keep a replacement wheel out of the input mix until it has settled at neutral.
export function createControllerHandoff() {
  let previous: string | undefined;
  let needsNeutral = false;
  let keyboardTookOver = false;
  let neutralSamples = 0;

  return (device: string | undefined, neutral: boolean, keyboardActive: boolean) => {
    if (previous && device !== previous) {
      needsNeutral = true;
      keyboardTookOver = false;
      neutralSamples = 0;
    }
    previous = device;
    if (!needsNeutral) return "controller";
    neutralSamples = device && neutral ? neutralSamples + 1 : 0;
    if (neutralSamples >= 2) {
      needsNeutral = false;
      return "controller";
    }
    if (keyboardActive) keyboardTookOver = true;
    return keyboardTookOver ? "keyboard" : "park";
  };
}
