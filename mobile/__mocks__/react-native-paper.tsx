import React from "react";
import { View, Text } from "react-native";

const AvatarIcon: React.FC<{
  size?: number;
  icon?: string;
  style?: object;
}> = ({ icon, ...props }) => {
  return <View testID="avatar-icon" {...props}><Text>{icon}</Text></View>;
};

const AvatarImage: React.FC<{
  size?: number;
  source?: { uri: string };
  style?: object;
}> = (props) => {
  return <View testID="avatar-image" {...props} />;
};

const AvatarText: React.FC<{
  size?: number;
  label?: string;
  style?: object;
}> = ({ label, ...props }) => {
  return <View testID="avatar-text" {...props}><Text>{label}</Text></View>;
};

export const Avatar = {
  Icon: AvatarIcon,
  Image: AvatarImage,
  Text: AvatarText,
};

export const Button: React.FC<{
  mode?: string;
  onPress?: () => void;
  children?: React.ReactNode;
}> = ({ children, ...props }) => {
  return <View testID="paper-button" {...props}><Text>{children}</Text></View>;
};

export const TextInput: React.FC<Record<string, unknown>> = (props) => {
  return <View testID="paper-text-input" {...props} />;
};

export const Provider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return <>{children}</>;
};

export const useTheme = jest.fn(() => ({
  colors: {
    primary: "#6200ee",
    background: "#ffffff",
    surface: "#ffffff",
    accent: "#03dac4",
    error: "#B00020",
    text: "#000000",
    onSurface: "#000000",
    disabled: "rgba(0,0,0,0.26)",
    placeholder: "rgba(0,0,0,0.54)",
    backdrop: "rgba(0,0,0,0.5)",
    notification: "#f50057",
  },
}));
