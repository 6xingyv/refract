export const normalizeInternalAngle = (angle: number): number => {
  if (!Number.isFinite(angle)) return 0;
  return ((angle % 360) + 360) % 360;
};

export const normalizeAppleAngle = (angle: number): number => {
  if (!Number.isFinite(angle)) return 0;
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 && angle > 0 ? 180 : normalized;
};

export const internalSourceAngleToApple = (angle: number): number =>
  normalizeAppleAngle(angle - 90);

export const appleSourceAngleToInternal = (angle: number): number =>
  normalizeInternalAngle(angle + 90);

export const internalGradientAngleToApple = (angle: number): number =>
  normalizeAppleAngle(angle - 90);

export const appleGradientAngleToInternal = (angle: number): number =>
  normalizeInternalAngle(angle + 90);
