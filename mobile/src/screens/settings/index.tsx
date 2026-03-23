import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSelector, useDispatch } from "react-redux";
import { Feather } from "@expo/vector-icons";
import NavBarGeneral from "../../components/general/navbar";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../navigation/main";
import { AppDispatch, RootState } from "../../redux/store";
import { saveLanguages, toggleDevMuted } from "../../redux/slices/languageSlice";
import { logout, updateUserField } from "../../redux/slices/authSlice";
import { saveUserField } from "../../services/user";
import { useCurrentUserId } from "../../hooks/useCurrentUserId";
import {
  NATIVE_LANGUAGES,
  LEARNING_LANGUAGES,
} from "../../services/language";

const ALL_LANGUAGES = [...NATIVE_LANGUAGES, ...LEARNING_LANGUAGES];

function getLanguageDisplay(code: string): string {
  const lang = ALL_LANGUAGES.find((l) => l.code === code);
  return lang ? `${lang.flag} ${lang.name}` : code;
}

const GOAL_OPTIONS = [
  { minutes: 5, label: "5 min", description: "Casual" },
  { minutes: 10, label: "10 min", description: "Regular" },
  { minutes: 15, label: "15 min", description: "Serious" },
  { minutes: 20, label: "20 min", description: "Intense" },
  { minutes: 30, label: "30 min", description: "Hardcore" },
];


