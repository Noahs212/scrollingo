import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";

interface Props {
  current: number;
  total: number;
}

export default function ProgressBar({ current, total }: Props) {
  const widthAnim = useRef(new Animated.Value(0)).current;

  const progress = total > 0 ? current / total : 0;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: progress,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  const widthPercent = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.container}>
      <View style={styles.barBackground}>
        <Animated.View style={[styles.barFill, { width: widthPercent }]} />
      </View>
      <Text style={styles.label}>
        {current} of {total} cards
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
  },
  barBackground: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: "#22c55e",
  },
  label: {
    color: "#888",
    fontSize: 12,
    textAlign: "center",
    marginTop: 6,
  },
});
