import { RouteProp, useNavigation } from "@react-navigation/native";
import React, { useState } from "react";
import { View, Text, TextInput } from "react-native";
import { Divider } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDispatch } from "react-redux";
import { useQueryClient } from "@tanstack/react-query";
import NavBarGeneral from "../../../../components/general/navbar";
import { saveUserField } from "../../../../services/user";
import { updateUserField } from "../../../../redux/slices/authSlice";
import { useCurrentUserId } from "../../../../hooks/useCurrentUserId";
import { keys } from "../../../../hooks/queryKeys";
import { generalStyles } from "../../../../styles";
import styles from "./styles";
import { RootStackParamList } from "../../../../navigation/main";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AppDispatch } from "../../../../redux/store";

interface EditProfileFieldScreenProps {
  route: RouteProp<RootStackParamList, "editProfileField">;
  navigation: NativeStackNavigationProp<RootStackParamList, "editProfileField">;
}

export default function EditProfileFieldScreen({
  route,
}: EditProfileFieldScreenProps) {
  const { title, field, value } = route.params;
  const [textInputValue, setTextInputValue] = useState(value);
  const navigation = useNavigation();
  const dispatch = useDispatch<AppDispatch>();
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();

  const onSave = async () => {
    try {
      await saveUserField(field, textInputValue);
      // Update Redux state so edit screen reflects the change
      const numericFields = new Set(["dailyGoalMinutes"]);
      const reduxValue = numericFields.has(field) ? parseInt(textInputValue, 10) : textInputValue;
      dispatch(updateUserField({ field, value: reduxValue }));
      // Invalidate React Query cache so profile screen refetches
      queryClient.invalidateQueries({ queryKey: keys.user(currentUserId) });
      navigation.goBack();
    } catch (err) {
      console.error("[editField] save failed:", err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <NavBarGeneral
        title={title}
        rightButton={{ display: true, name: "save", action: onSave }}
      />
      <Divider />
      <View style={styles.mainContainer}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          style={generalStyles.textInput}
          value={textInputValue}
          onChangeText={setTextInputValue}
        />
      </View>
    </SafeAreaView>
  );
}
