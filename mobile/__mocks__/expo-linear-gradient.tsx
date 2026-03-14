import React from "react";
import { View, ViewProps } from "react-native";

interface LinearGradientProps extends ViewProps {
  colors?: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  locations?: number[];
}

export const LinearGradient: React.FC<LinearGradientProps> = ({
  children,
  ...props
}) => {
  return (
    <View testID="linear-gradient" {...props}>
      {children}
    </View>
  );
};
