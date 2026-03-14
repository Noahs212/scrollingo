import React from "react";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReset = jest.fn();
const mockSetOptions = jest.fn();
const mockDispatch = jest.fn();
const mockAddListener = jest.fn(() => jest.fn());

export const useNavigation = jest.fn(() => ({
  navigate: mockNavigate,
  goBack: mockGoBack,
  reset: mockReset,
  setOptions: mockSetOptions,
  dispatch: mockDispatch,
  addListener: mockAddListener,
  canGoBack: jest.fn(() => true),
}));

export const useRoute = jest.fn(() => ({
  params: {},
  key: "mock-route-key",
  name: "MockScreen",
}));

export const useIsFocused = jest.fn(() => true);

export const useFocusEffect = jest.fn((callback: () => void) => {
  callback();
});

export const NavigationContainer: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return <>{children}</>;
};

export const CommonActions = {
  navigate: jest.fn(),
  reset: jest.fn(),
  goBack: jest.fn(),
};

export const StackActions = {
  push: jest.fn(),
  pop: jest.fn(),
  replace: jest.fn(),
};

export const createNavigatorFactory = jest.fn();
