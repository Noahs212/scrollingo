import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, Image, Modal, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import styles from "./styles";
import NavBarGeneral from "../../../components/general/navbar";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { saveUserProfileImage } from "../../../services/user";
import { NATIVE_LANGUAGES, LEARNING_LANGUAGES } from "../../../services/language";
import { useSelector, useDispatch } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { AppDispatch, RootState } from "../../../redux/store";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../navigation/main";
import { logout, updateUserField } from "../../../redux/slices/authSlice";
import { saveLanguages } from "../../../redux/slices/languageSlice";
import { useCurrentUserId } from "../../../hooks/useCurrentUserId";
import { keys } from "../../../hooks/queryKeys";

const ALL_LANGUAGES = [...NATIVE_LANGUAGES, ...LEARNING_LANGUAGES];

function getLanguageName(code: string): string {
  const lang = ALL_LANGUAGES.find((l) => l.code === code);
  return lang ? `${lang.flag} ${lang.name}` : code;
}

export default function EditProfileScreen() {
  const auth = useSelector((state: RootState) => state.auth);
  const language = useSelector((state: RootState) => state.language);
  const dispatch: AppDispatch = useDispatch();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();

  const [nativeModalVisible, setNativeModalVisible] = useState(false);
  const currentNative = language.nativeLanguage ?? "en";
  const currentLearning = language.learningLanguages ?? [];

  const handleSelectNative = useCallback(
    (code: string) => {
      if (!currentUserId || code === currentNative) {
        setNativeModalVisible(false);
        return;
      }
      const filteredLearning = currentLearning.filter((c) => c !== code);
      dispatch(
        saveLanguages({
          userId: currentUserId,
          nativeLanguage: code,
          learningLanguages: filteredLearning.length > 0 ? filteredLearning : currentLearning,
        }),
      );
      setNativeModalVisible(false);
    },
    [currentUserId, currentNative, currentLearning, dispatch],
  );

  const chooseImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      try {
        await saveUserProfileImage(uri);
        dispatch(updateUserField({ field: "photoURL", value: uri }));
        queryClient.invalidateQueries({ queryKey: keys.user(currentUserId) });
      } catch (err) {
        // image save failed silently
      }
    }
  };

  const currentUser = auth.currentUser;

  return (
    <SafeAreaView style={styles.container}>
      <NavBarGeneral title="Edit Profile" />
      <View style={styles.imageContainer}>
        <TouchableOpacity
          style={styles.imageViewContainer}
          onPress={chooseImage}
        >
          {currentUser?.photoURL ? (
            <Image
              style={styles.image}
              source={{ uri: currentUser.photoURL }}
            />
          ) : (
            <View style={[styles.image, styles.placeholderImage]}>
              <Feather name="user" size={30} color="gray" />
            </View>
          )}
          <View style={styles.imageOverlay} />
          <Feather name="camera" size={26} color="white" />
        </TouchableOpacity>
      </View>

      <View style={styles.fieldsContainer}>
        {/* Display Name */}
        <TouchableOpacity
          style={styles.fieldItemContainer}
          onPress={() =>
            navigation.navigate("editProfileField", {
              title: "Display Name",
              field: "displayName",
              value: currentUser?.displayName ?? "",
            })
          }
        >
          <Text>Display Name</Text>
          <View style={styles.fieldValueContainer}>
            <Text style={styles.fieldValueText}>
              {currentUser?.displayName || "Not set"}
            </Text>
            <Feather name="chevron-right" size={20} color="gray" />
          </View>
        </TouchableOpacity>

        {/* Native Language */}
        <TouchableOpacity
          style={styles.fieldItemContainer}
          onPress={() => setNativeModalVisible(true)}
        >
          <Text>Native Language</Text>
          <View style={styles.fieldValueContainer}>
            <Text style={styles.fieldValueText}>
              {getLanguageName(currentNative)}
            </Text>
            <Feather name="chevron-right" size={20} color="gray" />
          </View>
        </TouchableOpacity>

        {/* Learning Languages */}
        <TouchableOpacity
          style={styles.fieldItemContainer}
          onPress={() => navigation.navigate("settings")}
        >
          <Text>Learning</Text>
          <View style={styles.fieldValueContainer}>
            <Text style={styles.fieldValueText}>
              {currentLearning.map(getLanguageName).join(", ") || "Not set"}
            </Text>
            <Feather name="chevron-right" size={20} color="gray" />
          </View>
        </TouchableOpacity>

        {/* Daily Goal */}
        <TouchableOpacity
          style={styles.fieldItemContainer}
          onPress={() =>
            navigation.navigate("editProfileField", {
              title: "Daily Goal (minutes)",
              field: "dailyGoalMinutes",
              value: String(currentUser?.dailyGoalMinutes ?? 10),
            })
          }
        >
          <Text>Daily Goal</Text>
          <View style={styles.fieldValueContainer}>
            <Text style={styles.fieldValueText}>
              {currentUser?.dailyGoalMinutes ?? 10} min/day
            </Text>
            <Feather name="chevron-right" size={20} color="gray" />
          </View>
        </TouchableOpacity>

        {/* Streak Info */}
        <View style={styles.fieldItemContainer}>
          <Text>Streak</Text>
          <View style={styles.fieldValueContainer}>
            <Text style={styles.fieldValueText}>
              🔥 {currentUser?.streakDays ?? 0} days (best: {currentUser?.longestStreak ?? 0})
            </Text>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => dispatch(logout())}
        >
          <Feather name="log-out" size={20} color="red" />
          <Text style={styles.logoutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Native Language Modal */}
      <Modal
        visible={nativeModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setNativeModalVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "white" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" }}>
            <Text style={{ fontSize: 18, fontWeight: "bold", color: "#333" }}>Native Language</Text>
            <TouchableOpacity onPress={() => setNativeModalVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Feather name="x" size={24} color="#333" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1, paddingHorizontal: 20 }}>
            {NATIVE_LANGUAGES.map((lang) => {
              const isSelected = currentNative === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f0f0f0", backgroundColor: isSelected ? "#fff5f5" : "transparent" }}
                  onPress={() => handleSelectNative(lang.code)}
                >
                  <Text style={{ fontSize: 24, marginRight: 14 }}>{lang.flag}</Text>
                  <Text style={{ fontSize: 16, color: isSelected ? "#fe2c55" : "#333", flex: 1, fontWeight: isSelected ? "600" : "400" }}>{lang.name}</Text>
                  {isSelected && <Feather name="check" size={20} color="#fe2c55" />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
