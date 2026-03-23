import { useCallback, useState } from "react";
import ReviewHub from "./ReviewHub";
import CardViewer from "./CardViewer";
import SessionComplete from "./SessionComplete";

type Screen =
  | { type: "hub" }
  | { type: "session" }
  | { type: "complete"; reviewedCount: number; correctCount: number; bestStreak: number };

export default function ReviewScreen() {
  const [screen, setScreen] = useState<Screen>({ type: "hub" });

  const handleStartReview = useCallback(() => {
    setScreen({ type: "session" });
  }, []);

  const handleSessionComplete = useCallback(
    (result: { reviewedCount: number; correctCount: number; bestStreak: number }) => {
      setScreen({
        type: "complete",
        ...result,
      });
    },
    [],
  );

  const handleDone = useCallback(() => {
    setScreen({ type: "hub" });
  }, []);

  switch (screen.type) {
    case "hub":
      return <ReviewHub onStartReview={handleStartReview} />;
    case "session":
      return <CardViewer onComplete={handleSessionComplete} />;
    case "complete":
      return (
        <SessionComplete
          reviewedCount={screen.reviewedCount}
          correctCount={screen.correctCount}
          bestStreak={screen.bestStreak}
          onDone={handleDone}
        />
      );
  }
}
