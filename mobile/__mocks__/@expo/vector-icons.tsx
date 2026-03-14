import React from "react";
import { Text } from "react-native";

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  testID?: string;
}

const createIconSet = (displayName: string) => {
  const IconComponent: React.FC<IconProps> = ({ name, testID, ...props }) => {
    return <Text testID={testID || `icon-${name}`} {...props}>{name}</Text>;
  };
  IconComponent.displayName = displayName;
  return IconComponent;
};

export const Ionicons = createIconSet("Ionicons");
export const MaterialIcons = createIconSet("MaterialIcons");
export const MaterialCommunityIcons = createIconSet("MaterialCommunityIcons");
export const FontAwesome = createIconSet("FontAwesome");
export const FontAwesome5 = createIconSet("FontAwesome5");
export const Feather = createIconSet("Feather");
export const Entypo = createIconSet("Entypo");
export const AntDesign = createIconSet("AntDesign");
export const SimpleLineIcons = createIconSet("SimpleLineIcons");
export const Octicons = createIconSet("Octicons");
export const Foundation = createIconSet("Foundation");
export const EvilIcons = createIconSet("EvilIcons");

export default {
  Ionicons,
  MaterialIcons,
  MaterialCommunityIcons,
  FontAwesome,
  FontAwesome5,
  Feather,
  Entypo,
  AntDesign,
  SimpleLineIcons,
  Octicons,
  Foundation,
  EvilIcons,
};
