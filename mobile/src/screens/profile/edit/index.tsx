import React from "react";
import { View, Text, TouchableOpacity, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import styles from "./styles";
import NavBarGeneral from "../../../components/general/navbar";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { saveUserProfileImage } from "../../../services/user";
import { NATIVE_LANGUAGES } from "../../../services/language";
import { useSelector, useDispatch } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { AppDispatch, RootState } from "../../../redux/store";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../navigation/main";
import { logout, updateUserField } from "../../../redux/slices/authSlice";
import { useCurrentUserId } from "../../../hooks/useCurrentUserId";
import { keys } from "../../../hooks/queryKeys";

function getLanguageName(code: string): string {
  const lang = NATIVE_LANGUAGES.find((l) => l.code === code);
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
        <View style={styles.fieldItemContainer}>
          <Text>Native Language</Text>
          <View style={styles.fieldValueContainer}>
            <Text style={styles.fieldValueText}>
              {getLanguageName(language.nativeLanguage ?? "en")}
            </Text>
          </View>
        </View>

        {/* Learning Languages */}
        <View style={styles.fieldItemContainer}>
          <Text>Learning</Text>
          <View style={styles.fieldValueContainer}>
            <Text style={styles.fieldValueText}>
              {(language.learningLanguages ?? [])
                .map(getLanguageName)
                .join(", ") || "Not set"}
            </Text>
          </View>
        </View>

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
    </SafeAreaView>
  );
}
