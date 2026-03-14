import { saveMediaToStorage } from "../../services/utils";
import { getPostsByUserId } from "../../services/posts";
import uuid from "uuid-random";
import { PayloadAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { Post } from "../../../types";
import { RootState } from "../store";

interface PostState {
  loading: boolean;
  error: string | null;
  currentUserPosts: Post[] | null;
}

const initialState: PostState = {
  loading: false,
  error: null,
  currentUserPosts: null,
};

export const createPost = createAsyncThunk(
  "post/create",
  async (
    {
      description,
      video,
      thumbnail,
    }: {
      description: string;
      video: string;
      thumbnail: string;
    },
    { getState, rejectWithValue },
  ) => {
    const state = getState() as RootState;
    const currentUser = state.auth.currentUser;
    if (currentUser) {
      try {
        const storagePostId = uuid();
        const [videoDownloadUrl, thumbnailDownloadUrl] = await Promise.all([
          saveMediaToStorage(
            video,
            `post/${currentUser.uid}/${storagePostId}/video`,
          ),
          saveMediaToStorage(
            thumbnail,
            `post/${currentUser.uid}/${storagePostId}/thumbnail`,
          ),
        ]);

        // Mock: in a real app, this would insert into Supabase
        console.log("Post created (mock):", {
          creator: currentUser.uid,
          media: [videoDownloadUrl, thumbnailDownloadUrl],
          description,
        });
      } catch (error) {
        console.error("Error creating post: ", error);
        return rejectWithValue(error);
      }
    } else {
      return rejectWithValue(new Error("User not authenticated"));
    }
  },
);

export const getPostsByUser = createAsyncThunk(
  "post/getPostsByUser",
  async (uid: string, { dispatch, rejectWithValue }) => {
    try {
      const posts = await getPostsByUserId(uid);
      dispatch({ type: "CURRENT_USER_POSTS_UPDATE", payload: posts });
      return posts;
    } catch (error) {
      console.error("Failed to get posts: ", error);
      return rejectWithValue(error);
    }
  },
);

const postSlice = createSlice({
  name: "post",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(createPost.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createPost.fulfilled, (state) => {
        state.loading = false;
        state.error = null;
      })
      .addCase(createPost.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || null;
      })
      .addCase(getPostsByUser.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(
        getPostsByUser.fulfilled,
        (state, action: PayloadAction<Post[]>) => {
          state.loading = false;
          state.currentUserPosts = action.payload;
        },
      )
      .addCase(getPostsByUser.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || null;
      });
  },
});

export default postSlice.reducer;
