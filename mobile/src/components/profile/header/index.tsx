import { View, Text, Image, TouchableOpacity } from "react-native";
import { Avatar } from "react-native-paper";
import { buttonStyles } from "../../../styles";
import styles from "./styles";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../../navigation/main";
import { useCurrentUserId } from "../../../hooks/useCurrentUserId";
import { useFollowing } from "../../../hooks/useFollowing";
import { Feather } from "@expo/vector-icons";
import { useFollowingMutation } from "../../../hooks/useFollowingMutation";
import { useEffect, useState } from "react";
import { User } from "../../../../types";
import { NATIVE_LANGUAGES, LEARNING_LANGUAGES } from "../../../services/language";

const allLanguages = [...NATIVE_LANGUAGES, ...LEARNING_LANGUAGES];

function getLanguageDisplay(code: string): { name: string; flag: string } {
  const lang = allLanguages.find((l) => l.code === code);
  return lang ?? { name: code, flag: "🌐" };
}

/**
 * Renders the user profile header with avatar, stats, language badges,
 * and learning progress. Handles follow/unfollow for other users.
 */
export default function ProfileHeader({ user }: { user: User | null }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [followersCount, setFollowersCount] = useState(
    user?.followersCount || 0,
  );

  useEffect(() => {
    setFollowersCount(user?.followersCount || 0);
  }, [user]);

  const currentUserId = useCurrentUserId();
  const followingData = useFollowing(currentUserId, user?.uid ?? null);
  const isFollowing =
    currentUserId && user?.uid && followingData.data
      ? followingData.data
      : false;

  const isFollowingMutation = useFollowingMutation();
  const isOwnProfile = currentUserId === user?.uid;

  const renderFollowButton = () => {
    if (isFollowing) {
      return (
        <View style={{ flexDirection: "row" }}>
          <TouchableOpacity
            style={buttonStyles.grayOutlinedButton}
            onPress={() => {
              if (user?.uid) {
                navigation.navigate("chatSingle", { contactId: user.uid });
              }
            }}
          >
            <Text style={buttonStyles.grayOutlinedButtonText}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={buttonStyles.grayOutlinedIconButton}
            onPress={() => {
              if (user?.uid) {
                isFollowingMutation.mutate({
                  otherUserId: user.uid,
                  isFollowing,
                });
                setFollowersCount(followersCount - 1);
              }
            }}
          >
            <Feather name="user-check" size={20} />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <TouchableOpacity
        style={buttonStyles.filledButton}
        onPress={() => {
          if (user?.uid) {
            isFollowingMutation.mutate({
              otherUserId: user.uid,
              isFollowing,
            });
            setFollowersCount(followersCount + 1);
          }
        }}
      >
        <Text style={buttonStyles.filledButtonText}>Follow</Text>
      </TouchableOpacity>
    );
  };

  if (!user) return null;

  const nativeLang = getLanguageDisplay(user.nativeLanguage ?? "en");
  const learningLangs = (user.learningLanguages ?? []).map(getLanguageDisplay);

  return (
    <View style={styles.container}>
      {/* Avatar */}
      {user.photoURL ? (
        <Image style={styles.avatar} source={{ uri: user.photoURL }} />
      ) : (
        <Avatar.Icon size={80} icon="account" />
      )}

      {/* Display Name */}
      <Text style={styles.emailText}>
        {user.displayName || user.email}
      </Text>

      {/* Language Badges */}
      <View style={styles.languageContainer}>
        <View style={styles.languageBadge}>
          <Text style={styles.languageBadgeText}>
            {nativeLang.flag} Native: {nativeLang.name}
          </Text>
        </View>
        {learningLangs.map((lang) => (
          <View key={lang.name} style={styles.learningBadge}>
            <Text style={styles.learningBadgeText}>
              {lang.flag} Learning {lang.name}
            </Text>
          </View>
        ))}
      </View>

      {/* Social Stats */}
      <View style={styles.counterContainer}>
        <View style={styles.counterItemContainer}>
          <Text style={styles.counterNumberText}>{user.followingCount}</Text>
          <Text style={styles.counterLabelText}>Following</Text>
        </View>
        <View style={styles.counterItemContainer}>
          <Text style={styles.counterNumberText}>{followersCount}</Text>
          <Text style={styles.counterLabelText}>Followers</Text>
        </View>
        <View style={styles.counterItemContainer}>
          <Text style={styles.counterNumberText}>{user.likesCount}</Text>
          <Text style={styles.counterLabelText}>Likes</Text>
        </View>
      </View>

      {/* Learning Stats (own profile only) */}
      {isOwnProfile && (
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statEmoji}>🔥</Text>
            <Text style={styles.statNumber}>{user.streakDays}</Text>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statEmoji}>📚</Text>
            <Text style={styles.statNumber}>{user.totalWordsLearned}</Text>
            <Text style={styles.statLabel}>Words</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statEmoji}>🎬</Text>
            <Text style={styles.statNumber}>{user.totalVideosWatched}</Text>
            <Text style={styles.statLabel}>Videos</Text>
          </View>
        </View>
      )}

      {/* Action Button */}
      {isOwnProfile ? (
        <TouchableOpacity
          style={buttonStyles.grayOutlinedButton}
          onPress={() => navigation.navigate("editProfile")}
        >
          <Text style={buttonStyles.grayOutlinedButtonText}>
            Edit Profile
          </Text>
        </TouchableOpacity>
      ) : (
        renderFollowButton()
      )}
    </View>
  );
}
