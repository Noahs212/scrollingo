import React from "react";
import { View, ViewProps } from "react-native";

const BottomSheet = React.forwardRef<
  View,
  ViewProps & { children?: React.ReactNode }
>(({ children, ...props }, ref) => {
  return (
    <View ref={ref} testID="bottom-sheet" {...props}>
      {children}
    </View>
  );
});

BottomSheet.displayName = "BottomSheet";

export const BottomSheetModal = React.forwardRef<
  View,
  ViewProps & { children?: React.ReactNode }
>(({ children, ...props }, ref) => {
  return (
    <View ref={ref} testID="bottom-sheet-modal" {...props}>
      {children}
    </View>
  );
});

BottomSheetModal.displayName = "BottomSheetModal";

export const BottomSheetModalProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return <>{children}</>;
};

export const BottomSheetScrollView: React.FC<
  ViewProps & { children?: React.ReactNode }
> = ({ children, ...props }) => {
  return (
    <View testID="bottom-sheet-scroll-view" {...props}>
      {children}
    </View>
  );
};

export const BottomSheetFlatList: React.FC<
  ViewProps & { data?: unknown[]; renderItem?: unknown }
> = (props) => {
  return <View testID="bottom-sheet-flat-list" {...props} />;
};

export const BottomSheetTextInput: React.FC<ViewProps> = (props) => {
  return <View testID="bottom-sheet-text-input" {...props} />;
};

export const BottomSheetBackdrop: React.FC<ViewProps> = (props) => {
  return <View testID="bottom-sheet-backdrop" {...props} />;
};

export const useBottomSheetModal = jest.fn(() => ({
  dismiss: jest.fn(),
  dismissAll: jest.fn(),
}));

export const useBottomSheet = jest.fn(() => ({
  expand: jest.fn(),
  collapse: jest.fn(),
  close: jest.fn(),
  snapToIndex: jest.fn(),
  snapToPosition: jest.fn(),
  forceClose: jest.fn(),
}));

export default BottomSheet;
