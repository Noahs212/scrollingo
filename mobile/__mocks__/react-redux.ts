const mockDispatch = jest.fn();

export const useSelector = jest.fn((selector: (state: unknown) => unknown) => {
  // Default mock state - tests can override via jest.mocked(useSelector).mockImplementation(...)
  const mockState = {
    auth: {
      currentUser: {
        uid: "test-user-123",
        email: "test@example.com",
        displayName: "Test User",
        photoURL: null,
        followingCount: 5,
        followersCount: 10,
        likesCount: 50,
      },
      loaded: true,
    },
    post: {
      currentUserPosts: [],
    },
    modal: {
      open: false,
      data: null,
      modalType: -1,
    },
    chat: {
      list: [],
    },
  };
  return selector(mockState);
});

export const useDispatch = jest.fn(() => mockDispatch);

export const useStore = jest.fn(() => ({
  getState: jest.fn(),
  dispatch: mockDispatch,
  subscribe: jest.fn(),
}));

export const Provider = jest.fn(
  ({ children }: { children: React.ReactNode }) => children,
);

export { mockDispatch };
