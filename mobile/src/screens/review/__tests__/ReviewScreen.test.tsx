import React from "react";
import { render, screen } from "@testing-library/react-native";
import ReviewScreen from "../index";

describe("ReviewScreen", () => {
  it("renders the empty state with correct title", () => {
    render(<ReviewScreen />);

    expect(screen.getByText("No saved words yet")).toBeTruthy();
  });

  it("renders the subtitle with instructions", () => {
    render(<ReviewScreen />);

    expect(
      screen.getByText("Tap words in video subtitles to save them for review"),
    ).toBeTruthy();
  });

  it("renders the spaced repetition note", () => {
    render(<ReviewScreen />);

    expect(
      screen.getByText("Spaced repetition coming in a future update"),
    ).toBeTruthy();
  });

  it("renders the book icon", () => {
    render(<ReviewScreen />);

    expect(screen.getByText("book-outline")).toBeTruthy();
  });
});
