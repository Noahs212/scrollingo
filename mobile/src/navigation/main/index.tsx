import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { userAuthStateListener } from "../../redux/slices/authSlice";
import { loadLanguages } from "../../redux/slices/languageSlice";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AuthScreen from "../../screens/auth";
import OnboardingScreen from "../../screens/onboarding";
import { AppDispatch, RootState } from "../../redux/store";
import HomeScreen from "../home";
import { View } from "react-native";
import EditProfileScreen from "../../screens/profile/edit";
import EditProfileFieldScreen from "../../screens/profile/edit/field";
import Modal from "../../components/modal";
import FeedScreen from "../../screens/feed";
import ProfileScreen from "../../screens/profile";
import ChatSingleScreen from "../../screens/chat/single";
import SettingsScreen from "../../screens/settings";
import DevOcrCompareScreen from "../../screens/devOcrCompare";

export type RootStackParamList = {
  home: undefined;
  auth: undefined;
  onboarding: undefined;
  userPosts: { creator: string; profile: boolean };
  profileOther: { initialUserId: string };
  editProfile: undefined;
  editProfileField: { title: string; field: string; value: string };
  chatSingle: { chatId?: string; contactId?: string };
  settings: undefined;
  devOcrCompare: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function Route() {
  const currentUserObj = useSelector((state: RootState) => state.auth);
  const { onboardingComplete, loaded: languageLoaded } = useSelector(
    (state: RootState) => state.language,
  );
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    dispatch(userAuthStateListener());
  }, [dispatch]);

  // Load language preferences when user is authenticated
  useEffect(() => {
    if (currentUserObj.currentUser?.uid) {
      dispatch(loadLanguages(currentUserObj.currentUser.uid));
    }
  }, [currentUserObj.currentUser?.uid, dispatch]);

  // Show loading screen until auth AND language state are resolved
  if (!currentUserObj.loaded || (currentUserObj.currentUser && !languageLoaded)) {
    return <View style={{ flex: 1, backgroundColor: "black" }} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        {currentUserObj.currentUser == null ? (
          <Stack.Screen
            name="auth"
            component={AuthScreen}
            options={{ headerShown: false }}
          />
        ) : !onboardingComplete ? (
          <Stack.Screen
            name="onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="home"
              component={HomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="userPosts"
              component={FeedScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="profileOther"
              component={ProfileScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="editProfile"
              component={EditProfileScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="editProfileField"
              component={EditProfileFieldScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="chatSingle"
              component={ChatSingleScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="settings"
              component={SettingsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="devOcrCompare"
              component={DevOcrCompareScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
      <Modal />
    </NavigationContainer>
  );
}
