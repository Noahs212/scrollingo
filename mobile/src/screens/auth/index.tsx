import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { useDispatch, useSelector } from "react-redux";
import {
  login,
  register,
  loginWithGoogle,
  loginWithApple,
} from "../../redux/slices/authSlice";
import { AppDispatch, RootState } from "../../redux/store";
import { Feather } from "@expo/vector-icons";
import styles from "./styles";

export default function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const dispatch: AppDispatch = useDispatch();
  const error = useSelector((state: RootState) => state.auth.error);

  const handleSubmit = () => {
    if (isSignUp) {
      dispatch(register({ email, password }));
    } else {
      dispatch(login({ email, password }));
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.appName}>Scrollingo</Text>
          <Text style={styles.tagline}>Learn languages through short videos</Text>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#999"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity testID="submit-button" style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitButtonText}>
              {isSignUp ? "Sign Up" : "Sign In"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.oauthContainer}>
          <TouchableOpacity
            testID="google-button"
            style={styles.oauthButton}
            onPress={() => dispatch(loginWithGoogle())}
          >
            <Feather name="chrome" size={20} color="#333" />
            <Text style={styles.oauthButtonText}>Continue with Google</Text>
          </TouchableOpacity>

          {Platform.OS === "ios" && (
            <TouchableOpacity
              testID="apple-button"
              style={[styles.oauthButton, styles.oauthButtonApple]}
              onPress={() => dispatch(loginWithApple())}
            >
              <Feather name="smartphone" size={20} color="#fff" />
              <Text style={styles.oauthButtonTextApple}>Continue with Apple</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.switchRow}
          onPress={() => setIsSignUp(!isSignUp)}
        >
          <Text style={styles.switchText}>
            {isSignUp ? "Already have an account? " : "Don't have an account? "}
            <Text style={styles.switchTextBold}>
              {isSignUp ? "Sign In" : "Sign Up"}
            </Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
