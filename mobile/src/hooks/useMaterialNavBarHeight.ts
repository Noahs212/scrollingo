// INHERITED: This file is from the kirkwat/tiktok base repo.
// It will likely undergo significant changes as Scrollingo features are built.
// Do not assume this code follows Scrollingo patterns — verify before modifying.

import { useSafeAreaInsets } from "react-native-safe-area-context";

const MATERIAL_BOTTOM_TAB_BAR_HEIGHT = 80;

const useMaterialNavBarHeight = (withoutBottomTabs: boolean) => {
  const { bottom } = useSafeAreaInsets();

  if (withoutBottomTabs) {
    return bottom;
  }
  // Tab bar covers bottom safe area, so just subtract tab bar height
  return MATERIAL_BOTTOM_TAB_BAR_HEIGHT;
};

export default useMaterialNavBarHeight;
