import { ScrollView } from "react-native";
import styles from "./styles";
import ProfileNavBar from "../../components/profile/navBar";
import ProfileHeader from "../../components/profile/header";
import ProfilePostList from "../../components/profile/postList";
import { SafeAreaView } from "react-native-safe-area-context";
import { useContext } from "react";
import { useSelector } from "react-redux";
import {
  CurrentUserProfileItemInViewContext,
  FeedStackParamList,
} from "../../navigation/feed";
import { useUser } from "../../hooks/useUser";
import { useCurrentUserId } from "../../hooks/useCurrentUserId";
import { fetchVideosByCreator } from "../../services/videos";
import { User, Video } from "../../../types";
import { RouteProp } from "@react-navigation/native";
import { RootStackParamList } from "../../navigation/main";
import { HomeStackParamList } from "../../navigation/home";
import { RootState } from "../../redux/store";
import { useQuery } from "@tanstack/react-query";

type ProfileScreenRouteProp =
  | RouteProp<RootStackParamList, "profileOther">
  | RouteProp<HomeStackParamList, "Me">
  | RouteProp<FeedStackParamList, "feedProfile">;

export default function ProfileScreen({
  route,
}: {
  route: ProfileScreenRouteProp;
}) {
  const { initialUserId } = route.params;

  const currentUserId = useCurrentUserId();
  const providerUserId = useContext(CurrentUserProfileItemInViewContext);

  const targetUserId = initialUserId || providerUserId.currentUserProfileItemInView;
  const isOwnProfile = targetUserId === currentUserId;

  // Own profile: read from Redux (always up to date after edits)
  // Other profiles: read from React Query (cached, refetched as needed)
  const currentUser = useSelector((state: RootState) => state.auth.currentUser);
  const otherUserQuery = useUser(isOwnProfile ? null : targetUserId);

  const user: User | null = isOwnProfile ? currentUser : (otherUserQuery.data ?? null);

  // Fetch creator's videos from Supabase (cached by React Query)
  const { data: userVideos = [] } = useQuery<Video[]>({
    queryKey: ["userVideos", targetUserId],
    queryFn: () => fetchVideosByCreator(targetUserId ?? ""),
    enabled: !!targetUserId,
    staleTime: 5 * 60 * 1000,
  });

  if (!user) {
    return <></>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ProfileNavBar user={user} />
      <ScrollView>
        <ProfileHeader user={user} />
        <ProfilePostList videos={userVideos} />
      </ScrollView>
    </SafeAreaView>
  );
}
