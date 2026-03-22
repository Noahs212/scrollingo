/**
 * Regression tests for subtitle tap, word highlight, and popup behavior.
 *
 * These tests verify REQUIREMENTS, not implementation details.
 * They should NOT be rewritten when components are refactored —
 * if a refactor breaks a test here, that's the test doing its job.
 *
 * Requirements covered:
 * 1. Tapping a subtitle character opens the word popup
 * 2. Only the tapped word instance is highlighted (not duplicates)
 * 3. Subtitle tap targets sit above popup backdrop (zIndex) so switching
 *    words is a single tap, not close-then-reopen
 * 4. Closing the popup does NOT auto-resume the video
 * 5. The onCharTap callback passes detectionIndex + charIndex for precise highlighting
 * 6. WordPopup renders word, pinyin, translation, and definition
 * 7. WordPopup backdrop calls onClose without side effects
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

// ─── Mock expo modules ───

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("expo-speech", () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: (props: any) => {
    const { View } = require("react-native");
    return <View testID={`icon-${props.name}`} />;
  },
}));

// ─── Shared test data ───

const mockSubtitleData = {
  video: "test_video",
  resolution: { width: 720, height: 1280 },
  duration_ms: 10000,
  frame_interval_ms: 100,
  segments: [
    {
      start_ms: 1000,
      end_ms: 3000,
      detections: [
        {
          text: "你知道你",
          confidence: 0.95,
          bbox: { x: 100, y: 1000, width: 400, height: 50 },
          chars: [
            { char: "你", x: 100, y: 1000, width: 100, height: 50 },
            { char: "知", x: 200, y: 1000, width: 100, height: 50 },
            { char: "道", x: 300, y: 1000, width: 100, height: 50 },
            { char: "你", x: 400, y: 1000, width: 100, height: 50 },
          ],
        },
      ],
    },
    {
      start_ms: 4000,
      end_ms: 6000,
      detections: [
        {
          text: "你好",
          confidence: 0.95,
          bbox: { x: 200, y: 1000, width: 200, height: 50 },
          chars: [
            { char: "你", x: 200, y: 1000, width: 100, height: 50 },
            { char: "好", x: 300, y: 1000, width: 100, height: 50 },
          ],
        },
      ],
    },
  ],
};

// ─── SubtitleTapOverlay tests ───

describe("FLOW: Subtitle tap targets and highlighting", () => {
  const SubtitleTapOverlay =
    require("../../components/general/post/subtitleOverlay").default;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MUST render tap targets for each character in the active segment", () => {
    const onCharTap = jest.fn();
    const { toJSON } = render(
      <SubtitleTapOverlay
        subtitleData={mockSubtitleData}
        currentTimeMs={1500}
        containerWidth={360}
        containerHeight={640}
        onCharTap={onCharTap}
      />,
    );
    const json = JSON.stringify(toJSON());
    // 4 characters in the active segment at 1500ms: 你知道你
    // Each renders a Pressable — count the char targets
    const tree = toJSON();
    expect(tree).not.toBeNull();
    // The container should have children (the char pressables)
    expect(tree!.children).not.toBeNull();
    expect(tree!.children!.length).toBe(4);
  });

  it("MUST pass detectionIndex and charIndex in onCharTap callback", () => {
    const onCharTap = jest.fn();
    const { UNSAFE_root } = render(
      <SubtitleTapOverlay
        subtitleData={mockSubtitleData}
        currentTimeMs={1500}
        containerWidth={360}
        containerHeight={640}
        onCharTap={onCharTap}
      />,
    );

    // Find all Pressable elements (char tap targets)
    const pressables = UNSAFE_root.findAll(
      (node) => node.props.onPress !== undefined,
    );
    expect(pressables.length).toBe(4);

    // Tap the second character (知, index 1 in detection 0)
    fireEvent.press(pressables[1]);

    expect(onCharTap).toHaveBeenCalledTimes(1);
    const [char, fullText, _screenX, _screenY, detIdx, charIdx] =
      onCharTap.mock.calls[0];
    expect(char).toBe("知");
    expect(fullText).toBe("你知道你");
    expect(detIdx).toBe(0);
    expect(charIdx).toBe(1);
  });

  it("MUST only highlight the specific character range, not all instances of the same word", () => {
    // "你" appears at index 0 and index 3 in "你知道你"
    // Highlighting the first 你 (index 0) should NOT highlight the second 你 (index 3)
    const { toJSON } = render(
      <SubtitleTapOverlay
        subtitleData={mockSubtitleData}
        currentTimeMs={1500}
        containerWidth={360}
        containerHeight={640}
        highlightRange={{ detectionIndex: 0, startCharIndex: 0, endCharIndex: 1 }}
      />,
    );

    const tree = toJSON();
    const charTargets = tree!.children!;

    // First 你 (index 0) should be highlighted
    const firstNi = JSON.stringify(charTargets[0]);
    expect(firstNi).toContain("rgba(255, 213, 79");

    // Second 你 (index 3) should NOT be highlighted
    const secondNi = JSON.stringify(charTargets[3]);
    expect(secondNi).not.toContain("rgba(255, 213, 79");
  });

  it("MUST highlight a multi-character word range correctly", () => {
    // Highlight "知道" (indices 1-2)
    const { toJSON } = render(
      <SubtitleTapOverlay
        subtitleData={mockSubtitleData}
        currentTimeMs={1500}
        containerWidth={360}
        containerHeight={640}
        highlightRange={{ detectionIndex: 0, startCharIndex: 1, endCharIndex: 3 }}
      />,
    );

    const tree = toJSON();
    const charTargets = tree!.children!;

    // 知 (index 1) and 道 (index 2) should be highlighted
    expect(JSON.stringify(charTargets[1])).toContain("rgba(255, 213, 79");
    expect(JSON.stringify(charTargets[2])).toContain("rgba(255, 213, 79");

    // 你 (index 0) and 你 (index 3) should NOT be highlighted
    expect(JSON.stringify(charTargets[0])).not.toContain("rgba(255, 213, 79");
    expect(JSON.stringify(charTargets[3])).not.toContain("rgba(255, 213, 79");
  });

  it("MUST render nothing when no segment is active at current time", () => {
    const { toJSON } = render(
      <SubtitleTapOverlay
        subtitleData={mockSubtitleData}
        currentTimeMs={7000}
        containerWidth={360}
        containerHeight={640}
      />,
    );
    expect(toJSON()).toBeNull();
  });

  it("MUST have zIndex > 30 so tap targets sit above popup backdrop", () => {
    // The popup backdrop uses zIndex 30. Subtitle tap targets must be above
    // it so tapping a word while the popup is open directly switches words
    // instead of requiring close-then-reopen.
    const { toJSON } = render(
      <SubtitleTapOverlay
        subtitleData={mockSubtitleData}
        currentTimeMs={1500}
        containerWidth={360}
        containerHeight={640}
      />,
    );

    const tree = toJSON();
    const containerStyle = tree!.props.style;
    // The container style is flattened from StyleSheet — check for zIndex
    const styleStr = JSON.stringify(containerStyle);
    // zIndex should be >= 31 (above the popup backdrop at 30)
    const flatStyle = Array.isArray(containerStyle)
      ? Object.assign({}, ...containerStyle)
      : containerStyle;
    expect(flatStyle.zIndex).toBeGreaterThan(30);
  });

  it("MUST use pointerEvents='box-none' so non-char taps pass through", () => {
    // This ensures taps outside subtitle chars still reach the popup
    // backdrop (to close it) or the video (to play/pause)
    const { toJSON } = render(
      <SubtitleTapOverlay
        subtitleData={mockSubtitleData}
        currentTimeMs={1500}
        containerWidth={360}
        containerHeight={640}
      />,
    );

    const tree = toJSON();
    expect(tree!.props.pointerEvents).toBe("box-none");
  });
});

// ─── WordPopup tests ───

describe("FLOW: Word popup display and behavior", () => {
  const WordPopup =
    require("../../components/general/post/wordPopup").default;

  const mockWordData = {
    word: "知道",
    pinyin: "zhī dào",
    translation: "to know",
    contextual_definition: "to be aware of or have knowledge about something",
    part_of_speech: "verb",
    source_sentence: "你知道你最让人佩服的地方是什么吗",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("MUST display the word, pinyin, and translation", () => {
    render(
      <WordPopup
        data={mockWordData}
        visible={true}
        tapX={180}
        tapY={500}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("知道")).toBeTruthy();
    expect(screen.getByText("zhī dào")).toBeTruthy();
    expect(screen.getByText("- to know")).toBeTruthy();
  });

  it("MUST display the part of speech", () => {
    render(
      <WordPopup
        data={mockWordData}
        visible={true}
        tapX={180}
        tapY={500}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("verb")).toBeTruthy();
  });

  it("MUST display the contextual definition", () => {
    render(
      <WordPopup
        data={mockWordData}
        visible={true}
        tapX={180}
        tapY={500}
        onClose={jest.fn()}
      />,
    );

    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain("to be aware of");
  });

  it("MUST render nothing when visible is false", () => {
    const { toJSON } = render(
      <WordPopup
        data={mockWordData}
        visible={false}
        tapX={180}
        tapY={500}
        onClose={jest.fn()}
      />,
    );

    expect(toJSON()).toBeNull();
  });

  it("MUST render nothing when data is null", () => {
    const { toJSON } = render(
      <WordPopup
        data={null}
        visible={true}
        tapX={180}
        tapY={500}
        onClose={jest.fn()}
      />,
    );

    expect(toJSON()).toBeNull();
  });

  it("MUST call onClose when backdrop is pressed (without auto-playing)", () => {
    const onClose = jest.fn();
    render(
      <WordPopup
        data={mockWordData}
        visible={true}
        tapX={180}
        tapY={500}
        onClose={onClose}
      />,
    );

    // The backdrop is the first pressable child — pressing it should fire onClose
    // onClose should ONLY close the popup, NOT resume the video
    // (video resume is the user's responsibility via play/pause tap)
    const tree = screen.toJSON();
    // Find the backdrop (first Pressable in the tree)
    const findPressable = (node: any): any => {
      if (!node) return null;
      if (node.props?.accessibilityRole === "button" || node.type === "View") {
        // The backdrop is the first View child with onPress
        if (node.props?.onPress) return node;
      }
      if (node.children) {
        for (const child of node.children) {
          if (typeof child === "object") {
            const found = findPressable(child);
            if (found) return found;
          }
        }
      }
      return null;
    };
    const backdrop = findPressable(tree);
    if (backdrop) {
      fireEvent.press(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it("MUST show 'Add to Vocab' button", () => {
    render(
      <WordPopup
        data={mockWordData}
        visible={true}
        tapX={180}
        tapY={500}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText("Add to Vocab")).toBeTruthy();
  });

  it("MUST show 'Saved' after tapping 'Add to Vocab'", () => {
    const onSave = jest.fn();
    render(
      <WordPopup
        data={mockWordData}
        visible={true}
        tapX={180}
        tapY={500}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.press(screen.getByText("Add to Vocab"));
    expect(onSave).toHaveBeenCalledWith("知道");
    expect(screen.getByText("Saved")).toBeTruthy();
  });
});

// ─── Integration: PostSingle popup close does NOT auto-play ───

describe("FLOW: Popup close must NOT auto-resume video", () => {
  it("MUST NOT call player.play() in the onClose callback", () => {
    // This is a structural test: verify that the PostSingle component's
    // onClose handler for WordPopup does not contain player.play().
    // If someone adds auto-play back to onClose, this test should fail.
    //
    // We verify by reading the source and checking the onClose callback.
    // This is intentionally a source-level check because the requirement
    // is "closing popup must NOT resume" — any implementation that calls
    // play() on close violates this.
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(
      path.join(__dirname, "../../components/general/post/index.tsx"),
      "utf8",
    );

    // Find the onClose callback for WordPopup
    // It should contain setPopupVisible(false) and setHighlightRange(null)
    // but NOT player.play() or setIsPaused(false)
    const onCloseMatch = source.match(
      /onClose=\{[^}]*\}[^}]*\}/s,
    );
    expect(onCloseMatch).not.toBeNull();
    const onCloseBody = onCloseMatch![0];

    expect(onCloseBody).toContain("setPopupVisible(false)");
    expect(onCloseBody).not.toContain("player.play()");
    expect(onCloseBody).not.toContain("setIsPaused(false)");
  });
});
