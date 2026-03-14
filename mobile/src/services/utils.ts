/**
 * Mock storage utility — returns the local URI as-is since there's no backend.
 * Replace with Supabase Storage upload when ready.
 */
export const saveMediaToStorage = async (
  media: string,
  _path: string,
): Promise<string> => {
  // In a real implementation, upload to Supabase Storage and return the public URL
  return media;
};

export function uriToBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = function () {
      resolve(xhr.response);
    };
    xhr.onerror = function () {
      reject(new Error("uriToBlob failed"));
    };
    xhr.responseType = "blob";
    xhr.open("GET", uri, true);
    xhr.send(null);
  });
}
