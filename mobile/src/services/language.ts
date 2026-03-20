import { supabase } from "../lib/supabase";

export const LEARNING_LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
] as const;

export const NATIVE_LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
] as const;

export async function fetchUserLanguages(userId: string) {
  // Add timeout to prevent hanging forever on flaky network
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const { data, error } = await supabase
      .from("users")
      .select("native_language, target_language, learning_languages")
      .eq("id", userId)
      .abortSignal(controller.signal)
      .single();

    clearTimeout(timeout);

    if (error) {
      throw error;
    }
    return data;
  } catch (err: any) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function updateActiveLanguage(
  userId: string,
  languageCode: string,
) {
  const { error } = await supabase
    .from("users")
    .update({ target_language: languageCode })
    .eq("id", userId);
  if (error) throw error;
}

export async function updateUserLanguages(
  userId: string,
  nativeLanguage: string,
  learningLanguages: string[],
) {
  const { error } = await supabase
    .from("users")
    .update({
      native_language: nativeLanguage,
      target_language: learningLanguages[0],
      learning_languages: learningLanguages,
    })
    .eq("id", userId);

  if (error) {
    throw error;
  }
}
