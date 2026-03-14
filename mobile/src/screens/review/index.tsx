import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const MOCK_VOCAB = [
  { word: "Hola", translation: "Hello", language: "Spanish" },
  { word: "Bonjour", translation: "Good morning", language: "French" },
  { word: "Arigatou", translation: "Thank you", language: "Japanese" },
  { word: "Danke", translation: "Thank you", language: "German" },
  { word: "Annyeong", translation: "Hello", language: "Korean" },
];

export default function ReviewScreen() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const currentCard = MOCK_VOCAB[currentIndex];

  const handleFlip = () => setIsFlipped(!isFlipped);

  const handleNext = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % MOCK_VOCAB.length);
  };

  const handlePrevious = () => {
    setIsFlipped(false);
    setCurrentIndex(
      (prev) => (prev - 1 + MOCK_VOCAB.length) % MOCK_VOCAB.length,
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vocab Review</Text>
        <Text style={styles.headerSubtitle}>
          {currentIndex + 1} / {MOCK_VOCAB.length}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.card}
        onPress={handleFlip}
        activeOpacity={0.9}
      >
        <Text style={styles.languageLabel}>{currentCard.language}</Text>
        <Text style={styles.cardText}>
          {isFlipped ? currentCard.translation : currentCard.word}
        </Text>
        <Text style={styles.tapHint}>
          {isFlipped ? "Translation" : "Tap to reveal"}
        </Text>
      </TouchableOpacity>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton} onPress={handlePrevious}>
          <Ionicons name="chevron-back" size={28} color="white" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.knowButton} onPress={handleNext}>
          <Ionicons name="checkmark-circle" size={28} color="white" />
          <Text style={styles.knowButtonText}>Got it</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipButton} onPress={handleNext}>
          <Ionicons name="close-circle" size={28} color="white" />
          <Text style={styles.skipButtonText}>Still learning</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={handleNext}>
          <Ionicons name="chevron-forward" size={28} color="white" />
        </TouchableOpacity>
      </View>

      <View style={styles.placeholder}>
        <Ionicons name="book-outline" size={24} color="#666" />
        <Text style={styles.placeholderText}>
          Spaced repetition and saved vocab coming soon
        </Text>
      </View>
    </SafeAreaView>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
  },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    alignItems: "center",
  },
  headerTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSubtitle: {
    color: "#888",
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    width: width - 48,
    height: 280,
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 24,
    borderWidth: 1,
    borderColor: "#333",
  },
  languageLabel: {
    position: "absolute",
    top: 20,
    color: "#fe2c55",
    fontSize: 14,
    fontWeight: "600",
  },
  cardText: {
    color: "white",
    fontSize: 36,
    fontWeight: "bold",
  },
  tapHint: {
    position: "absolute",
    bottom: 20,
    color: "#666",
    fontSize: 13,
  },
  controls: {
    flexDirection: "row",
    marginTop: 32,
    alignItems: "center",
    gap: 12,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#222",
    justifyContent: "center",
    alignItems: "center",
  },
  knowButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "#25a56a",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  knowButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
  skipButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "#333",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  skipButtonText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
  },
  placeholder: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 40,
    gap: 8,
  },
  placeholderText: {
    color: "#666",
    fontSize: 13,
  },
});
