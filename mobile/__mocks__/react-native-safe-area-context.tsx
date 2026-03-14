import React from "react";
import { View, ViewProps } from "react-native";

const defaultInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const useSafeAreaInsets = jest.fn(() => defaultInsets);

export const useSafeAreaFrame = jest.fn(() => ({
  x: 0,
  y: 0,
  width: 375,
  height: 812,
}));

export const SafeAreaView: React.FC<ViewProps & { children?: React.ReactNode }> = ({
  children,
  ...props
}) => {
  return (
    <View testID="safe-area-view" {...props}>
      {children}
    </View>
  );
};

export const SafeAreaProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return <>{children}</>;
};

export const SafeAreaInsetsContext = {
  Consumer: ({ children }: { children: (insets: typeof defaultInsets) => React.ReactNode }) =>
    children(defaultInsets),
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
};

export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: defaultInsets,
};
