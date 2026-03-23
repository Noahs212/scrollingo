import { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

interface Props {
  reviewedCount: number;
  correctCount: number;
  bestStreak: number;
  onDone: () => void;
}

function getPerformanceMessage(accuracy: number): string {
  if (accuracy >= 90) return "Outstanding!";
  if (accuracy >= 70) return "Great job!";
  if (accuracy >= 50) return "Good effort!";
  return "Keep practicing!";
}

export default function SessionComplete({
  reviewedCount,
  correctCount,
  bestStreak,
  onDone,
}: Props) {
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const accuracy = reviewedCount > 0 ? Math.round((correctCount / reviewedCount) * 100) : 0;

  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Trophy bounce in
    Animated.spring(bounceAnim, {
      toValue: 1,
      friction: 4,
      tension: 60,
      useNativeDriver: true,
    }).start();

    // Content fade in after trophy
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }, 400);

    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trophyScale = bounceAnim.interpolate({
    inputRange: [0, 0.5, 0.8, 1],
    outputRange: [0, 1.2, 0.95, 1],
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Trophy */}
        <Animated.View
          style={[
            styles.trophyCircle,
            { transform: [{ scale: trophyScale }] },
          ]}
        >
          <Text style={styles.trophyEmoji}>🏆</Text>
        </Animated.View>

        {/* Title */}
        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={styles.title}>Session Complete</Text>
          <Text style={styles.message}>{getPerformanceMessage(accuracy)}</Text>
        </Animated.View>

        {/* Stats grid */}
        <Animated.View style={[styles.statsGrid, { opacity: fadeAnim }]}>
          <View style={styles.statsRow}>
            <View style={[styles.statTile, styles.statTileRight]}>
              <Ionicons name="albums-outline" size={24} color="#3b82f6" />
              <Text style={styles.statValue}>{reviewedCount}</Text>
              <Text style={styles.statLabel}>Reviewed</Text>
            </View>
            <View style={styles.statTile}>
              <Ionicons name="checkmark-circle-outline" size={24} color="#22c55e" />
              <Text style={styles.statValue}>{accuracy}%</Text>
              <Text style={styles.statLabel}>Accuracy</Text>
            </View>
          </View>
          <View style={styles.statsDividerH} />
          <View style={styles.statsRow}>
            <View style={[styles.statTile, styles.statTileRight]}>
              <Ionicons name="flame-outline" size={24} color="#f97316" />
              <Text style={styles.statValue}>{bestStreak}</Text>
              <Text style={styles.statLabel}>Best Streak</Text>
            </View>
            <View style={styles.statTile}>
              <Ionicons name="time-outline" size={24} color="#60a5fa" />
              <Text style={styles.statValue}>
                {reviewedCount - correctCount}
              </Text>
              <Text style={styles.statLabel}>To Relearn</Text>
            </View>
          </View>
        </Animated.View>

        {/* Done button */}
        <Animated.View style={[styles.buttonContainer, { opacity: fadeAnim }]}>
          <TouchableOpacity
            style={styles.doneButton}
            activeOpacity={0.8}
            onPress={onDone}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  // Trophy
  trophyCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(234, 179, 8, 0.15)",
    borderWidth: 2,
    borderColor: "rgba(234, 179, 8, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#eab308",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  trophyEmoji: {
    fontSize: 48,
  },
  // Title
  title: {
    color: "white",
    fontSize: 26,
    fontWeight: "bold",
    marginTop: 24,
    textAlign: "center",
  },
  message: {
    color: "#22c55e",
    fontSize: 16,
    fontWeight: "500",
    marginTop: 6,
    textAlign: "center",
  },
  // Stats grid
  statsGrid: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginTop: 32,
    overflow: "hidden",
  },
  statsRow: {
    flexDirection: "row",
  },
  statTile: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 20,
    gap: 6,
  },
  statTileRight: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255,255,255,0.1)",
  },
  statsDividerH: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  statValue: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
  },
  statLabel: {
    color: "#888",
    fontSize: 12,
  },
  // Buttons
  buttonContainer: {
    width: "100%",
    marginTop: 32,
  },
  doneButton: {
    backgroundColor: "#22c55e",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  doneButtonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
  },
});
