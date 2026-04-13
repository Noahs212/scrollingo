/**
 * Tests for SubtitleDrawer auto-scroll fix.
 *
 * The drawer has a header ("Transcript") above the ScrollView.
 * When the active segment changes, the drawer must scroll so the active item
 * is centered in the *visible* scroll area (below the header), not behind it.
 *
 * Scroll formula (SubtitleDrawer.tsx):
 *   scrollY = max(0, itemMidY - viewportHeight/2 - headerH)
 *   where:
 *     itemMidY       = layout.y + layout.height / 2
 *     viewportHeight = EXPANDED_HEIGHT - headerH
 */

import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";

// ─── scrollTo spy ─────────────────────────────────────────────────────────────
//
// `var` is hoisted (declaration only) before jest.mock factories run.
// The factory function captures `mockScrollTo` by reference; by the time
// any component renders (useImperativeHandle callback), the assignment
// `= jest.fn()` has already executed. Names starting with "mock" bypass
// Jest's factory-scope guard.
//
// eslint-disable-next-line no-var
var mockScrollTo = jest.fn();

// Mock the internal ScrollView path that react-native re-exports via
//   require('./Libraries/Components/ScrollView/ScrollView').default
// Renders children through a Fragment (no react-native View needed in the factory).
jest.mock(
  "react-native/Libraries/Components/ScrollView/ScrollView",
  () => {
    const React = require("react");
    const MockSV = React.forwardRef(({ children }: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }), []);
      return React.createElement(React.Fragment, null, children);
    });
    MockSV.displayName = "ScrollView";
    return { __esModule: true, default: MockSV };
  },
);

// ─── Other mocks ──────────────────────────────────────────────────────────────

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import SubtitleDrawer, { EXPANDED_HEIGHT } from "../SubtitleDrawer";
import { SubtitleData } from "../subtitleOverlay";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEADER_HEIGHT = 60;
const ITEM_HEIGHT = 50;

function makeSeg(startMs: number, endMs: number, text: string) {
  return {
    start_ms: startMs,
    end_ms: endMs,
    detections: [
      {
        text,
        confidence: 0.95,
        bbox: { x: 0, y: 0, width: 100, height: 30 },
        chars: [],
      },
    ],
  };
}

/** Build SubtitleData with N segments spaced 2000ms apart. */
function makeSubtitleData(texts: string[]): SubtitleData {
  return {
    video: "test-video-id",
    resolution: { width: 720, height: 1280 },
    duration_ms: texts.length * 2000,
    segments: texts.map((t, i) => makeSeg(i * 2000, i * 2000 + 1500, t)),
  };
}

const DEFAULT_PROPS = {
  onWordTap: jest.fn(),
  onSeek: jest.fn(),
};

function fireHeaderLayout(
  getByTestId: ReturnType<typeof render>["getByTestId"],
  height = HEADER_HEIGHT,
) {
  fireEvent(getByTestId("drawer-header"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 375, height } },
  });
}

