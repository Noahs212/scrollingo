import { TouchableOpacity, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Rating } from "ts-fsrs";

interface Props {
  onRate: (rating: Rating) => void;
  disabled?: boolean;
}

const BUTTONS = [
  {
    rating: Rating.Again,
    label: "Forgot",
    icon: "close-outline" as const,
    color: "#ef4444",
    haptic: Haptics.ImpactFeedbackStyle.Light,
  },
  {
    rating: Rating.Hard,
    label: "Tough",
    icon: "sad-outline" as const,
    color: "#f97316",
    haptic: Haptics.ImpactFeedbackStyle.Light,
  },
  {
    rating: Rating.Good,
    label: "Got it",
    icon: "checkmark-outline" as const,
    color: "#22c55e",
    haptic: Haptics.ImpactFeedbackStyle.Medium,
  },
  {
    rating: Rating.Easy,
    label: "Easy!",
    icon: "flash-outline" as const,
    color: "#3b82f6",
    haptic: Haptics.ImpactFeedbackStyle.Heavy,
  },
] as const;

export default function RatingButtons({ onRate, disabled }: Props) {
  return (
    <View style={styles.container}>
      {BUTTONS.map((btn) => (
        <TouchableOpacity
          key={btn.rating}
          style={[
            styles.button,
            {
              backgroundColor: `${btn.color}15`,
              borderColor: `${btn.color}4D`,
            },
          ]}
          activeOpacity={0.7}
          disabled={disabled}
          onPress={() => {
            Haptics.impactAsync(btn.haptic);
            onRate(btn.rating);
          }}
        >
          <Ionicons name={btn.icon} size={24} color={btn.color} />
          <Text style={[styles.label, { color: btn.color }]}>{btn.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
});
