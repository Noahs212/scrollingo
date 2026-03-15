import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "../../redux/store";
import { saveLanguages } from "../../redux/slices/languageSlice";
import { NATIVE_LANGUAGES, LEARNING_LANGUAGES } from "../../services/language";

type Step = "native" | "learning";

export default function OnboardingScreen() {
  const [step, setStep] = useState<Step>("native");
  const [selectedNative, setSelectedNative] = useState<string | null>(null);
  const [selectedLearning, setSelectedLearning] = useState<string[]>([]);

  const [localError, setLocalError] = useState<string | null>(null);
  const dispatch = useDispatch<AppDispatch>();
  const userId = useSelector((state: RootState) => state.auth.currentUser?.uid);
  const { loading } = useSelector((state: RootState) => state.language);

  const toggleLearning = (code: string) => {
    setSelectedLearning((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const handleContinue = () => {
    if (step === "native" && selectedNative) {
      // Filter out native language from learning options
      setSelectedLearning((prev) => prev.filter((c) => c !== selectedNative));
      setStep("learning");
    }
  };

  const handleFinish = async () => {
    if (!userId || !selectedNative || selectedLearning.length === 0) return;
    setLocalError(null);
    // Save to server, but don't block on failure — proceed to home either way
    dispatch(
      saveLanguages({
        userId,
        nativeLanguage: selectedNative,
        learningLanguages: selectedLearning,
      }),
    );
  };

  // Filter learning languages to exclude the user's native language
  const availableLearning = LEARNING_LANGUAGES.filter(
    (l) => l.code !== selectedNative,
  );

  return (
    <View style={styles.container}>
      {step === "native" ? (
        <>
          <Text style={styles.title}>What language do you speak?</Text>
          <Text style={styles.subtitle}>
            We'll show translations in this language
          </Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
          >
            {NATIVE_LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.languageItem,
                  selectedNative === lang.code && styles.languageItemSelected,
                ]}
                onPress={() => setSelectedNative(lang.code)}
              >
                <Text style={styles.flag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.languageName,
                    selectedNative === lang.code && styles.languageNameSelected,
                  ]}
                >
                  {lang.name}
                </Text>
                {selectedNative === lang.code && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={[
              styles.button,
              !selectedNative && styles.buttonDisabled,
            ]}
            onPress={handleContinue}
            disabled={!selectedNative}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.title}>What do you want to learn?</Text>
          <Text style={styles.subtitle}>
            Select one or more languages
          </Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
          >
            {availableLearning.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.languageItem,
                  selectedLearning.includes(lang.code) &&
                    styles.languageItemSelected,
                ]}
                onPress={() => toggleLearning(lang.code)}
              >
                <Text style={styles.flag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.languageName,
                    selectedLearning.includes(lang.code) &&
                      styles.languageNameSelected,
                  ]}
                >
                  {lang.name}
                </Text>
                {selectedLearning.includes(lang.code) && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {localError && <Text style={styles.error}>{localError}</Text>}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => setStep("native")}
            >
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.buttonFlex,
                (selectedLearning.length === 0 || loading) &&
                  styles.buttonDisabled,
              ]}
              onPress={handleFinish}
              disabled={selectedLearning.length === 0 || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Start Learning</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    color: "#888",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 20,
  },
  languageItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: "#1a1a1a",
    borderWidth: 2,
    borderColor: "transparent",
  },
  languageItemSelected: {
    borderColor: "#ff4040",
    backgroundColor: "#1a0a0a",
  },
  flag: {
    fontSize: 28,
    marginRight: 16,
  },
  languageName: {
    color: "#fff",
    fontSize: 18,
    flex: 1,
  },
  languageNameSelected: {
    color: "#ff4040",
    fontWeight: "600",
  },
  checkmark: {
    color: "#ff4040",
    fontSize: 20,
    fontWeight: "bold",
  },
  button: {
    backgroundColor: "#ff4040",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonFlex: {
    flex: 1,
  },
  buttonDisabled: {
    backgroundColor: "#333",
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  backButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
    alignItems: "center",
  },
  backButtonText: {
    color: "#888",
    fontSize: 18,
  },
  error: {
    color: "#ff4040",
    textAlign: "center",
    marginBottom: 12,
  },
});