function fireItemLayout(
  getByTestId: ReturnType<typeof render>["getByTestId"],
  index: number,
  y = index * ITEM_HEIGHT,
  height = ITEM_HEIGHT,
) {
  fireEvent(getByTestId(`transcript-item-${index}`), "layout", {
    nativeEvent: { layout: { x: 0, y, width: 375, height } },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SubtitleDrawer — auto-scroll", () => {
  beforeEach(() => {
    mockScrollTo.mockClear();
    jest.clearAllMocks();
    // Re-assign so mockClear didn't wipe the function reference
    mockScrollTo = jest.fn();
  });

  // ── 1. scrollTo fires on active segment change ─────────────────────────────

  it("calls scrollTo when the active segment changes in expanded mode", () => {
    const data = makeSubtitleData(["你好", "世界", "今天", "天气", "真好"]);

    const { getByTestId, rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });

    fireHeaderLayout(getByTestId);
    for (let i = 0; i < 5; i++) fireItemLayout(getByTestId, i);

    // Advance to segment 2 (starts at 4000ms)
    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={4100} />,
      );
    });

    expect(mockScrollTo).toHaveBeenCalled();
    expect(mockScrollTo.mock.calls[0][0]).toMatchObject({ animated: true });
  });

  it("does not call scrollTo when the drawer is collapsed", () => {
    const data = makeSubtitleData(["一", "二", "三"]);

    const { rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={2100} />,
      );
    });

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("does not call scrollTo when the active segment index stays the same", () => {
    const data = makeSubtitleData(["一", "二", "三"]);

    const { getByTestId, rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId);
    for (let i = 0; i < 3; i++) fireItemLayout(getByTestId, i);

    const callsAfterOpen = mockScrollTo.mock.calls.length;

    // Still within segment 0 (0–1500ms)
    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={800} />,
      );
    });

    expect(mockScrollTo.mock.calls.length).toBe(callsAfterOpen);
  });

  // ── 2. Scroll position accounts for header height ─────────────────────────

  it("centers the active item in the visible area below the header", () => {
    const data = makeSubtitleData(["零", "一", "二", "三", "四", "五", "六", "七"]);

    const { getByTestId, rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId, HEADER_HEIGHT);
    for (let i = 0; i < 8; i++) fireItemLayout(getByTestId, i);

    // Segment 5: y=250, height=50 → midY=275
    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={10100} />,
      );
    });

    expect(mockScrollTo).toHaveBeenCalled();
    const { y } = mockScrollTo.mock.calls[0][0];

    // scrollY = itemMidY - viewportHeight/2 - headerH
    const viewportH = EXPANDED_HEIGHT - HEADER_HEIGHT;
    const itemMidY = 5 * ITEM_HEIGHT + ITEM_HEIGHT / 2; // 275
    const expected = Math.max(0, itemMidY - viewportH / 2 - HEADER_HEIGHT);
    expect(y).toBeCloseTo(expected, 0);
  });

  it("uses measured (non-uniform) item heights in the scroll calculation", () => {
    const data = makeSubtitleData(["甲", "乙", "丙", "丁", "戊"]);

    const { getByTestId, rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId, HEADER_HEIGHT);

    // Deliberately non-uniform item heights
    const layouts = [
      { y: 0,   height: 40 },
      { y: 40,  height: 60 },
      { y: 100, height: 45 },
      { y: 145, height: 55 },
      { y: 200, height: 80 },
    ];
    layouts.forEach((l, i) => {
      fireEvent(getByTestId(`transcript-item-${i}`), "layout", {
        nativeEvent: { layout: { x: 0, y: l.y, width: 375, height: l.height } },
      });
    });

    // Segment 3: y=145, height=55 → midY=172.5
    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={6100} />,
      );
    });

    expect(mockScrollTo).toHaveBeenCalled();
    const { y } = mockScrollTo.mock.calls[0][0];
    const viewportH = EXPANDED_HEIGHT - HEADER_HEIGHT;
    const itemMidY = 145 + 55 / 2;
    const expected = Math.max(0, itemMidY - viewportH / 2 - HEADER_HEIGHT);
    expect(y).toBeCloseTo(expected, 0);
  });

  // ── 3. Scroll target is always >= 0 ───────────────────────────────────────

  it("scroll target is >= 0 for the first item", () => {
    const data = makeSubtitleData(["第一条", "第二条", "第三条"]);

    const { getByTestId, rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId);
    for (let i = 0; i < 3; i++) fireItemLayout(getByTestId, i);

    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={500} />,
      );
    });

    if (mockScrollTo.mock.calls.length > 0) {
      expect(mockScrollTo.mock.calls[0][0].y).toBeGreaterThanOrEqual(0);
    }
  });

  it("scroll target is >= 0 for the last item", () => {
    const texts = Array.from({ length: 10 }, (_, i) => `段${i}`);
    const data = makeSubtitleData(texts);

    const { getByTestId, rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId);
    for (let i = 0; i < 10; i++) fireItemLayout(getByTestId, i);

    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={18100} />,
      );
    });

    expect(mockScrollTo).toHaveBeenCalled();
    const lastY = mockScrollTo.mock.calls[mockScrollTo.mock.calls.length - 1][0].y;
    expect(lastY).toBeGreaterThanOrEqual(0);
  });

  // ── 4. Reset on drawer open forces immediate scroll ───────────────────────

  it("scrolls to the already-active item when the drawer is first opened", () => {
    const data = makeSubtitleData(["段一", "段二", "段三", "段四"]);

    // Segment 2 is active before opening
    const { getByTestId } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={4100} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId);
    for (let i = 0; i < 4; i++) fireItemLayout(getByTestId, i);

    expect(mockScrollTo).toHaveBeenCalled();
  });

  it("scrolls again to the same segment when drawer is closed and reopened", () => {
    const data = makeSubtitleData(["A", "B", "C", "D"]);

    const { getByTestId } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={2100} />,
    );

    // Open
    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId);
    for (let i = 0; i < 4; i++) fireItemLayout(getByTestId, i);
    const firstOpenCalls = mockScrollTo.mock.calls.length;
    expect(firstOpenCalls).toBeGreaterThanOrEqual(1);

    // Close via dismiss button
    act(() => {
      fireEvent.press(getByTestId("drawer-dismiss"));
    });

    // Reopen — activeIndexRef reset to -1, so scroll fires again for same segment
    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    fireHeaderLayout(getByTestId);
    for (let i = 0; i < 4; i++) fireItemLayout(getByTestId, i);

    expect(mockScrollTo.mock.calls.length).toBeGreaterThan(firstOpenCalls);
  });

  // ── 5. Item layout measurement ────────────────────────────────────────────

  it("does not scroll when item layout has not been measured yet", () => {
    const data = makeSubtitleData(["一", "二", "三"]);

    const { getByTestId, rerender } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });
    // Header measured but items not yet measured
    fireHeaderLayout(getByTestId);

    act(() => {
      rerender(
        <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={2100} />,
      );
    });

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("renders transcript items with testIDs so onLayout can be fired", () => {
    const data = makeSubtitleData(["甲", "乙", "丙"]);

    const { getByTestId } = render(
      <SubtitleDrawer {...DEFAULT_PROPS} subtitleData={data} currentTimeMs={0} />,
    );

    act(() => {
      fireEvent.press(getByTestId("drawer-collapsed"));
    });

    expect(getByTestId("transcript-item-0")).toBeTruthy();
    expect(getByTestId("transcript-item-1")).toBeTruthy();
    expect(getByTestId("transcript-item-2")).toBeTruthy();
  });
});
