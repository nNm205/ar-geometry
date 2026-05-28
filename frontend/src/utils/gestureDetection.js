import { getDistance } from "./gestures";

export function isPinching(hand) {
  const thumbTip = hand[4];
  const indexTip = hand[8];
  return getDistance(thumbTip, indexTip) < 0.095;
}

export function isOpenPalm(hand) {
  if (isPinching(hand)) return false;
  return (
    hand[8].y  < hand[6].y  &&
    hand[12].y < hand[10].y &&
    hand[16].y < hand[14].y
  );
}