export default function SettingsScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const userId = useCurrentUserId();
  const auth = useSelector((state: RootState) => state.auth);
  const language = useSelector((state: RootState) => state.language);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const currentNative = language.nativeLanguage ?? "en";
  const currentLearning = language.learningLanguages ?? [];
  const devMuted = language.devMuted;
  const currentGoal = auth.currentUser?.dailyGoalMinutes ?? 10;

  const [nativeModalVisible, setNativeModalVisible] = useState(false);

  const handleSelectNative = useCallback(
    (code: string) => {
      if (!userId || code === currentNative) {
        setNativeModalVisible(false);
        return;
      }

      const filteredLearning = currentLearning.filter((c) => c !== code);

      dispatch(
        saveLanguages({
          userId,
          nativeLanguage: code,
          learningLanguages:
            filteredLearning.length > 0 ? filteredLearning : currentLearning.filter((c) => c !== code),
        }),
      );
      setNativeModalVisible(false);
    },
    [userId, currentNative, currentLearning, dispatch],
  );

  const availableLearning = useMemo(
    () => LEARNING_LANGUAGES.filter((l) => l.code !== currentNative),
    [currentNative],
  );

  const handleToggleLearning = useCallback(
    (code: string) => {
      if (!userId) return;

      const isSelected = currentLearning.includes(code);
      let updated: string[];

      if (isSelected) {
        if (currentLearning.length <= 1) return;
        updated = currentLearning.filter((c) => c !== code);
      } else {
        updated = [...currentLearning, code];
      }

      dispatch(
        saveLanguages({
          userId,
          nativeLanguage: currentNative,
          learningLanguages: updated,
        }),
      );
    },
    [userId, currentNative, currentLearning, dispatch],
  );

  const handleSelectGoal = useCallback(
    (minutes: number) => {
      if (minutes === currentGoal) return;

      dispatch(updateUserField({ field: "dailyGoalMinutes", value: minutes }));
      saveUserField("dailyGoalMinutes", String(minutes)).catch(() => {});
    },
    [currentGoal, dispatch],
  );


  return (
    <SafeAreaView style={styles.container}>
      <NavBarGeneral title="Settings" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* --- Native Language --- */}
        <Text style={styles.sectionTitle}>Native Language</Text>
        <TouchableOpacity
          style={styles.selectorRow}
          onPress={() => setNativeModalVisible(true)}
        >
          <Text style={styles.selectorValue}>
            {getLanguageDisplay(currentNative)}
          </Text>
          <Feather name="chevron-right" size={20} color="gray" />
        </TouchableOpacity>

        {/* --- Learning Languages --- */}
        <Text style={styles.sectionTitle}>Learning Languages</Text>
        <Text style={styles.sectionSubtitle}>
          Tap to add or remove languages
        </Text>
        <View style={styles.learningContainer}>
          {availableLearning.map((lang) => {
            const isSelected = currentLearning.includes(lang.code);
            return (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.learningChip,
                  isSelected && styles.learningChipSelected,
                ]}
                onPress={() => handleToggleLearning(lang.code)}
              >
                <Text style={styles.learningChipFlag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.learningChipText,
                    isSelected && styles.learningChipTextSelected,
                  ]}
                >
                  {lang.name}
                </Text>
                {isSelected && (
                  <Feather name="check" size={16} color="#fe2c55" />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* --- Daily Goal --- */}
        <Text style={styles.sectionTitle}>Daily Goal</Text>
        <Text style={styles.sectionSubtitle}>
          How much time do you want to study each day?
        </Text>
        <View style={styles.goalContainer}>
          {GOAL_OPTIONS.map((option) => {
            const isSelected = currentGoal === option.minutes;
            return (
              <TouchableOpacity
                key={option.minutes}
                style={[
                  styles.goalPill,
                  isSelected && styles.goalPillSelected,
                ]}
                onPress={() => handleSelectGoal(option.minutes)}
              >
                <Text
                  style={[
                    styles.goalPillText,
                    isSelected && styles.goalPillTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
                <Text
                  style={[
                    styles.goalPillDescription,
                    isSelected && styles.goalPillDescriptionSelected,
                  ]}
                >
                  {option.description}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* --- Sign Out --- */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => dispatch(logout())}
        >
          <Feather name="log-out" size={20} color="red" />
          <Text style={styles.logoutButtonText}>Sign Out</Text>
        </TouchableOpacity>

        {/* --- Developer --- */}
        <Text style={styles.devSectionTitle}>Developer</Text>
        <TouchableOpacity
          style={styles.devItem}
          onPress={() => navigation.navigate("devOcrCompare")}
        >
          <Feather name="eye" size={18} color="#fe2c55" />
          <Text style={styles.devItemText}>OCR Model Comparison</Text>
          <Feather name="chevron-right" size={18} color="gray" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.devItem}
          onPress={() => dispatch(toggleDevMuted())}
        >
          <Feather name={devMuted ? "volume-x" : "volume-2"} size={18} color="#fe2c55" />
          <Text style={styles.devItemText}>Mute Audio</Text>
          <View style={[styles.devToggle, devMuted && styles.devToggleOn]}>
            <View style={[styles.devToggleThumb, devMuted && styles.devToggleThumbOn]} />
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* --- Native Language Modal --- */}
      <Modal
        visible={nativeModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setNativeModalVisible(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Native Language</Text>
            <TouchableOpacity
              onPress={() => setNativeModalVisible(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="x" size={24} color="#333" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalList}>
            {NATIVE_LANGUAGES.map((lang) => {
              const isSelected = currentNative === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.modalItem,
                    isSelected && styles.modalItemSelected,
                  ]}
                  onPress={() => handleSelectNative(lang.code)}
                >
                  <Text style={styles.modalItemFlag}>{lang.flag}</Text>
                  <Text
                    style={[
                      styles.modalItemText,
                      isSelected && styles.modalItemTextSelected,
                    ]}
                  >
                    {lang.name}
                  </Text>
                  {isSelected && (
                    <Feather name="check" size={20} color="#fe2c55" />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginTop: 24,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "gray",
    marginBottom: 12,
  },
  selectorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  selectorValue: {
    fontSize: 16,
    color: "#333",
  },
  learningContainer: {
    gap: 8,
  },
  learningChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
  },
  learningChipSelected: {
    borderColor: "#fe2c55",
    backgroundColor: "#fff5f5",
  },
  learningChipFlag: {
    fontSize: 22,
    marginRight: 12,
  },
  learningChipText: {
    fontSize: 16,
    color: "#333",
    flex: 1,
  },
  learningChipTextSelected: {
    color: "#fe2c55",
    fontWeight: "600",
  },
  goalContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  goalPill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
    alignItems: "center",
    minWidth: 80,
  },
  goalPillSelected: {
    borderColor: "#fe2c55",
    backgroundColor: "#fff5f5",
  },
  goalPillText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  goalPillTextSelected: {
    color: "#fe2c55",
  },
  goalPillDescription: {
    fontSize: 11,
    color: "gray",
    marginTop: 2,
  },
  goalPillDescriptionSelected: {
    color: "#fe2c55",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 40,
    paddingVertical: 12,
    borderColor: "red",
    borderWidth: 1,
    borderRadius: 8,
  },
  logoutButtonText: {
    color: "red",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "white",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  modalList: {
    flex: 1,
    paddingHorizontal: 20,
  },
  modalItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  modalItemSelected: {
    backgroundColor: "#fff5f5",
  },
  modalItemFlag: {
    fontSize: 24,
    marginRight: 14,
  },
  modalItemText: {
    fontSize: 16,
    color: "#333",
    flex: 1,
  },
  modalItemTextSelected: {
    color: "#fe2c55",
    fontWeight: "600",
  },
  devSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fe2c55",
    marginBottom: 8,
  },
  devItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  devItemText: {
    fontSize: 15,
    color: "#333",
    flex: 1,
  },
  devToggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#e0e0e0",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  devToggleOn: {
    backgroundColor: "#fe2c55",
  },
  devToggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "white",
  },
  devToggleThumbOn: {
    alignSelf: "flex-end",
  },
});
