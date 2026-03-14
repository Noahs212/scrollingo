import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import ReviewScreen from "../index";

describe("ReviewScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the header with title and card count", () => {
    render(<ReviewScreen />);

    expect(screen.getByText("Vocab Review")).toBeTruthy();
    expect(screen.getByText("1 / 5")).toBeTruthy();
  });

  it("shows the first flashcard word initially", () => {
    render(<ReviewScreen />);

    // First card: "Hola" in Spanish
    expect(screen.getByText("Hola")).toBeTruthy();
    expect(screen.getByText("Spanish")).toBeTruthy();
    expect(screen.getByText("Tap to reveal")).toBeTruthy();
  });

  it("flips the card to show translation when tapped", () => {
    render(<ReviewScreen />);

    // Initially shows the word
    expect(screen.getByText("Hola")).toBeTruthy();
    expect(screen.getByText("Tap to reveal")).toBeTruthy();

    // Tap the card to flip it
    fireEvent.press(screen.getByText("Hola"));

    // After flipping, should show translation
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("Translation")).toBeTruthy();
  });

  it("flips back to the word when tapped again", () => {
    render(<ReviewScreen />);

    // Flip to translation
    fireEvent.press(screen.getByText("Hola"));
    expect(screen.getByText("Hello")).toBeTruthy();

    // Flip back to word
    fireEvent.press(screen.getByText("Hello"));
    expect(screen.getByText("Hola")).toBeTruthy();
    expect(screen.getByText("Tap to reveal")).toBeTruthy();
  });

  it("navigates to the next card when 'Got it' is pressed", () => {
    render(<ReviewScreen />);

    // Initially on first card
    expect(screen.getByText("Hola")).toBeTruthy();
    expect(screen.getByText("1 / 5")).toBeTruthy();

    // Press "Got it" button
    fireEvent.press(screen.getByText("Got it"));

    // Should move to second card: "Bonjour"
    expect(screen.getByText("Bonjour")).toBeTruthy();
    expect(screen.getByText("French")).toBeTruthy();
    expect(screen.getByText("2 / 5")).toBeTruthy();
  });

  it("navigates to the next card when 'Still learning' is pressed", () => {
    render(<ReviewScreen />);

    // Initially on first card
    expect(screen.getByText("Hola")).toBeTruthy();

    // Press "Still learning" button
    fireEvent.press(screen.getByText("Still learning"));

    // Should move to second card
    expect(screen.getByText("Bonjour")).toBeTruthy();
    expect(screen.getByText("2 / 5")).toBeTruthy();
  });

  it("resets flip state when navigating to the next card", () => {
    render(<ReviewScreen />);

    // Flip the first card
    fireEvent.press(screen.getByText("Hola"));
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("Translation")).toBeTruthy();

    // Navigate to next card
    fireEvent.press(screen.getByText("Got it"));

    // The next card should show the word side, not flipped
    expect(screen.getByText("Bonjour")).toBeTruthy();
    expect(screen.getByText("Tap to reveal")).toBeTruthy();
  });

  it("wraps around to the first card after the last card", () => {
    render(<ReviewScreen />);

    // Navigate through all 5 cards
    fireEvent.press(screen.getByText("Got it")); // -> card 2
    fireEvent.press(screen.getByText("Got it")); // -> card 3
    fireEvent.press(screen.getByText("Got it")); // -> card 4
    fireEvent.press(screen.getByText("Got it")); // -> card 5

    expect(screen.getByText("5 / 5")).toBeTruthy();
    expect(screen.getByText("Annyeong")).toBeTruthy();

    // One more should wrap to first card
    fireEvent.press(screen.getByText("Got it")); // -> card 1

    expect(screen.getByText("1 / 5")).toBeTruthy();
    expect(screen.getByText("Hola")).toBeTruthy();
  });

  it("navigates to the previous card (wrapping from first to last)", () => {
    render(<ReviewScreen />);

    // On the first card, press the back button (chevron-back icon)
    // The back button renders an Ionicons "chevron-back" which our mock renders as text
    fireEvent.press(screen.getByText("chevron-back"));

    // Should wrap to the last card (index 4 = card 5/5)
    expect(screen.getByText("5 / 5")).toBeTruthy();
    expect(screen.getByText("Annyeong")).toBeTruthy();
  });

  it("shows the placeholder text about upcoming features", () => {
    render(<ReviewScreen />);

    expect(
      screen.getByText("Spaced repetition and saved vocab coming soon"),
    ).toBeTruthy();
  });
});
