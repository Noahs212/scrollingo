import React from "react";
import { View } from "react-native";

const mockPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  loop: false,
  currentTime: 0,
  duration: 0,
  muted: false,
  volume: 1,
  status: "idle" as const,
  replace: jest.fn(),
  seekBy: jest.fn(),
  replay: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const useVideoPlayer = jest.fn(
  (_source: string | null, _setup?: (player: typeof mockPlayer) => void) => {
    if (_setup) {
      _setup(mockPlayer);
    }
    return mockPlayer;
  },
);

export const VideoView = React.forwardRef<View, Record<string, unknown>>(
  (props, ref) => {
    return <View ref={ref} testID="video-view" {...props} />;
  },
);

VideoView.displayName = "VideoView";
